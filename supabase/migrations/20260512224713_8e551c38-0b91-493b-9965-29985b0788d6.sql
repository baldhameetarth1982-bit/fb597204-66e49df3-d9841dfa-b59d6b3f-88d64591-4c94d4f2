
-- ============ VISITORS ============
CREATE TABLE public.visitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  flat_id uuid,
  flat_number text,
  visitor_name text NOT NULL,
  phone text,
  vehicle_number text,
  purpose text,
  entry_at timestamptz NOT NULL DEFAULT now(),
  exit_at timestamptz,
  logged_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_visitors_society ON public.visitors(society_id, entry_at DESC);
CREATE INDEX idx_visitors_flat ON public.visitors(flat_id);
ALTER TABLE public.visitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guards & admins manage visitors in their society"
ON public.visitors FOR ALL TO authenticated
USING (
  society_id IN (
    SELECT ur.society_id FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('society_admin','security','block_admin')
      AND ur.society_id IS NOT NULL
  )
)
WITH CHECK (
  society_id IN (
    SELECT ur.society_id FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('society_admin','security','block_admin')
      AND ur.society_id IS NOT NULL
  )
);

CREATE POLICY "residents view visitors for their flats"
ON public.visitors FOR SELECT TO authenticated
USING (
  flat_id IN (SELECT flat_id FROM public.flat_residents WHERE user_id = auth.uid())
);

CREATE POLICY "super admin all visitors"
ON public.visitors FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'super_admin'));

-- ============ POLLS ============
CREATE TABLE public.polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open', -- open | closed
  closes_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.poll_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  label text NOT NULL,
  position int NOT NULL DEFAULT 0
);
CREATE TABLE public.poll_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES public.poll_options(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poll_id, user_id)
);
CREATE INDEX idx_poll_options_poll ON public.poll_options(poll_id);
CREATE INDEX idx_poll_votes_poll ON public.poll_votes(poll_id);

ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;

-- polls
CREATE POLICY "society members view polls"
ON public.polls FOR SELECT TO authenticated
USING (
  society_id IN (SELECT society_id FROM public.profiles WHERE id = auth.uid())
  OR society_id IN (SELECT society_id FROM public.user_roles WHERE user_id = auth.uid() AND society_id IS NOT NULL)
);
CREATE POLICY "society admins manage polls"
ON public.polls FOR ALL TO authenticated
USING (
  society_id IN (SELECT society_id FROM public.user_roles WHERE user_id = auth.uid() AND role = 'society_admin')
)
WITH CHECK (
  society_id IN (SELECT society_id FROM public.user_roles WHERE user_id = auth.uid() AND role = 'society_admin')
);

-- options
CREATE POLICY "society members view poll options"
ON public.poll_options FOR SELECT TO authenticated
USING (
  poll_id IN (SELECT id FROM public.polls)
);
CREATE POLICY "society admins manage poll options"
ON public.poll_options FOR ALL TO authenticated
USING (
  poll_id IN (
    SELECT p.id FROM public.polls p
    WHERE p.society_id IN (SELECT society_id FROM public.user_roles WHERE user_id = auth.uid() AND role = 'society_admin')
  )
)
WITH CHECK (
  poll_id IN (
    SELECT p.id FROM public.polls p
    WHERE p.society_id IN (SELECT society_id FROM public.user_roles WHERE user_id = auth.uid() AND role = 'society_admin')
  )
);

-- votes
CREATE POLICY "society members view votes"
ON public.poll_votes FOR SELECT TO authenticated
USING (
  poll_id IN (SELECT id FROM public.polls)
);
CREATE POLICY "users cast their own vote"
ON public.poll_votes FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND poll_id IN (
    SELECT p.id FROM public.polls p
    WHERE p.status = 'open'
      AND p.society_id IN (SELECT society_id FROM public.profiles WHERE id = auth.uid())
  )
);

CREATE TRIGGER trg_polls_updated BEFORE UPDATE ON public.polls
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ LEDGER ============
CREATE TABLE public.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL,
  entry_date date NOT NULL DEFAULT (now()::date),
  kind text NOT NULL CHECK (kind IN ('income','expense')),
  category text,
  description text,
  amount numeric NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ledger_society_date ON public.ledger_entries(society_id, entry_date DESC);
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "society admins manage ledger"
ON public.ledger_entries FOR ALL TO authenticated
USING (
  society_id IN (SELECT society_id FROM public.user_roles WHERE user_id = auth.uid() AND role = 'society_admin')
)
WITH CHECK (
  society_id IN (SELECT society_id FROM public.user_roles WHERE user_id = auth.uid() AND role = 'society_admin')
);
CREATE POLICY "society members view ledger"
ON public.ledger_entries FOR SELECT TO authenticated
USING (
  society_id IN (SELECT society_id FROM public.profiles WHERE id = auth.uid())
);
CREATE POLICY "super admin ledger"
ON public.ledger_entries FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'super_admin'));

CREATE TRIGGER trg_ledger_updated BEFORE UPDATE ON public.ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ VEHICLES ============
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  society_id uuid NOT NULL,
  flat_id uuid,
  plate_number text NOT NULL,
  make_model text,
  color text,
  type text NOT NULL DEFAULT 'car', -- car | bike | other
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_vehicles_society_plate ON public.vehicles(society_id, plate_number);
CREATE INDEX idx_vehicles_user ON public.vehicles(user_id);
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own vehicles"
ON public.vehicles FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "guards & admins view society vehicles"
ON public.vehicles FOR SELECT TO authenticated
USING (
  society_id IN (
    SELECT society_id FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('society_admin','security','block_admin')
      AND society_id IS NOT NULL
  )
);

CREATE POLICY "super admin vehicles"
ON public.vehicles FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'super_admin'));

CREATE TRIGGER trg_vehicles_updated BEFORE UPDATE ON public.vehicles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
