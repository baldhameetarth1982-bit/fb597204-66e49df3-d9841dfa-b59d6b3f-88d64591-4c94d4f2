
-- Stage 1E — Authoritative SQL income reporting + manual reconciliation foundation.

-- 1. Reconciliation columns (additive, nullable). Verification remains separate.
ALTER TABLE public.society_income_records
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciled_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reconciliation_reference TEXT,
  ADD COLUMN IF NOT EXISTS reconciliation_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_society_income_records_society_payment_date
  ON public.society_income_records (society_id, payment_date DESC);

-- 2. Authoritative income report RPC (SQL-aggregated, society-scoped).
CREATE OR REPLACE FUNCTION public.get_society_income_report(
  _society_id UUID,
  _from_date DATE,
  _to_date DATE,
  _category_id UUID DEFAULT NULL,
  _payment_method TEXT DEFAULT NULL,
  _verification_status TEXT DEFAULT NULL,
  _reconciliation_status TEXT DEFAULT NULL,
  _payer_kind TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _plan_row RECORD;
  _plan_id TEXT;
  _plan_status TEXT;
  _trial_ends TIMESTAMPTZ;
  _days INT;
  _bucket TEXT;
  _summary JSONB;
  _by_category JSONB;
  _by_method JSONB;
  _by_recon JSONB;
  _by_verif JSONB;
  _by_kind JSONB;
  _trend JSONB;
  _row_count BIGINT;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;
  IF _society_id IS NULL OR _from_date IS NULL OR _to_date IS NULL THEN
    RETURN jsonb_build_object('status','invalid_input');
  END IF;
  IF _from_date > _to_date THEN
    RETURN jsonb_build_object('status','invalid_input');
  END IF;
  _days := (_to_date - _from_date);
  IF _days > 366 THEN
    RETURN jsonb_build_object('status','invalid_input');
  END IF;

  IF NOT public.is_society_admin_for(_uid, _society_id) THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;

  SELECT plan_id, plan_status, trial_ends_at INTO _plan_row
    FROM public.societies WHERE id = _society_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;
  _plan_id := COALESCE(_plan_row.plan_id, 'basic');
  _plan_status := COALESCE(_plan_row.plan_status, '');
  _trial_ends := _plan_row.trial_ends_at;
  IF NOT (
    _plan_id IN ('pro','premium')
    OR (_plan_id = 'trial' AND _trial_ends IS NOT NULL AND _trial_ends > now())
    OR (_plan_status IN ('trial','trialing') AND _trial_ends IS NOT NULL AND _trial_ends > now())
  ) THEN
    RETURN jsonb_build_object('status','plan_required');
  END IF;

  -- optional category cross-society guard
  IF _category_id IS NOT NULL THEN
    PERFORM 1 FROM public.society_income_categories
      WHERE id = _category_id AND society_id = _society_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status','invalid_input');
    END IF;
  END IF;

  IF _days <= 62 THEN _bucket := 'day'; ELSE _bucket := 'month'; END IF;

  WITH filtered AS (
    SELECT * FROM public.society_income_records r
    WHERE r.society_id = _society_id
      AND r.payment_date >= _from_date
      AND r.payment_date <= _to_date
      AND (_category_id IS NULL OR r.category_id = _category_id)
      AND (_payment_method IS NULL OR r.payment_method = _payment_method)
      AND (_verification_status IS NULL OR r.verification_status = _verification_status)
      AND (_reconciliation_status IS NULL OR r.reconciliation_status = _reconciliation_status)
      AND (_payer_kind IS NULL OR r.payer_kind = _payer_kind)
  )
  SELECT
    jsonb_build_object(
      'record_count', COUNT(*),
      'total_amount', COALESCE(SUM(amount), 0),
      'verified_amount', COALESCE(SUM(amount) FILTER (WHERE verification_status = 'verified'), 0),
      'pending_amount', COALESCE(SUM(amount) FILTER (WHERE verification_status = 'pending'), 0),
      'rejected_amount', COALESCE(SUM(amount) FILTER (WHERE verification_status = 'rejected'), 0),
      'reversed_amount', COALESCE(SUM(amount) FILTER (WHERE verification_status = 'reversed'), 0),
      'reconciled_amount', COALESCE(SUM(amount) FILTER (WHERE reconciliation_status = 'matched' AND verification_status = 'verified'), 0),
      'unreconciled_amount', COALESCE(SUM(amount) FILTER (WHERE reconciliation_status = 'unreconciled' AND verification_status = 'verified'), 0),
      'verified_count', COUNT(*) FILTER (WHERE verification_status = 'verified'),
      'pending_count', COUNT(*) FILTER (WHERE verification_status = 'pending'),
      'rejected_count', COUNT(*) FILTER (WHERE verification_status = 'rejected'),
      'reversed_count', COUNT(*) FILTER (WHERE verification_status = 'reversed'),
      'reconciled_count', COUNT(*) FILTER (WHERE reconciliation_status = 'matched'),
      'unreconciled_count', COUNT(*) FILTER (WHERE reconciliation_status = 'unreconciled')
    ),
    COUNT(*)
  INTO _summary, _row_count FROM filtered;

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO _by_category FROM (
    SELECT jsonb_build_object(
      'category_id', f.category_id,
      'display_name', c.display_name,
      'amount', COALESCE(SUM(f.amount) FILTER (WHERE f.verification_status = 'verified'), 0),
      'count', COUNT(*)
    ) AS x
    FROM public.society_income_records f
    LEFT JOIN public.society_income_categories c ON c.id = f.category_id
    WHERE f.society_id = _society_id
      AND f.payment_date BETWEEN _from_date AND _to_date
      AND (_category_id IS NULL OR f.category_id = _category_id)
      AND (_payment_method IS NULL OR f.payment_method = _payment_method)
      AND (_verification_status IS NULL OR f.verification_status = _verification_status)
      AND (_reconciliation_status IS NULL OR f.reconciliation_status = _reconciliation_status)
      AND (_payer_kind IS NULL OR f.payer_kind = _payer_kind)
    GROUP BY f.category_id, c.display_name
    ORDER BY SUM(f.amount) DESC NULLS LAST
    LIMIT 50
  ) t;

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO _by_method FROM (
    SELECT jsonb_build_object(
      'payment_method', payment_method,
      'amount', COALESCE(SUM(amount) FILTER (WHERE verification_status = 'verified'), 0),
      'count', COUNT(*)
    ) AS x
    FROM public.society_income_records
    WHERE society_id = _society_id
      AND payment_date BETWEEN _from_date AND _to_date
      AND (_category_id IS NULL OR category_id = _category_id)
      AND (_payment_method IS NULL OR payment_method = _payment_method)
      AND (_verification_status IS NULL OR verification_status = _verification_status)
      AND (_reconciliation_status IS NULL OR reconciliation_status = _reconciliation_status)
      AND (_payer_kind IS NULL OR payer_kind = _payer_kind)
    GROUP BY payment_method
  ) t;

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO _by_recon FROM (
    SELECT jsonb_build_object(
      'reconciliation_status', reconciliation_status,
      'count', COUNT(*),
      'amount', COALESCE(SUM(amount), 0)
    ) AS x
    FROM public.society_income_records
    WHERE society_id = _society_id
      AND payment_date BETWEEN _from_date AND _to_date
      AND (_category_id IS NULL OR category_id = _category_id)
      AND (_payment_method IS NULL OR payment_method = _payment_method)
      AND (_verification_status IS NULL OR verification_status = _verification_status)
      AND (_payer_kind IS NULL OR payer_kind = _payer_kind)
    GROUP BY reconciliation_status
  ) t;

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO _by_verif FROM (
    SELECT jsonb_build_object(
      'verification_status', verification_status,
      'count', COUNT(*),
      'amount', COALESCE(SUM(amount), 0)
    ) AS x
    FROM public.society_income_records
    WHERE society_id = _society_id
      AND payment_date BETWEEN _from_date AND _to_date
      AND (_category_id IS NULL OR category_id = _category_id)
      AND (_payment_method IS NULL OR payment_method = _payment_method)
      AND (_reconciliation_status IS NULL OR reconciliation_status = _reconciliation_status)
      AND (_payer_kind IS NULL OR payer_kind = _payer_kind)
    GROUP BY verification_status
  ) t;

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO _by_kind FROM (
    SELECT jsonb_build_object(
      'payer_kind', payer_kind,
      'count', COUNT(*),
      'amount', COALESCE(SUM(amount) FILTER (WHERE verification_status = 'verified'), 0)
    ) AS x
    FROM public.society_income_records
    WHERE society_id = _society_id
      AND payment_date BETWEEN _from_date AND _to_date
      AND (_category_id IS NULL OR category_id = _category_id)
      AND (_payment_method IS NULL OR payment_method = _payment_method)
      AND (_verification_status IS NULL OR verification_status = _verification_status)
      AND (_reconciliation_status IS NULL OR reconciliation_status = _reconciliation_status)
    GROUP BY payer_kind
  ) t;

  IF _bucket = 'day' THEN
    SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'bucket') ASC), '[]'::jsonb) INTO _trend FROM (
      SELECT jsonb_build_object(
        'bucket', to_char(date_trunc('day', payment_date::timestamp), 'YYYY-MM-DD'),
        'amount', COALESCE(SUM(amount) FILTER (WHERE verification_status = 'verified'), 0),
        'count', COUNT(*)
      ) AS x
      FROM public.society_income_records
      WHERE society_id = _society_id
        AND payment_date BETWEEN _from_date AND _to_date
        AND (_category_id IS NULL OR category_id = _category_id)
        AND (_payment_method IS NULL OR payment_method = _payment_method)
        AND (_verification_status IS NULL OR verification_status = _verification_status)
        AND (_reconciliation_status IS NULL OR reconciliation_status = _reconciliation_status)
        AND (_payer_kind IS NULL OR payer_kind = _payer_kind)
      GROUP BY date_trunc('day', payment_date::timestamp)
    ) t;
  ELSE
    SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'bucket') ASC), '[]'::jsonb) INTO _trend FROM (
      SELECT jsonb_build_object(
        'bucket', to_char(date_trunc('month', payment_date::timestamp), 'YYYY-MM'),
        'amount', COALESCE(SUM(amount) FILTER (WHERE verification_status = 'verified'), 0),
        'count', COUNT(*)
      ) AS x
      FROM public.society_income_records
      WHERE society_id = _society_id
        AND payment_date BETWEEN _from_date AND _to_date
        AND (_category_id IS NULL OR category_id = _category_id)
        AND (_payment_method IS NULL OR payment_method = _payment_method)
        AND (_verification_status IS NULL OR verification_status = _verification_status)
        AND (_reconciliation_status IS NULL OR reconciliation_status = _reconciliation_status)
        AND (_payer_kind IS NULL OR payer_kind = _payer_kind)
      GROUP BY date_trunc('month', payment_date::timestamp)
    ) t;
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'from_date', _from_date,
    'to_date', _to_date,
    'trend_bucket', _bucket,
    'summary', _summary,
    'by_category', _by_category,
    'by_method', _by_method,
    'by_reconciliation', _by_recon,
    'by_verification', _by_verif,
    'by_payer_kind', _by_kind,
    'trend', _trend
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_society_income_report(UUID, DATE, DATE, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_society_income_report(UUID, DATE, DATE, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- 3. Reconciliation transition RPC (transactional, audited).
CREATE OR REPLACE FUNCTION public.transition_income_reconciliation(
  _record_id UUID,
  _action TEXT,
  _reference TEXT DEFAULT NULL,
  _reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _r RECORD;
  _plan RECORD;
  _now TIMESTAMPTZ := now();
  _prev_recon TEXT;
  _next_recon TEXT;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;
  IF _action NOT IN ('reconcile','unreconcile') THEN
    RETURN jsonb_build_object('status','invalid_input');
  END IF;

  SELECT id, society_id, verification_status, reconciliation_status
    INTO _r
    FROM public.society_income_records
    WHERE id = _record_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_found');
  END IF;

  IF NOT public.is_society_admin_for(_uid, _r.society_id) THEN
    RETURN jsonb_build_object('status','not_found'); -- non-enumerating
  END IF;

  SELECT plan_id, plan_status, trial_ends_at INTO _plan
    FROM public.societies WHERE id = _r.society_id;
  IF NOT (
    COALESCE(_plan.plan_id, 'basic') IN ('pro','premium')
    OR (COALESCE(_plan.plan_id, '') = 'trial' AND _plan.trial_ends_at IS NOT NULL AND _plan.trial_ends_at > _now)
    OR (COALESCE(_plan.plan_status, '') IN ('trial','trialing') AND _plan.trial_ends_at IS NOT NULL AND _plan.trial_ends_at > _now)
  ) THEN
    RETURN jsonb_build_object('status','plan_required');
  END IF;

  _prev_recon := _r.reconciliation_status;

  IF _action = 'reconcile' THEN
    IF _r.verification_status <> 'verified' THEN
      RETURN jsonb_build_object('status','invalid_transition');
    END IF;
    IF _prev_recon = 'matched' THEN
      RETURN jsonb_build_object('status','already_processed','currentStatus','matched');
    END IF;
    IF _prev_recon NOT IN ('unreconciled','needs_review','partially_matched') THEN
      RETURN jsonb_build_object('status','invalid_transition');
    END IF;
    _next_recon := 'matched';
    UPDATE public.society_income_records SET
      reconciliation_status = _next_recon,
      reconciled_at = _now,
      reconciled_by = _uid,
      reconciliation_reference = NULLIF(btrim(COALESCE(_reference,'')), ''),
      reconciliation_reason = NULL,
      updated_at = _now
      WHERE id = _record_id;
  ELSE
    -- unreconcile
    IF _prev_recon <> 'matched' THEN
      IF _prev_recon = 'unreconciled' THEN
        RETURN jsonb_build_object('status','already_processed','currentStatus','unreconciled');
      END IF;
      RETURN jsonb_build_object('status','invalid_transition');
    END IF;
    IF _reason IS NULL OR btrim(_reason) = '' OR char_length(btrim(_reason)) < 5 THEN
      RETURN jsonb_build_object('status','invalid_input');
    END IF;
    _next_recon := 'unreconciled';
    UPDATE public.society_income_records SET
      reconciliation_status = _next_recon,
      reconciled_at = NULL,
      reconciled_by = NULL,
      reconciliation_reference = NULL,
      reconciliation_reason = btrim(_reason),
      updated_at = _now
      WHERE id = _record_id;
  END IF;

  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (
      _uid,
      'income_record.reconciliation.' || _action,
      'society_income_records',
      _record_id,
      _r.society_id,
      jsonb_build_object(
        'from', _prev_recon,
        'to', _next_recon,
        'reference', NULLIF(btrim(COALESCE(_reference,'')), ''),
        'reason', NULLIF(btrim(COALESCE(_reason,'')), '')
      )
    );

  RETURN jsonb_build_object(
    'status','success',
    'recordId', _record_id,
    'reconciliationStatus', _next_recon,
    'changedAt', to_json(_now)::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transition_income_reconciliation(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_income_reconciliation(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- 4. Paginated payer listing RPC — server-authoritative, safe projection.
CREATE OR REPLACE FUNCTION public.list_non_member_payers_page(
  _society_id UUID,
  _search TEXT DEFAULT NULL,
  _payer_type TEXT DEFAULT NULL,
  _active TEXT DEFAULT NULL,
  _limit INT DEFAULT 25,
  _offset INT DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _plan RECORD;
  _lim INT;
  _off INT;
  _items JSONB;
  _total BIGINT;
  _q TEXT;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;
  IF NOT public.is_society_admin_for(_uid, _society_id) THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;
  SELECT plan_id, plan_status, trial_ends_at INTO _plan
    FROM public.societies WHERE id = _society_id;
  IF NOT (
    COALESCE(_plan.plan_id, 'basic') IN ('pro','premium')
    OR (COALESCE(_plan.plan_id, '') = 'trial' AND _plan.trial_ends_at IS NOT NULL AND _plan.trial_ends_at > now())
    OR (COALESCE(_plan.plan_status, '') IN ('trial','trialing') AND _plan.trial_ends_at IS NOT NULL AND _plan.trial_ends_at > now())
  ) THEN
    RETURN jsonb_build_object('status','plan_required');
  END IF;

  _lim := LEAST(GREATEST(COALESCE(_limit, 25), 1), 100);
  _off := GREATEST(COALESCE(_offset, 0), 0);
  _q := lower(btrim(COALESCE(_search, '')));

  WITH matched AS (
    SELECT id, payer_type, display_name, organization_name, is_active, created_at
      FROM public.non_member_payers
      WHERE society_id = _society_id
        AND (_payer_type IS NULL OR payer_type = _payer_type)
        AND (
          _active IS NULL OR _active NOT IN ('active','inactive')
          OR (_active = 'active' AND is_active)
          OR (_active = 'inactive' AND NOT is_active)
        )
        AND (
          _q = '' OR
          lower(display_name) LIKE '%' || _q || '%' OR
          lower(COALESCE(organization_name, '')) LIKE '%' || _q || '%' OR
          lower(payer_type) LIKE '%' || _q || '%'
        )
  ),
  total_count AS (SELECT COUNT(*)::bigint AS c FROM matched),
  page AS (
    SELECT * FROM matched
      ORDER BY display_name ASC
      LIMIT _lim OFFSET _off
  )
  SELECT
    (SELECT c FROM total_count),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'payer_type', p.payer_type,
      'display_name', p.display_name,
      'organization_name', p.organization_name,
      'is_active', p.is_active,
      'created_at', p.created_at
    )), '[]'::jsonb)
    INTO _total, _items FROM page p;

  RETURN jsonb_build_object(
    'status','ok',
    'items', COALESCE(_items, '[]'::jsonb),
    'total', _total,
    'limit', _lim,
    'offset', _off,
    'has_next', (_off + _lim) < _total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_non_member_payers_page(UUID, TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_non_member_payers_page(UUID, TEXT, TEXT, TEXT, INT, INT) TO authenticated;
