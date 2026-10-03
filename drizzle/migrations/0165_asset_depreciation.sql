CREATE TABLE public.asset_depreciation_settings (
  asset_id uuid PRIMARY KEY REFERENCES public.society_assets(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  cost numeric(14,2) NOT NULL CHECK (cost > 0 AND cost <= 1000000000),
  salvage numeric(14,2) NOT NULL DEFAULT 0 CHECK (salvage >= 0),
  method text NOT NULL CHECK (method IN ('slm','wdv')),
  life_years integer CHECK (life_years IS NULL OR life_years BETWEEN 1 AND 60),
  wdv_rate numeric(5,2) CHECK (wdv_rate IS NULL OR (wdv_rate > 0 AND wdv_rate < 100)),
  start_date date NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (salvage < cost),
  CHECK ((method='slm' AND life_years IS NOT NULL) OR (method='wdv' AND wdv_rate IS NOT NULL))
);
CREATE INDEX asset_depreciation_society ON public.asset_depreciation_settings(society_id);
COMMENT ON TABLE public.asset_depreciation_settings IS 'Depreciation parameters per asset; schedule is computed for reporting only and never posted to the journal automatically.';
GRANT SELECT ON public.asset_depreciation_settings TO authenticated;
GRANT ALL ON public.asset_depreciation_settings TO service_role;
ALTER TABLE public.asset_depreciation_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance readers read depreciation" ON public.asset_depreciation_settings FOR SELECT TO authenticated
  USING (public._finance_reader_for(society_id));

CREATE OR REPLACE FUNCTION public.admin_set_asset_depreciation(_asset_id uuid, _cost numeric, _salvage numeric, _method text, _life_years integer, _wdv_rate numeric, _start_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sid uuid;
BEGIN
  SELECT society_id INTO _sid FROM society_assets WHERE id=_asset_id;
  IF _sid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  PERFORM public._finance_require_admin(_sid);
  IF _start_date IS NULL OR _start_date > current_date THEN RAISE EXCEPTION 'Start date cannot be in the future'; END IF;
  INSERT INTO asset_depreciation_settings(asset_id, society_id, cost, salvage, method, life_years, wdv_rate, start_date, updated_by, updated_at)
  VALUES (_asset_id, _sid, _cost, COALESCE(_salvage,0), _method,
          CASE WHEN _method='slm' THEN _life_years END, CASE WHEN _method='wdv' THEN _wdv_rate END, _start_date, auth.uid(), now())
  ON CONFLICT (asset_id) DO UPDATE SET cost=EXCLUDED.cost, salvage=EXCLUDED.salvage, method=EXCLUDED.method,
    life_years=EXCLUDED.life_years, wdv_rate=EXCLUDED.wdv_rate, start_date=EXCLUDED.start_date, updated_by=auth.uid(), updated_at=now();
  INSERT INTO audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'asset.depreciation_set', 'asset_depreciation_settings', _asset_id::text, _sid,
          jsonb_build_object('cost', _cost, 'salvage', _salvage, 'method', _method, 'life', _life_years, 'rate', _wdv_rate));
END $$;
REVOKE ALL ON FUNCTION public.admin_set_asset_depreciation(uuid,numeric,numeric,text,integer,numeric,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_asset_depreciation(uuid,numeric,numeric,text,integer,numeric,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_depreciation_assets(_society_id uuid)
RETURNS TABLE(asset_id uuid, name text, category text, status text, purchase_date date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._finance_reader_for(_society_id) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT a.id, a.name, a.category, a.status, a.purchase_date FROM society_assets a WHERE a.society_id=_society_id ORDER BY a.name LIMIT 1000;
END $$;
REVOKE ALL ON FUNCTION public.list_depreciation_assets(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_depreciation_assets(uuid) TO authenticated;