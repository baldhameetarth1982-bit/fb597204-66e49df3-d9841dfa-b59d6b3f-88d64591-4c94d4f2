
-- ============= POSTS =============
CREATE TABLE public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  author_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_posts_society_created ON public.posts(society_id, created_at DESC);
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "society members view posts" ON public.posts FOR SELECT TO authenticated
USING (society_id IN (SELECT society_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "users create own posts in own society" ON public.posts FOR INSERT TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND society_id IN (SELECT society_id FROM public.profiles WHERE id = auth.uid())
);

CREATE POLICY "users update own posts" ON public.posts FOR UPDATE TO authenticated
USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());

CREATE POLICY "users delete own posts; admins delete society posts" ON public.posts FOR DELETE TO authenticated
USING (author_id = auth.uid() OR society_id IN (
  SELECT society_id FROM public.user_roles WHERE user_id = auth.uid() AND role = 'society_admin'
));

CREATE TRIGGER trg_posts_updated_at BEFORE UPDATE ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============= REACTIONS =============
CREATE TABLE public.post_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'like',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);
CREATE INDEX idx_reactions_post ON public.post_reactions(post_id);
ALTER TABLE public.post_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "society members view reactions" ON public.post_reactions FOR SELECT TO authenticated
USING (post_id IN (
  SELECT id FROM public.posts WHERE society_id IN (
    SELECT society_id FROM public.profiles WHERE id = auth.uid()
  )
));

CREATE POLICY "users react in their society" ON public.post_reactions FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND post_id IN (
  SELECT id FROM public.posts WHERE society_id IN (
    SELECT society_id FROM public.profiles WHERE id = auth.uid()
  )
));

CREATE POLICY "users remove own reaction" ON public.post_reactions FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- ============= COMMENTS =============
CREATE TABLE public.post_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_comments_post ON public.post_comments(post_id, created_at);
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "society members view comments" ON public.post_comments FOR SELECT TO authenticated
USING (post_id IN (
  SELECT id FROM public.posts WHERE society_id IN (
    SELECT society_id FROM public.profiles WHERE id = auth.uid()
  )
));

CREATE POLICY "users comment in their society" ON public.post_comments FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND post_id IN (
  SELECT id FROM public.posts WHERE society_id IN (
    SELECT society_id FROM public.profiles WHERE id = auth.uid()
  )
));

CREATE POLICY "users delete own comments" ON public.post_comments FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- ============= COMMUNITY DIGESTS =============
CREATE TABLE public.community_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  week_start date NOT NULL,
  summary text NOT NULL,
  highlights jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (society_id, week_start)
);
ALTER TABLE public.community_digests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "society members view digests" ON public.community_digests FOR SELECT TO authenticated
USING (society_id IN (SELECT society_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "society admins manage digests" ON public.community_digests FOR ALL TO authenticated
USING (society_id IN (
  SELECT society_id FROM public.user_roles WHERE user_id = auth.uid() AND role = 'society_admin'
)) WITH CHECK (society_id IN (
  SELECT society_id FROM public.user_roles WHERE user_id = auth.uid() AND role = 'society_admin'
));

-- ============= GAMIFICATION =============
CREATE TABLE public.user_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  society_id uuid NOT NULL,
  points int NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_points_society_user ON public.user_points(society_id, user_id);
ALTER TABLE public.user_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "society members view points" ON public.user_points FOR SELECT TO authenticated
USING (society_id IN (SELECT society_id FROM public.profiles WHERE id = auth.uid()));

CREATE TABLE public.achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  society_id uuid NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  description text,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, society_id, code)
);
CREATE INDEX idx_ach_society ON public.achievements(society_id);
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "society members view achievements" ON public.achievements FOR SELECT TO authenticated
USING (society_id IN (SELECT society_id FROM public.profiles WHERE id = auth.uid()));

-- Auto-award trigger for payments (on-time bonus)
CREATE OR REPLACE FUNCTION public.award_payment_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  bill_due date;
  bonus int := 10;
BEGIN
  IF NEW.user_id IS NULL OR NEW.status <> 'success' THEN
    RETURN NEW;
  END IF;
  SELECT due_date INTO bill_due FROM public.bills WHERE id = NEW.bill_id;
  IF bill_due IS NOT NULL AND NEW.paid_at::date <= bill_due THEN
    bonus := 25;
    INSERT INTO public.achievements (user_id, society_id, code, title, description)
    VALUES (NEW.user_id, NEW.society_id, 'on_time_payer',
            'On-Time Payer', 'Paid maintenance before the due date')
    ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.user_points (user_id, society_id, points, reason)
  VALUES (NEW.user_id, NEW.society_id, bonus, 'payment_made');
  RETURN NEW;
END $$;

CREATE TRIGGER trg_payment_points
AFTER INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.award_payment_points();

-- Award post points
CREATE OR REPLACE FUNCTION public.award_post_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_points (user_id, society_id, points, reason)
  VALUES (NEW.author_id, NEW.society_id, 2, 'post_created');
  RETURN NEW;
END $$;

CREATE TRIGGER trg_post_points
AFTER INSERT ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.award_post_points();

-- Leaderboard view
CREATE OR REPLACE VIEW public.society_leaderboard
WITH (security_invoker = true) AS
SELECT
  up.society_id,
  up.user_id,
  p.full_name,
  p.avatar_url,
  COALESCE(SUM(up.points), 0)::int AS total_points,
  COUNT(DISTINCT a.id)::int AS achievement_count
FROM public.user_points up
LEFT JOIN public.profiles p ON p.id = up.user_id
LEFT JOIN public.achievements a ON a.user_id = up.user_id AND a.society_id = up.society_id
GROUP BY up.society_id, up.user_id, p.full_name, p.avatar_url;

-- ============= TERMS ACCEPTANCE =============
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS accepted_terms_at timestamptz;

-- ============= STORAGE BUCKET =============
INSERT INTO storage.buckets (id, name, public)
VALUES ('posts', 'posts', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "post images publicly readable" ON storage.objects FOR SELECT
USING (bucket_id = 'posts');

CREATE POLICY "users upload own post images" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'posts' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "users delete own post images" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'posts' AND auth.uid()::text = (storage.foldername(name))[1]);
