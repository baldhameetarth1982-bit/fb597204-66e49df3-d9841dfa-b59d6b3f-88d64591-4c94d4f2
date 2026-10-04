-- Former members (role deactivated, profile society kept) must not read or write
-- community content. Helper returns the caller's society only while they hold an active role there.
CREATE OR REPLACE FUNCTION public._active_member_society_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.society_id FROM public.profiles p
  WHERE p.id = auth.uid() AND p.society_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.user_roles ur
                WHERE ur.user_id = p.id AND ur.society_id = p.society_id AND COALESCE(ur.is_active, true))
$$;
REVOKE ALL ON FUNCTION public._active_member_society_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._active_member_society_id() TO authenticated;

-- Feed
DROP POLICY IF EXISTS "society members view posts" ON public.posts;
CREATE POLICY "society members view posts" ON public.posts FOR SELECT
  USING (society_id = public._active_member_society_id());
DROP POLICY IF EXISTS "users create own posts in own society" ON public.posts;
CREATE POLICY "users create own posts in own society" ON public.posts FOR INSERT
  WITH CHECK (author_id = auth.uid() AND society_id = public._active_member_society_id());
DROP POLICY IF EXISTS "society members view comments" ON public.post_comments;
CREATE POLICY "society members view comments" ON public.post_comments FOR SELECT
  USING (post_id IN (SELECT id FROM public.posts WHERE society_id = public._active_member_society_id()));
DROP POLICY IF EXISTS "users comment in their society" ON public.post_comments;
CREATE POLICY "users comment in their society" ON public.post_comments FOR INSERT
  WITH CHECK (user_id = auth.uid() AND post_id IN (SELECT id FROM public.posts WHERE society_id = public._active_member_society_id()));
DROP POLICY IF EXISTS "society members view reactions" ON public.post_reactions;
CREATE POLICY "society members view reactions" ON public.post_reactions FOR SELECT
  USING (post_id IN (SELECT id FROM public.posts WHERE society_id = public._active_member_society_id()));
DROP POLICY IF EXISTS "users react in their society" ON public.post_reactions;
CREATE POLICY "users react in their society" ON public.post_reactions FOR INSERT
  WITH CHECK (user_id = auth.uid() AND post_id IN (SELECT id FROM public.posts WHERE society_id = public._active_member_society_id()));

-- Polls / surveys
DROP POLICY IF EXISTS "society members view polls" ON public.polls;
CREATE POLICY "society members view polls" ON public.polls FOR SELECT
  USING (society_id = public._active_member_society_id() OR society_id IN (SELECT public.get_admin_society_ids(auth.uid())));
DROP POLICY IF EXISTS "society members view poll options" ON public.poll_options;
CREATE POLICY "society members view poll options" ON public.poll_options FOR SELECT
  USING (poll_id IN (SELECT id FROM public.polls WHERE society_id = public._active_member_society_id()));
DROP POLICY IF EXISTS "users cast their own vote" ON public.poll_votes;
CREATE POLICY "users cast their own vote" ON public.poll_votes FOR INSERT
  WITH CHECK (user_id = auth.uid() AND poll_id IN (
    SELECT id FROM public.polls WHERE status = 'open' AND (closes_at IS NULL OR closes_at > now())
      AND society_id = public._active_member_society_id()));
DROP POLICY IF EXISTS "members read survey questions" ON public.survey_questions;
CREATE POLICY "members read survey questions" ON public.survey_questions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.polls p WHERE p.id = survey_questions.poll_id AND p.society_id = survey_questions.society_id
    AND ((p.status <> 'draft' AND p.society_id = public._active_member_society_id()) OR public._can_manage_polls(p.society_id))));

-- Every vote/response path (RPC or direct) re-checks active membership.
CREATE OR REPLACE FUNCTION public._require_active_member_vote()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid;
BEGIN
  IF TG_TABLE_NAME = 'poll_votes' THEN SELECT society_id INTO _soc FROM public.polls WHERE id = NEW.poll_id;
  ELSE _soc := NEW.society_id; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = NEW.user_id AND ur.society_id = _soc
                 AND COALESCE(ur.is_active, true) AND ur.role IN ('resident','society_admin','block_admin')) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._require_active_member_vote() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_poll_votes_active_member ON public.poll_votes;
CREATE TRIGGER trg_poll_votes_active_member BEFORE INSERT ON public.poll_votes
  FOR EACH ROW EXECUTE FUNCTION public._require_active_member_vote();
DROP TRIGGER IF EXISTS trg_survey_responses_active_member ON public.survey_responses;
CREATE TRIGGER trg_survey_responses_active_member BEFORE INSERT ON public.survey_responses
  FOR EACH ROW EXECUTE FUNCTION public._require_active_member_vote();

-- Other community reads
DROP POLICY IF EXISTS "society members view digests" ON public.community_digests;
CREATE POLICY "society members view digests" ON public.community_digests FOR SELECT
  USING (society_id = public._active_member_society_id());
DROP POLICY IF EXISTS "society members view achievements" ON public.achievements;
CREATE POLICY "society members view achievements" ON public.achievements FOR SELECT
  USING (society_id = public._active_member_society_id());
DROP POLICY IF EXISTS election_nominations_read ON public.election_nominations;
CREATE POLICY election_nominations_read ON public.election_nominations FOR SELECT TO authenticated
  USING (society_id = public._active_member_society_id() AND (
    public.is_society_admin_for(auth.uid(), society_id) OR candidate_id = auth.uid()
    OR (status = 'approved' AND EXISTS (SELECT 1 FROM public.elections e WHERE e.id = election_nominations.election_id
        AND e.status IN ('nomination_review','voting_open','voting_closed','results_published','archived')))));

-- Storage: post images readable only by active members; branding writes only by active admins.
DROP POLICY IF EXISTS "posts society members read" ON storage.objects;
CREATE POLICY "posts society members read" ON storage.objects FOR SELECT
  USING (bucket_id = 'posts' AND EXISTS (SELECT 1 FROM public.profiles owner
    WHERE owner.id::text = (storage.foldername(objects.name))[1] AND owner.society_id = public._active_member_society_id()));
DROP POLICY IF EXISTS branding_read_members ON storage.objects;
CREATE POLICY branding_read_members ON storage.objects FOR SELECT
  USING (bucket_id = 'branding' AND (public.is_super_admin(auth.uid()) OR EXISTS (SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND COALESCE(ur.is_active, true) AND ur.society_id::text = (storage.foldername(objects.name))[1])));
DROP POLICY IF EXISTS branding_write_admin ON storage.objects;
CREATE POLICY branding_write_admin ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'branding'
    AND lower(storage.extension(name)) IN ('jpg','jpeg','png','webp','gif')
    AND lower(COALESCE(metadata->>'mimetype','')) IN ('image/jpeg','image/png','image/webp','image/gif')
    AND (public.has_role(auth.uid(),'super_admin') OR EXISTS (SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND COALESCE(ur.is_active, true) AND ur.role IN ('society_admin','block_admin')
        AND ur.society_id::text = (storage.foldername(objects.name))[1])));
DROP POLICY IF EXISTS branding_update_admin ON storage.objects;
CREATE POLICY branding_update_admin ON storage.objects FOR UPDATE
  USING (bucket_id = 'branding' AND (public.has_role(auth.uid(),'super_admin') OR EXISTS (SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND COALESCE(ur.is_active, true) AND ur.role IN ('society_admin','block_admin')
        AND ur.society_id::text = (storage.foldername(objects.name))[1])));
DROP POLICY IF EXISTS branding_delete_admin ON storage.objects;
CREATE POLICY branding_delete_admin ON storage.objects FOR DELETE
  USING (bucket_id = 'branding' AND (public.has_role(auth.uid(),'super_admin') OR EXISTS (SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND COALESCE(ur.is_active, true) AND ur.role IN ('society_admin','block_admin')
        AND ur.society_id::text = (storage.foldername(objects.name))[1])));

-- Groups: complete join/decline/leave/archive lifecycle with notifications and audit.
CREATE OR REPLACE FUNCTION public.admin_group_action(_group_id uuid, _action text, _user_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _g community_groups; _n int; r record;
BEGIN
  SELECT * INTO _g FROM community_groups WHERE id = _group_id FOR UPDATE;
  IF NOT FOUND OR NOT current_user_has_society_permission(_g.society_id, 'society.settings', NULL) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _action = 'archive' THEN
    IF _g.status = 'archived' THEN RAISE EXCEPTION 'This group is already archived'; END IF;
    UPDATE community_groups SET status = 'archived' WHERE id = _group_id;
    FOR r IN SELECT user_id, status FROM community_group_members WHERE group_id = _group_id LOOP
      BEGIN
        PERFORM _notify_user(r.user_id, _g.society_id, 'group', 'Group archived: ' || _g.name,
          CASE WHEN r.status = 'pending' THEN 'Your request to join was closed because the group was archived.'
               ELSE 'The committee archived this group.' END, '/app/groups');
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
    DELETE FROM community_group_members WHERE group_id = _group_id AND status = 'pending';
  ELSIF _action IN ('approve','reject','remove') THEN
    IF _user_id IS NULL THEN RAISE EXCEPTION 'Choose a person'; END IF;
    IF _action = 'approve' THEN
      IF _g.status <> 'active' THEN RAISE EXCEPTION 'This group is archived'; END IF;
      UPDATE community_group_members SET status = 'member' WHERE group_id = _group_id AND user_id = _user_id AND status = 'pending';
    ELSE
      DELETE FROM community_group_members WHERE group_id = _group_id AND user_id = _user_id
        AND status = CASE WHEN _action = 'reject' THEN 'pending' ELSE 'member' END;
    END IF;
    GET DIAGNOSTICS _n = ROW_COUNT;
    IF _n = 0 THEN RAISE EXCEPTION 'This request was already handled'; END IF;
    BEGIN
      PERFORM _notify_user(_user_id, _g.society_id, 'group',
        CASE _action WHEN 'approve' THEN 'Joined ' || _g.name WHEN 'reject' THEN 'Request declined: ' || _g.name ELSE 'Removed from ' || _g.name END,
        CASE _action WHEN 'approve' THEN 'Your request to join was approved.' WHEN 'reject' THEN 'The committee declined your request to join.' ELSE 'The committee removed you from this group.' END,
        '/app/groups');
    EXCEPTION WHEN OTHERS THEN NULL; END;
  ELSE RAISE EXCEPTION 'Unknown action'; END IF;
  INSERT INTO audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'group.' || _action, 'community_groups', _group_id::text, _g.society_id, jsonb_build_object('user', _user_id));
END $$;

CREATE OR REPLACE FUNCTION public.group_membership(_group_id uuid, _join boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _g community_groups; _prev text; _now text; _rl record;
BEGIN
  SELECT * INTO _g FROM community_groups WHERE id = _group_id;
  IF NOT FOUND OR _g.society_id IS DISTINCT FROM _community_member_society() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _rl FROM touch_rate_limit('group_membership', auth.uid()::text, 30, 3600);
  IF NOT _rl.allowed THEN RAISE EXCEPTION 'Too many changes. Try again later.'; END IF;
  SELECT status INTO _prev FROM community_group_members WHERE group_id = _group_id AND user_id = auth.uid();
  IF NOT _join THEN
    IF _prev IS NULL THEN RETURN 'none'; END IF;
    DELETE FROM community_group_members WHERE group_id = _group_id AND user_id = auth.uid();
    INSERT INTO audit_log(actor_id, action, target_table, target_id, society_id)
    VALUES (auth.uid(), CASE WHEN _prev = 'pending' THEN 'group.withdraw' ELSE 'group.leave' END, 'community_groups', _group_id::text, _g.society_id);
    RETURN 'none';
  END IF;
  IF _g.status <> 'active' THEN RAISE EXCEPTION 'This group is archived'; END IF;
  IF _prev IS NOT NULL THEN RETURN _prev; END IF;
  _now := CASE WHEN _g.join_policy = 'open' THEN 'member' ELSE 'pending' END;
  INSERT INTO community_group_members(group_id, user_id, status) VALUES (_group_id, auth.uid(), _now)
  ON CONFLICT (group_id, user_id) DO NOTHING;
  INSERT INTO audit_log(actor_id, action, target_table, target_id, society_id)
  VALUES (auth.uid(), CASE WHEN _now = 'pending' THEN 'group.request' ELSE 'group.join' END, 'community_groups', _group_id::text, _g.society_id);
  IF _now = 'pending' THEN
    BEGIN
      PERFORM _notify_society_admins(_g.society_id, 'group', 'Join request: ' || _g.name,
        'A resident asked to join this group.', '/society/groups');
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  RETURN _now;
END $$;
REVOKE ALL ON FUNCTION public.admin_group_action(uuid,text,uuid), public.group_membership(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_group_action(uuid,text,uuid), public.group_membership(uuid,boolean) TO authenticated;