CREATE OR REPLACE FUNCTION public._bills_schedule_no_duplicate()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.cycle_config_id IS NOT NULL OR NEW.generation_batch_id IS NOT NULL
     OR NEW.period_start IS NULL OR NEW.flat_id IS NULL
     OR COALESCE(NEW.status,'') = 'cancelled' THEN
    RETURN NEW;
  END IF;
  -- Serialise concurrent schedule runs for the same home + period.
  PERFORM pg_advisory_xact_lock(hashtextextended('bill_sched:' || NEW.society_id::text || ':' || NEW.flat_id::text || ':' || NEW.period_start::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.bills b
    WHERE b.society_id = NEW.society_id AND b.flat_id = NEW.flat_id
      AND b.period_start = NEW.period_start
      AND COALESCE(b.status,'') <> 'cancelled'
      AND b.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'duplicate_bill_for_period' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bills_schedule_no_duplicate ON public.bills;
CREATE TRIGGER trg_bills_schedule_no_duplicate
BEFORE INSERT ON public.bills
FOR EACH ROW EXECUTE FUNCTION public._bills_schedule_no_duplicate();