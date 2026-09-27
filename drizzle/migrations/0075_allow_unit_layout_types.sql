ALTER TABLE public.flats
  DROP CONSTRAINT IF EXISTS flats_unit_type_check;

ALTER TABLE public.flats
  ADD CONSTRAINT flats_unit_type_check
  CHECK (
    lower(btrim(unit_type)) IN (
      'flat',
      'bungalow',
      'villa',
      'shop',
      'office',
      '1rk',
      '1bhk',
      '2bhk',
      '3bhk',
      '4bhk',
      'penthouse',
      'house'
    )
  );