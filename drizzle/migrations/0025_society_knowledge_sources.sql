CREATE TABLE public.society_knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('document','faq')),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 160),
  audience text NOT NULL DEFAULT 'residents' CHECK (audience IN ('residents','committee')),
  faq_answer text CHECK (faq_answer IS NULL OR char_length(faq_answer) <= 4000),
  storage_path text,
  file_name text CHECK (file_name IS NULL OR char_length(file_name) <= 200),
  mime_type text,
  size_bytes integer CHECK (size_bytes IS NULL OR size_bytes BETWEEN 1 AND 5242880),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','ready','unsupported','failed','archived')),
  status_reason text CHECK (status_reason IS NULL OR char_length(status_reason) <= 300),
  extracted_text text CHECK (extracted_text IS NULL OR char_length(extracted_text) <= 120000),
  text_chars integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX society_knowledge_sources_society_idx ON public.society_knowledge_sources(society_id, status);

GRANT SELECT (id, society_id, kind, title, audience, faq_answer, file_name, mime_type, size_bytes, status, status_reason, extracted_text, text_chars, version, created_at, updated_at, archived_at) ON public.society_knowledge_sources TO authenticated;
GRANT ALL ON public.society_knowledge_sources TO service_role;
ALTER TABLE public.society_knowledge_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read own society knowledge" ON public.society_knowledge_sources FOR SELECT TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id));
CREATE POLICY "members read ready resident knowledge" ON public.society_knowledge_sources FOR SELECT TO authenticated
  USING (status = 'ready' AND audience = 'residents' AND public.society_has_access(society_id));

CREATE OR REPLACE FUNCTION public._knowledge_admin_society() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid;
BEGIN
  SELECT society_id INTO _soc FROM public.profiles WHERE id = auth.uid();
  IF _soc IS NULL OR NOT public.is_society_admin_for(auth.uid(), _soc) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN _soc;
END $$;
REVOKE ALL ON FUNCTION public._knowledge_admin_society() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.knowledge_begin_document(_title text, _audience text, _file_name text, _mime text, _size integer, _ext text, _replace_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._knowledge_admin_society(); _id uuid; _ver int; _old text; _path text;
BEGIN
  IF _ext NOT IN ('pdf','txt','md') OR _mime NOT IN ('application/pdf','text/plain','text/markdown') THEN RAISE EXCEPTION 'invalid_file'; END IF;
  IF _audience NOT IN ('residents','committee') THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF _replace_id IS NULL THEN
    IF (SELECT count(*) FROM public.society_knowledge_sources WHERE society_id = _soc) >= 200 THEN RAISE EXCEPTION 'limit_reached'; END IF;
    _id := gen_random_uuid(); _ver := 1;
    _path := _soc::text || '/' || _id::text || '/v1.' || _ext;
    INSERT INTO public.society_knowledge_sources(id, society_id, kind, title, audience, storage_path, file_name, mime_type, size_bytes, status, created_by, updated_by)
    VALUES (_id, _soc, 'document', btrim(_title), _audience, _path, _file_name, _mime, _size, 'processing', auth.uid(), auth.uid());
  ELSE
    SELECT storage_path, version + 1 INTO _old, _ver FROM public.society_knowledge_sources
      WHERE id = _replace_id AND society_id = _soc AND kind = 'document' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
    _id := _replace_id;
    _path := _soc::text || '/' || _id::text || '/v' || _ver || '.' || _ext;
    UPDATE public.society_knowledge_sources SET title = btrim(_title), audience = _audience, storage_path = _path, file_name = _file_name,
      mime_type = _mime, size_bytes = _size, status = 'processing', status_reason = NULL, extracted_text = NULL, text_chars = 0,
      version = _ver, archived_at = NULL, updated_by = auth.uid(), updated_at = now() WHERE id = _id;
  END IF;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), CASE WHEN _replace_id IS NULL THEN 'knowledge.uploaded' ELSE 'knowledge.replaced' END, 'society_knowledge_sources', _id::text, _soc, jsonb_build_object('version', _ver, 'mime', _mime));
  RETURN jsonb_build_object('id', _id, 'version', _ver, 'path', _path, 'old_path', _old);
END $$;

CREATE OR REPLACE FUNCTION public.knowledge_finish_document(_id uuid, _version integer, _status text, _text text, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._knowledge_admin_society();
BEGIN
  IF _status NOT IN ('ready','unsupported','failed') THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF _status = 'ready' AND char_length(coalesce(btrim(_text), '')) < 40 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  UPDATE public.society_knowledge_sources SET status = _status,
    extracted_text = CASE WHEN _status = 'ready' THEN left(_text, 120000) ELSE NULL END,
    text_chars = CASE WHEN _status = 'ready' THEN char_length(left(_text, 120000)) ELSE 0 END,
    status_reason = left(_reason, 300), updated_by = auth.uid(), updated_at = now()
  WHERE id = _id AND society_id = _soc AND version = _version AND status = 'processing';
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'stale'); END IF;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'knowledge.processed', 'society_knowledge_sources', _id::text, _soc, jsonb_build_object('result', _status, 'version', _version));
  RETURN jsonb_build_object('status', _status);
END $$;

CREATE OR REPLACE FUNCTION public.knowledge_upsert_faq(_id uuid, _question text, _answer text, _audience text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._knowledge_admin_society(); _new uuid;
BEGIN
  IF char_length(btrim(coalesce(_answer,''))) < 5 OR char_length(_answer) > 4000 OR _audience NOT IN ('residents','committee') THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF _id IS NULL THEN
    IF (SELECT count(*) FROM public.society_knowledge_sources WHERE society_id = _soc) >= 200 THEN RAISE EXCEPTION 'limit_reached'; END IF;
    INSERT INTO public.society_knowledge_sources(society_id, kind, title, audience, faq_answer, status, extracted_text, text_chars, created_by, updated_by)
    VALUES (_soc, 'faq', btrim(_question), _audience, btrim(_answer), 'ready', btrim(_answer), char_length(btrim(_answer)), auth.uid(), auth.uid()) RETURNING id INTO _new;
  ELSE
    UPDATE public.society_knowledge_sources SET title = btrim(_question), faq_answer = btrim(_answer), extracted_text = btrim(_answer),
      text_chars = char_length(btrim(_answer)), audience = _audience, version = version + 1, updated_by = auth.uid(), updated_at = now()
    WHERE id = _id AND society_id = _soc AND kind = 'faq' RETURNING id INTO _new;
    IF _new IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  END IF;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), CASE WHEN _id IS NULL THEN 'knowledge.faq_created' ELSE 'knowledge.faq_updated' END, 'society_knowledge_sources', _new::text, _soc, '{}'::jsonb);
  RETURN jsonb_build_object('id', _new);
END $$;

CREATE OR REPLACE FUNCTION public.knowledge_set_archived(_id uuid, _archived boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._knowledge_admin_society(); _row public.society_knowledge_sources;
BEGIN
  SELECT * INTO _row FROM public.society_knowledge_sources WHERE id = _id AND society_id = _soc FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF _archived THEN
    IF _row.status <> 'ready' THEN RAISE EXCEPTION 'invalid_transition'; END IF;
    UPDATE public.society_knowledge_sources SET status = 'archived', archived_at = now(), updated_by = auth.uid(), updated_at = now() WHERE id = _id;
  ELSE
    IF _row.status <> 'archived' OR coalesce(_row.text_chars, 0) = 0 THEN RAISE EXCEPTION 'invalid_transition'; END IF;
    UPDATE public.society_knowledge_sources SET status = 'ready', archived_at = NULL, updated_by = auth.uid(), updated_at = now() WHERE id = _id;
  END IF;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), CASE WHEN _archived THEN 'knowledge.archived' ELSE 'knowledge.restored' END, 'society_knowledge_sources', _id::text, _soc, '{}'::jsonb);
  RETURN jsonb_build_object('status', CASE WHEN _archived THEN 'archived' ELSE 'ready' END);
END $$;

CREATE OR REPLACE FUNCTION public.knowledge_delete(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._knowledge_admin_society(); _path text; _title text;
BEGIN
  DELETE FROM public.society_knowledge_sources WHERE id = _id AND society_id = _soc RETURNING storage_path, title INTO _path, _title;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'knowledge.removed', 'society_knowledge_sources', _id::text, _soc, jsonb_build_object('title', _title));
  RETURN jsonb_build_object('path', _path);
END $$;

CREATE OR REPLACE FUNCTION public.knowledge_document_path(_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT storage_path FROM public.society_knowledge_sources s
  WHERE s.id = _id AND s.kind = 'document' AND s.storage_path IS NOT NULL
    AND (public.is_society_admin_for(auth.uid(), s.society_id)
         OR (s.status = 'ready' AND s.audience = 'residents' AND public.society_has_access(s.society_id)));
$$;

REVOKE ALL ON FUNCTION public.knowledge_begin_document(text,text,text,text,integer,text,uuid), public.knowledge_finish_document(uuid,integer,text,text,text),
  public.knowledge_upsert_faq(uuid,text,text,text), public.knowledge_set_archived(uuid,boolean), public.knowledge_delete(uuid), public.knowledge_document_path(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.knowledge_begin_document(text,text,text,text,integer,text,uuid), public.knowledge_finish_document(uuid,integer,text,text,text),
  public.knowledge_upsert_faq(uuid,text,text,text), public.knowledge_set_archived(uuid,boolean), public.knowledge_delete(uuid), public.knowledge_document_path(uuid) TO authenticated;