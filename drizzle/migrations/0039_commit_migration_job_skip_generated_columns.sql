-- blocks.normalized_name and flats.normalized_label are generated columns; stop inserting into them.
DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.commit_migration_job(uuid,text,text)'::regprocedure);
  d := replace(d,
$a$          INSERT INTO public.blocks (society_id, name, normalized_name)
            VALUES (_job.society_id,
              COALESCE(_r.mapped_json->>'structure_name', _r.mapped_json->>'name'),
              lower(regexp_replace(COALESCE(_r.mapped_json->>'structure_name', _r.mapped_json->>'name',''),
                '[^a-zA-Z0-9]+','','g')))$a$,
$b$          INSERT INTO public.blocks (society_id, name)
            VALUES (_job.society_id,
              COALESCE(_r.mapped_json->>'structure_name', _r.mapped_json->>'name'))$b$);
  d := replace(d,
$a$            society_id, block_id, flat_number, floor, unit_type, normalized_label
          ) VALUES (
            _job.society_id, _block_id,
            COALESCE(_r.mapped_json->>'unit_label', _r.mapped_json->>'flat_number'),
            NULLIF(_r.mapped_json->>'floor','')::int,
            COALESCE(NULLIF(_r.mapped_json->>'unit_type',''),'flat'),
            lower(regexp_replace(COALESCE(_r.mapped_json->>'unit_label', _r.mapped_json->>'flat_number',''),
              '[^a-zA-Z0-9]+','','g'))
          )$a$,
$b$            society_id, block_id, flat_number, floor, unit_type
          ) VALUES (
            _job.society_id, _block_id,
            COALESCE(_r.mapped_json->>'unit_label', _r.mapped_json->>'flat_number'),
            NULLIF(_r.mapped_json->>'floor','')::int,
            COALESCE(NULLIF(_r.mapped_json->>'unit_type',''),'flat')
          )$b$);
  IF position('normalized_label' IN d) > 0 AND position('unit_type, normalized_label' IN d) > 0 THEN
    RAISE EXCEPTION 'replace failed';
  END IF;
  IF position('name, normalized_name' IN d) > 0 THEN RAISE EXCEPTION 'replace failed (blocks)'; END IF;
  EXECUTE d;
END
$do$;