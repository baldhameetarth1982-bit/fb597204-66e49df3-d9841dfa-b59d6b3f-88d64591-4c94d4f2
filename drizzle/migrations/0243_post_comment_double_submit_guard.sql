CREATE OR REPLACE FUNCTION public._trg_block_duplicate_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.post_comments c
    WHERE c.post_id = NEW.post_id AND c.user_id = NEW.user_id
      AND c.body = NEW.body AND c.created_at > now() - interval '30 seconds'
  ) THEN
    RAISE EXCEPTION 'duplicate_submit' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._trg_block_duplicate_comment() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS block_duplicate_comment ON public.post_comments;
CREATE TRIGGER block_duplicate_comment BEFORE INSERT ON public.post_comments
FOR EACH ROW EXECUTE FUNCTION public._trg_block_duplicate_comment();
CREATE INDEX IF NOT EXISTS post_comments_post_user_created_idx ON public.post_comments (post_id, user_id, created_at DESC);