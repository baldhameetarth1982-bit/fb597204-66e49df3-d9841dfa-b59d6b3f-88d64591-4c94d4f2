CREATE OR REPLACE FUNCTION public.apply_society_structure_plan_internal(_actor_id uuid, _society_id uuid, _plan jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_block jsonb; v_block_id uuid; v_block_name text; v_unit_type text; v_pattern text; v_floors integer; v_units integer; v_floor integer; v_unit integer; v_number text; v_blocks_created integer := 0; v_units_created integer := 0;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR _actor_id IS NULL OR _society_id IS NULL OR NOT (public.is_society_admin_for(_actor_id,_society_id) OR public.is_super_admin(_actor_id)) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(_plan->'blocks') <> 'array' OR jsonb_array_length(_plan->'blocks') NOT BETWEEN 1 AND 40 OR _plan->>'property_type' NOT IN ('apartment','bungalow','mixed') THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.societies WHERE id=_society_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='02000'; END IF;
 UPDATE public.societies SET property_type=_plan->>'property_type', updated_at=now() WHERE id=_society_id;
 FOR v_block IN SELECT value FROM jsonb_array_elements(_plan->'blocks') LOOP
  v_block_name:=btrim(v_block->>'name'); v_unit_type:=v_block->>'unit_type'; v_pattern:=v_block->>'naming_pattern'; v_floors:=(v_block->>'floors')::integer; v_units:=(v_block->>'units_per_floor')::integer;
  IF char_length(v_block_name) NOT BETWEEN 1 AND 40 OR v_unit_type NOT IN ('flat','bungalow','villa','shop','office') OR v_pattern NOT IN ('A-101','A1-101','Plain') OR v_floors NOT BETWEEN 0 AND 80 OR v_units NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  INSERT INTO public.blocks(society_id,name,description) VALUES (_society_id,v_block_name,nullif(btrim(v_block->>'description'),'')) RETURNING id INTO v_block_id; v_blocks_created:=v_blocks_created+1;
  FOR v_floor IN (CASE WHEN v_unit_type IN ('flat','office') THEN 1 ELSE 0 END)..greatest(1,v_floors) LOOP
   FOR v_unit IN 1..v_units LOOP
    v_number:=CASE WHEN v_unit_type NOT IN ('flat','office') THEN v_block_name||'-'||v_unit WHEN v_pattern='Plain' THEN (v_unit+v_floor*100)::text WHEN v_pattern='A1-101' THEN v_block_name||v_floor||'-'||lpad(v_unit::text,2,'0') ELSE v_block_name||'-'||v_floor||lpad(v_unit::text,2,'0') END;
    INSERT INTO public.flats(society_id,block_id,flat_number,floor,unit_type,status) VALUES (_society_id,v_block_id,v_number,CASE WHEN v_unit_type IN ('flat','office') THEN v_floor ELSE NULL END,v_unit_type,'vacant'); v_units_created:=v_units_created+1;
   END LOOP; EXIT WHEN v_unit_type NOT IN ('flat','office');
  END LOOP;
 END LOOP;
 INSERT INTO public.audit_log(actor_id,action,target_table,target_id,society_id,metadata) VALUES (_actor_id,'society.structure_plan_applied','societies',_society_id::text,_society_id,jsonb_build_object('blocks_created',v_blocks_created,'units_created',v_units_created));
 RETURN jsonb_build_object('blocks_created',v_blocks_created,'units_created',v_units_created);
END $$;
REVOKE ALL ON FUNCTION public.apply_society_structure_plan_internal(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.apply_society_structure_plan_internal(uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.duplicate_society_block_internal(_actor_id uuid,_block_id uuid,_new_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_source public.blocks%ROWTYPE; v_new_id uuid; v_units integer:=0;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR _actor_id IS NULL OR _block_id IS NULL OR char_length(btrim(_new_name)) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_source FROM public.blocks WHERE id=_block_id AND is_active FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='02000'; END IF;
 IF NOT (public.is_society_admin_for(_actor_id,v_source.society_id) OR public.is_super_admin(_actor_id)) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
 INSERT INTO public.blocks(society_id,name,description,structure_kind) VALUES (v_source.society_id,btrim(_new_name),v_source.description,v_source.structure_kind) RETURNING id INTO v_new_id;
 INSERT INTO public.flats(society_id,block_id,flat_number,floor,type,area_sqft,unit_type,status) SELECT society_id,v_new_id,CASE WHEN flat_number LIKE v_source.name||'-%' THEN btrim(_new_name)||substr(flat_number,char_length(v_source.name)+1) ELSE flat_number END,floor,type,area_sqft,unit_type,'vacant' FROM public.flats WHERE block_id=_block_id AND is_active; GET DIAGNOSTICS v_units=ROW_COUNT;
 INSERT INTO public.audit_log(actor_id,action,target_table,target_id,society_id,metadata) VALUES (_actor_id,'society.block_duplicated','blocks',v_new_id::text,v_source.society_id,jsonb_build_object('source_block_id',_block_id,'units_created',v_units));
 RETURN jsonb_build_object('block_id',v_new_id,'units_created',v_units);
END $$;
REVOKE ALL ON FUNCTION public.duplicate_society_block_internal(uuid,uuid,text) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.duplicate_society_block_internal(uuid,uuid,text) TO service_role;