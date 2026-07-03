
-- Enums
do $$ begin
  if not exists (select 1 from pg_type where typname = 'hierarchy_kind') then
    create type public.hierarchy_kind as enum ('society','structure','floor','unit');
  end if;
  if not exists (select 1 from pg_type where typname = 'society_layout') then
    create type public.society_layout as enum ('structured','serial');
  end if;
end $$;

-- Additions to societies
alter table public.societies
  add column if not exists layout public.society_layout not null default 'structured',
  add column if not exists structure_label text not null default 'Block';

-- Additions to society_settings
alter table public.society_settings
  add column if not exists dynamic_profile_fields jsonb not null default '[]'::jsonb,
  add column if not exists wizard_state jsonb not null default '{}'::jsonb,
  add column if not exists default_bill_template_id uuid,
  add column if not exists wizard_version integer not null default 1,
  add column if not exists financial_year_label text;

-- Loosen structure_type check to include new values while preserving old ones
alter table public.society_settings drop constraint if exists society_settings_structure_type_check;
alter table public.society_settings add constraint society_settings_structure_type_check
  check (structure_type in ('blocks','towers','wings','buildings','sectors','phases','custom','none','serial'));

-- Hierarchy nodes
create table if not exists public.hierarchy_nodes (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  parent_id uuid references public.hierarchy_nodes(id) on delete cascade,
  kind public.hierarchy_kind not null,
  name text not null,
  code text,
  sort_order integer not null default 0,
  meta jsonb not null default '{}'::jsonb,
  legacy_block_id uuid,
  legacy_flat_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_hnodes_society on public.hierarchy_nodes(society_id);
create index if not exists idx_hnodes_parent on public.hierarchy_nodes(parent_id);
create index if not exists idx_hnodes_kind on public.hierarchy_nodes(society_id, kind);
create unique index if not exists uq_hnodes_society_parent_name
  on public.hierarchy_nodes(society_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

grant select, insert, update, delete on public.hierarchy_nodes to authenticated;
grant all on public.hierarchy_nodes to service_role;

alter table public.hierarchy_nodes enable row level security;

drop policy if exists hnodes_select on public.hierarchy_nodes;
create policy hnodes_select on public.hierarchy_nodes for select to authenticated
  using (public.is_super_admin(auth.uid()) or public.authorize_membership(auth.uid(), society_id));

drop policy if exists hnodes_write on public.hierarchy_nodes;
create policy hnodes_write on public.hierarchy_nodes for all to authenticated
  using (public.is_super_admin(auth.uid()) or public.is_society_admin_for(auth.uid(), society_id))
  with check (public.is_super_admin(auth.uid()) or public.is_society_admin_for(auth.uid(), society_id));

create trigger hnodes_touch before update on public.hierarchy_nodes
  for each row execute function public.touch_updated_at();

-- Save wizard draft (autosave)
create or replace function public.save_wizard_draft(_society_id uuid, _state jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if not (public.is_society_admin_for(v_caller, _society_id) or public.is_super_admin(v_caller)) then
    raise exception 'Not authorized';
  end if;
  insert into public.society_settings (society_id, wizard_state)
    values (_society_id, coalesce(_state, '{}'::jsonb))
  on conflict (society_id) do update
    set wizard_state = coalesce(_state, '{}'::jsonb),
        updated_at = now();
end $fn$;

-- Commit wizard: writes society info, generates hierarchy nodes + legacy blocks/flats,
-- writes opening balances, maintenance policy, dynamic fields, marks setup complete.
-- _payload structure: {
--   info: { name, registration_no, address, city, state, pincode, logo_url, email },
--   layout: 'structured'|'serial',
--   structure_label: 'Block'|...,
--   structures: [{ name, floors, units_per_floor, ground_floor, numbering_format, custom_pattern, code, units: [{code, name, note}] }],
--   serial_units: [{code, name, note}],
--   opening: { cash, bank, as_of },
--   maintenance: { amount, billing_type, due_day, grace_days, late_fee_amount, late_fee_type, auto_generate, frequency },
--   dynamic_fields: [...],
--   financial_year_label: '2026-27'
-- }
create or replace function public.commit_society_wizard(_society_id uuid, _payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_caller uuid := auth.uid();
  v_layout text;
  v_label text;
  v_info jsonb;
  v_opening jsonb;
  v_maint jsonb;
  v_dyn jsonb;
  v_fy text;
  s jsonb; u jsonb;
  v_struct_id uuid;
  v_floor_id uuid;
  v_block_id uuid;
  v_flat_id uuid;
  v_sort int;
  v_sort2 int;
  v_units jsonb;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if not (public.is_society_admin_for(v_caller, _society_id) or public.is_super_admin(v_caller)) then
    raise exception 'Not authorized';
  end if;

  v_info := coalesce(_payload->'info', '{}'::jsonb);
  v_layout := coalesce(_payload->>'layout', 'structured');
  v_label := coalesce(nullif(_payload->>'structure_label',''), 'Block');
  v_opening := coalesce(_payload->'opening', '{}'::jsonb);
  v_maint := coalesce(_payload->'maintenance', '{}'::jsonb);
  v_dyn := coalesce(_payload->'dynamic_fields', '[]'::jsonb);
  v_fy := coalesce(_payload->>'financial_year_label', to_char(current_date, 'YYYY'));

  -- 1. Society info
  update public.societies set
    name = coalesce(nullif(v_info->>'name',''), name),
    registration_no = nullif(v_info->>'registration_no',''),
    address = nullif(v_info->>'address',''),
    city = nullif(v_info->>'city',''),
    state = nullif(v_info->>'state',''),
    pincode = nullif(v_info->>'pincode',''),
    logo_url = coalesce(nullif(v_info->>'logo_url',''), logo_url),
    layout = v_layout::public.society_layout,
    structure_label = v_label,
    updated_at = now()
  where id = _society_id;

  -- 2. Wipe existing draft hierarchy (only if setup not completed yet)
  if not exists (select 1 from public.society_settings where society_id = _society_id and setup_completed_at is not null) then
    delete from public.hierarchy_nodes where society_id = _society_id;
  end if;

  -- 3. Generate hierarchy
  if v_layout = 'structured' then
    v_sort := 0;
    for s in select * from jsonb_array_elements(coalesce(_payload->'structures','[]'::jsonb)) loop
      v_sort := v_sort + 1;
      insert into public.hierarchy_nodes (society_id, parent_id, kind, name, code, sort_order, meta)
        values (_society_id, null, 'structure', coalesce(s->>'name','Block'), s->>'code', v_sort,
                jsonb_build_object(
                  'floors', s->'floors',
                  'units_per_floor', s->'units_per_floor',
                  'ground_floor', s->'ground_floor',
                  'numbering_format', s->>'numbering_format',
                  'custom_pattern', s->>'custom_pattern'
                ))
      returning id into v_struct_id;

      -- Backfill legacy block for compat
      insert into public.blocks (society_id, name, created_at)
        values (_society_id, coalesce(s->>'name','Block'), now())
      returning id into v_block_id;

      update public.hierarchy_nodes set legacy_block_id = v_block_id where id = v_struct_id;

      v_sort2 := 0;
      for u in select * from jsonb_array_elements(coalesce(s->'units','[]'::jsonb)) loop
        v_sort2 := v_sort2 + 1;
        insert into public.hierarchy_nodes (society_id, parent_id, kind, name, code, sort_order, meta)
          values (_society_id, v_struct_id, 'unit',
                  coalesce(u->>'name', u->>'code'),
                  u->>'code', v_sort2,
                  jsonb_build_object('note', u->>'note', 'floor', u->>'floor'))
        returning id into v_flat_id;

        insert into public.flats (society_id, block_id, flat_number, floor, created_at)
          values (_society_id, v_block_id, coalesce(u->>'code', u->>'name','?'),
                  coalesce((u->>'floor')::int, 1), now())
        returning id into v_flat_id;

        update public.hierarchy_nodes h set legacy_flat_id = v_flat_id
          where h.society_id = _society_id and h.parent_id = v_struct_id and h.code = u->>'code';
      end loop;
    end loop;
  else
    -- Serial layout: create a synthetic "Houses" block then units under it
    insert into public.blocks (society_id, name, created_at)
      values (_society_id, 'Houses', now())
    returning id into v_block_id;

    insert into public.hierarchy_nodes (society_id, parent_id, kind, name, code, sort_order, legacy_block_id, meta)
      values (_society_id, null, 'structure', 'Houses', 'H', 1, v_block_id, '{"serial": true}'::jsonb)
    returning id into v_struct_id;

    v_sort := 0;
    for u in select * from jsonb_array_elements(coalesce(_payload->'serial_units','[]'::jsonb)) loop
      v_sort := v_sort + 1;
      insert into public.flats (society_id, block_id, flat_number, floor, created_at)
        values (_society_id, v_block_id, coalesce(u->>'code', u->>'name','?'), 1, now())
      returning id into v_flat_id;

      insert into public.hierarchy_nodes (society_id, parent_id, kind, name, code, sort_order, legacy_flat_id, meta)
        values (_society_id, v_struct_id, 'unit',
                coalesce(u->>'name', u->>'code'), u->>'code', v_sort, v_flat_id,
                jsonb_build_object('note', u->>'note'));
    end loop;
  end if;

  -- 4. Society settings: opening balances, maintenance policy, dynamic fields
  insert into public.society_settings (
    society_id, registration_no, address, city, state, pincode, structure_type,
    opening_cash, opening_bank, opening_balance_date,
    maintenance_frequency, maintenance_due_day, grace_days, late_fee_amount, late_fee_type,
    wizard_step, dynamic_profile_fields, wizard_state, financial_year_label
  )
  values (
    _society_id,
    nullif(v_info->>'registration_no',''),
    nullif(v_info->>'address',''),
    nullif(v_info->>'city',''),
    nullif(v_info->>'state',''),
    nullif(v_info->>'pincode',''),
    case when v_layout = 'serial' then 'serial' else lower(v_label)||'s' end,
    coalesce((v_opening->>'cash')::numeric, 0),
    coalesce((v_opening->>'bank')::numeric, 0),
    coalesce((v_opening->>'as_of')::date, current_date),
    coalesce(nullif(v_maint->>'frequency',''), 'monthly'),
    coalesce((v_maint->>'due_day')::int, 10),
    coalesce((v_maint->>'grace_days')::int, 5),
    coalesce((v_maint->>'late_fee_amount')::numeric, 0),
    coalesce(nullif(v_maint->>'late_fee_type',''), 'flat'),
    99,
    v_dyn,
    '{}'::jsonb,
    v_fy
  )
  on conflict (society_id) do update set
    registration_no = excluded.registration_no,
    address = excluded.address,
    city = excluded.city,
    state = excluded.state,
    pincode = excluded.pincode,
    structure_type = excluded.structure_type,
    maintenance_frequency = excluded.maintenance_frequency,
    maintenance_due_day = excluded.maintenance_due_day,
    grace_days = excluded.grace_days,
    late_fee_amount = excluded.late_fee_amount,
    late_fee_type = excluded.late_fee_type,
    dynamic_profile_fields = excluded.dynamic_profile_fields,
    wizard_state = '{}'::jsonb,
    wizard_step = 99,
    financial_year_label = excluded.financial_year_label,
    updated_at = now();

  -- 5. Lock opening balances only after setup completes
  update public.society_settings set setup_completed_at = coalesce(setup_completed_at, now())
    where society_id = _society_id;
end $fn$;

grant execute on function public.save_wizard_draft(uuid, jsonb) to authenticated;
grant execute on function public.commit_society_wizard(uuid, jsonb) to authenticated;
