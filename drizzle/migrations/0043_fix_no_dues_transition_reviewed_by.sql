CREATE OR REPLACE FUNCTION public.transition_no_dues_request_internal(_actor_id uuid, _request_id uuid, _decision text, _notes text, _reason text)
 RETURNS TABLE(new_status no_dues_status, eligibility jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_req record;
  v_is_admin boolean;
  v_is_super boolean;
  v_elig jsonb;
  v_new no_dues_status;
  v_prev no_dues_status;
BEGIN
  IF _actor_id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;

  SELECT id, society_id, flat_id, requester_id, status INTO v_req
    FROM public.no_dues_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  v_prev := v_req.status;

  SELECT public.is_society_admin_for(_actor_id, v_req.society_id) INTO v_is_admin;
  SELECT public.is_super_admin(_actor_id) INTO v_is_super;

  IF _decision = 'approve' THEN
    IF NOT (COALESCE(v_is_admin,false) OR COALESCE(v_is_super,false)) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
    IF v_prev <> 'submitted'::no_dues_status THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
    v_elig := public.compute_no_dues_eligibility_internal(v_req.society_id, v_req.flat_id);
    IF (v_elig->>'eligible')::boolean THEN
      v_new := 'approved'::no_dues_status;
    ELSE
      v_new := 'blocked_by_dues'::no_dues_status;
    END IF;
    UPDATE public.no_dues_requests
      SET status = v_new, admin_notes = COALESCE(_notes, admin_notes),
          eligibility_snapshot = v_elig, reviewed_at = now(), reviewed_by = _actor_id
      WHERE id = _request_id;

  ELSIF _decision = 'reject' THEN
    IF NOT (COALESCE(v_is_admin,false) OR COALESCE(v_is_super,false)) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
    IF _reason IS NULL OR length(trim(_reason)) < 3 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
    IF v_prev <> 'submitted'::no_dues_status THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
    v_new := 'rejected'::no_dues_status;
    v_elig := public.compute_no_dues_eligibility_internal(v_req.society_id, v_req.flat_id);
    UPDATE public.no_dues_requests
      SET status = v_new, rejection_reason = _reason, admin_notes = COALESCE(_notes, admin_notes),
          reviewed_at = now(), reviewed_by = _actor_id
      WHERE id = _request_id;

  ELSIF _decision = 'resubmit' THEN
    IF v_req.requester_id <> _actor_id THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
    IF v_prev <> 'blocked_by_dues'::no_dues_status THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
    v_elig := public.compute_no_dues_eligibility_internal(v_req.society_id, v_req.flat_id);
    IF (v_elig->>'eligible')::boolean THEN
      v_new := 'submitted'::no_dues_status;
      UPDATE public.no_dues_requests SET status = v_new, eligibility_snapshot = v_elig WHERE id = _request_id;
    ELSE
      v_new := 'blocked_by_dues'::no_dues_status;
      UPDATE public.no_dues_requests SET eligibility_snapshot = v_elig WHERE id = _request_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;

  INSERT INTO public.no_dues_audit(request_id, society_id, actor_id, action, previous_status, new_status, metadata)
  VALUES (_request_id, v_req.society_id, _actor_id, _decision, v_prev, v_new,
          jsonb_build_object('eligibility', v_elig, 'notes', _notes, 'reason', _reason));

  RETURN QUERY SELECT v_new, v_elig;
END;
$function$;