-- Workstream 5: quotation/invoice evidence files. Private bucket, no storage policies; access via finance-admin RPCs.
CREATE TABLE public.procurement_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES public.procurement_requests(id) ON DELETE CASCADE,
  quotation_id uuid REFERENCES public.procurement_quotations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('quotation','invoice')),
  path text NOT NULL UNIQUE CHECK (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{32}\.(pdf|jpg|png|webp)$'),
  mime text NOT NULL CHECK (mime IN ('application/pdf','image/jpeg','image/png','image/webp')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 8 AND 5242880),
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 120 AND file_name !~ '[/\\<>:"|?*\x00-\x1f]'),
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz, removed_by uuid,
  remove_reason text CHECK (remove_reason IS NULL OR char_length(remove_reason) BETWEEN 5 AND 300),
  CHECK ((kind = 'quotation') = (quotation_id IS NOT NULL))
);
CREATE INDEX procurement_attachments_req_idx ON public.procurement_attachments(request_id, created_at);
GRANT SELECT ON public.procurement_attachments TO authenticated;
GRANT ALL ON public.procurement_attachments TO service_role;
ALTER TABLE public.procurement_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY proc_att_finance_read ON public.procurement_attachments FOR SELECT TO authenticated
  USING (public.resolve_financial_visibility(society_id) = 'admin' AND public._finance_plan_enabled(society_id));

-- Evidence is never deleted or rewritten; only a one-time soft removal with reason is allowed.
CREATE OR REPLACE FUNCTION public._proc_att_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'append_only' USING ERRCODE='22023'; END IF;
  IF OLD.removed_at IS NOT NULL OR NEW.removed_at IS NULL
     OR (NEW.id, NEW.society_id, NEW.request_id, NEW.quotation_id, NEW.kind, NEW.path, NEW.mime, NEW.size_bytes, NEW.file_name, NEW.uploaded_by, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.society_id, OLD.request_id, OLD.quotation_id, OLD.kind, OLD.path, OLD.mime, OLD.size_bytes, OLD.file_name, OLD.uploaded_by, OLD.created_at)
  THEN RAISE EXCEPTION 'append_only' USING ERRCODE='22023'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_proc_att_guard BEFORE UPDATE OR DELETE ON public.procurement_attachments FOR EACH ROW EXECUTE FUNCTION public._proc_att_guard();

-- State rule: quotation files only while quotations are editable; invoice files only between order and completion.
CREATE OR REPLACE FUNCTION public._proc_att_state_ok(_status text, _kind text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE _kind WHEN 'quotation' THEN _status IN ('draft','quotation_pending')
                    WHEN 'invoice' THEN _status IN ('ordered','invoice_received','payment_ref_recorded') ELSE false END $$;

-- Pre-upload check: server resolves the society from the record; returns it for path building.
CREATE OR REPLACE FUNCTION public.proc_attachment_target(_request uuid, _quotation uuid, _kind text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.procurement_requests;
BEGIN
  SELECT * INTO r FROM public.procurement_requests WHERE id = _request;
  IF r.id IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  PERFORM public._finance_require_admin(r.society_id);
  IF _kind = 'quotation' AND NOT EXISTS (SELECT 1 FROM public.procurement_quotations WHERE id = _quotation AND request_id = r.id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF _kind = 'invoice' AND _quotation IS NOT NULL THEN RAISE EXCEPTION 'invalid_file' USING ERRCODE='22023'; END IF;
  IF NOT public._proc_att_state_ok(r.status, _kind) THEN RAISE EXCEPTION 'locked' USING ERRCODE='22023'; END IF;
  RETURN r.society_id;
END $$;

CREATE OR REPLACE FUNCTION public.proc_record_attachment(_request uuid, _quotation uuid, _kind text, _path text, _mime text, _size int, _name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.procurement_requests := public._proc_lock(_request); uid uuid; nid uuid;
BEGIN
  uid := public._proc_auth(r.society_id);
  IF _kind = 'quotation' AND NOT EXISTS (SELECT 1 FROM public.procurement_quotations WHERE id = _quotation AND request_id = r.id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF _kind = 'invoice' AND _quotation IS NOT NULL THEN RAISE EXCEPTION 'invalid_file' USING ERRCODE='22023'; END IF;
  IF NOT public._proc_att_state_ok(r.status, _kind) THEN RAISE EXCEPTION 'locked' USING ERRCODE='22023'; END IF;
  IF split_part(_path,'/',1) <> r.society_id::text OR split_part(_path,'/',2) <> r.id::text THEN RAISE EXCEPTION 'invalid_file' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM public.procurement_attachments WHERE request_id = r.id AND removed_at IS NULL AND kind = _kind AND quotation_id IS NOT DISTINCT FROM _quotation) >= 5 THEN RAISE EXCEPTION 'too_many_files' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('procurement_upload', uid::text, 30, interval '1 hour');
  INSERT INTO public.procurement_attachments(society_id, request_id, quotation_id, kind, path, mime, size_bytes, file_name, uploaded_by)
  VALUES (r.society_id, r.id, _quotation, _kind, _path, _mime, _size, _name, uid) RETURNING id INTO nid;
  INSERT INTO public.procurement_events(society_id, request_id, actor_id, from_status, to_status, note) VALUES (r.society_id, r.id, uid, r.status, r.status, 'Attached ' || _kind || ' file');
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'procurement.attachment_added', 'procurement_requests', r.id::text, r.society_id, jsonb_build_object('attachment', nid, 'kind', _kind, 'quotation', _quotation, 'mime', _mime, 'size', _size));
  RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.proc_remove_attachment(_attachment uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a public.procurement_attachments; r public.procurement_requests; uid uuid; why text := public._proc_clean(_reason, 300);
BEGIN
  SELECT * INTO a FROM public.procurement_attachments WHERE id = _attachment;
  IF a.id IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  r := public._proc_lock(a.request_id);
  uid := public._proc_auth(r.society_id);
  IF a.removed_at IS NOT NULL THEN RETURN; END IF;
  IF why IS NULL OR char_length(why) < 5 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF NOT public._proc_att_state_ok(r.status, a.kind) THEN RAISE EXCEPTION 'locked' USING ERRCODE='22023'; END IF;
  UPDATE public.procurement_attachments SET removed_at = now(), removed_by = uid, remove_reason = why WHERE id = a.id;
  INSERT INTO public.procurement_events(society_id, request_id, actor_id, from_status, to_status, note) VALUES (r.society_id, r.id, uid, r.status, r.status, 'Removed ' || a.kind || ' file: ' || why);
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'procurement.attachment_removed', 'procurement_requests', r.id::text, r.society_id, jsonb_build_object('attachment', a.id, 'kind', a.kind, 'reason', why));
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['public.proc_attachment_target(uuid,uuid,text)','public.proc_record_attachment(uuid,uuid,text,text,text,int,text)','public.proc_remove_attachment(uuid,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  REVOKE ALL ON FUNCTION public._proc_att_state_ok(text,text) FROM PUBLIC, anon;
END $$;