-- One-off charges and single-flat bills are not bill runs: mark them so the approval guard lets them through.
DO $m$
DECLARE p oid; d text; i int;
BEGIN
  FOR p IN SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('create_oneoff_bills','generate_flat_bill') LOOP
    d := pg_get_functiondef(p);
    i := position(E'\nBEGIN\n' IN d);
    IF i = 0 THEN RAISE EXCEPTION 'shape_changed %', p::regprocedure; END IF;
    d := overlay(d PLACING E'\nBEGIN\n  PERFORM set_config(''sociyohub.allow_unbatched_bill'', ''on'', true);\n' FROM i FOR 7);
    EXECUTE d;
  END LOOP;
END $m$;

CREATE OR REPLACE FUNCTION public._bills_require_approved_run()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.generation_batch_id IS NULL
     AND coalesce(current_setting('sociyohub.allow_unbatched_bill', true), '') <> 'on'
     AND EXISTS (SELECT 1 FROM society_settings WHERE society_id = NEW.society_id AND coalesce(bill_run_approval_required,false)) THEN
    RAISE EXCEPTION 'approval_required' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._bills_require_approved_run() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS trg_bills_require_approved_run ON public.bills;
CREATE TRIGGER trg_bills_require_approved_run BEFORE INSERT ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public._bills_require_approved_run();