ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_chk;
ALTER TABLE public.payments ADD CONSTRAINT payments_method_chk
  CHECK (method = ANY (ARRAY['cash'::text, 'bank_transfer'::text, 'razorpay'::text, 'manual'::text, 'online'::text, 'other_offline'::text])) NOT VALID;
ALTER TABLE public.payments VALIDATE CONSTRAINT payments_method_chk;