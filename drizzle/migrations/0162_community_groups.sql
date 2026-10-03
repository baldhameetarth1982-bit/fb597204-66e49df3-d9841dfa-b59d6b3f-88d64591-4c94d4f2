CREATE TABLE public.community_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 80),
  description text CHECK (description IS NULL OR char_length(description) <= 1000),
  kind text NOT NULL DEFAULT 'interest' CHECK (kind IN ('interest','club','sports','hobby','committee','other')),
  join_policy text NOT NULL DEFAULT 'open' CHECK (join_policy IN ('open','approval')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX community_groups_name ON public.community_groups(society_id, lower(name)) WHERE status='active';
CREATE TABLE public.community_group_members (
  group_id uuid NOT NULL REFERENCES public.community_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('member','pending')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
GRANT SELECT ON public.community_groups, public.community_group_members TO authenticated;
GRANT ALL ON public.community_groups, public.community_group_members TO service_role;
ALTER TABLE public.community_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_group_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read groups" ON public.community_groups FOR SELECT TO authenticated
  USING (society_id = public._community_member_society() OR public.current_user_has_society_permission(society_id,'society.settings',NULL));
CREATE POLICY "Own membership or committee" ON public.community_group_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.community_groups g WHERE g.id=group_id AND public.current_user_has_society_permission(g.society_id,'society.settings',NULL)));

CREATE OR REPLACE FUNCTION public.group_counts(_ids uuid[])
RETURNS TABLE(group_id uuid, members int, pending int) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT m.group_id, count(*) FILTER (WHERE m.status='member')::int, count(*) FILTER (WHERE m.status='pending')::int
  FROM community_group_members m JOIN community_groups g ON g.id=m.group_id
  WHERE m.group_id = ANY(_ids) AND (g.society_id=_community_member_society() OR current_user_has_society_permission(g.society_id,'society.settings',NULL))
  GROUP BY m.group_id $$;

CREATE OR REPLACE FUNCTION public.admin_save_group(_society_id uuid, _name text, _description text, _kind text, _join_policy text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _id uuid;
BEGIN
  IF NOT current_user_has_society_permission(_society_id,'society.settings',NULL) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  INSERT INTO community_groups(society_id,name,description,kind,join_policy,created_by)
  VALUES (_society_id, trim(_name), NULLIF(trim(_description),''), _kind, _join_policy, auth.uid()) RETURNING id INTO _id;
  INSERT INTO audit_log(actor_id,action,target_table,target_id,society_id) VALUES (auth.uid(),'group.create','community_groups',_id::text,_society_id);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_group_action(_group_id uuid, _action text, _user_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _g community_groups;
BEGIN
  SELECT * INTO _g FROM community_groups WHERE id=_group_id FOR UPDATE;
  IF NOT FOUND OR NOT current_user_has_society_permission(_g.society_id,'society.settings',NULL) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  IF _action='archive' THEN UPDATE community_groups SET status='archived' WHERE id=_group_id;
  ELSIF _action='approve' THEN
    UPDATE community_group_members SET status='member' WHERE group_id=_group_id AND user_id=_user_id AND status='pending';
    IF FOUND THEN PERFORM _notify_user(_user_id,_g.society_id,'group','Joined '||_g.name,'Your request to join was approved.','/app/groups'); END IF;
  ELSIF _action IN ('reject','remove') THEN DELETE FROM community_group_members WHERE group_id=_group_id AND user_id=_user_id;
  ELSE RAISE EXCEPTION 'Unknown action'; END IF;
  INSERT INTO audit_log(actor_id,action,target_table,target_id,society_id,metadata)
  VALUES (auth.uid(),'group.'||_action,'community_groups',_group_id::text,_g.society_id,jsonb_build_object('user',_user_id));
END $$;

CREATE OR REPLACE FUNCTION public.group_membership(_group_id uuid, _join boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _g community_groups;
BEGIN
  SELECT * INTO _g FROM community_groups WHERE id=_group_id;
  IF NOT FOUND OR _g.society_id IS DISTINCT FROM _community_member_society() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  IF NOT _join THEN DELETE FROM community_group_members WHERE group_id=_group_id AND user_id=auth.uid(); RETURN 'none'; END IF;
  IF _g.status<>'active' THEN RAISE EXCEPTION 'This group is archived'; END IF;
  INSERT INTO community_group_members(group_id,user_id,status)
  VALUES (_group_id, auth.uid(), CASE WHEN _g.join_policy='open' THEN 'member' ELSE 'pending' END)
  ON CONFLICT (group_id,user_id) DO NOTHING;
  RETURN (SELECT status FROM community_group_members WHERE group_id=_group_id AND user_id=auth.uid());
END $$;

REVOKE ALL ON FUNCTION public.group_counts(uuid[]), public.admin_save_group(uuid,text,text,text,text), public.admin_group_action(uuid,text,uuid), public.group_membership(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.group_counts(uuid[]), public.admin_save_group(uuid,text,text,text,text), public.admin_group_action(uuid,text,uuid), public.group_membership(uuid,boolean) TO authenticated;