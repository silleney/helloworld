-- Test project only. Apply once as the SQL Editor administrative role.
-- No destructive changes to existing schemas, tables or browser storage.
begin;
create schema ledger_private;
revoke all on schema ledger_private from public, anon, authenticated;
grant usage on schema ledger_private to authenticated;

create table ledger_private.ledgers (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null unique references auth.users(id),
 name text not null check (length(btrim(name)) between 1 and 80),
 revision bigint not null default 0 check(revision between 0 and 9007199254740991),
 created_at timestamptz not null default now()
);
create table ledger_private.members (
 ledger_id uuid not null references ledger_private.ledgers(id),
 user_id uuid not null references auth.users(id),
 role text not null check(role in ('owner','editor','viewer')),
 primary key(ledger_id,user_id)
);
create index members_user on ledger_private.members(user_id,ledger_id);
create table ledger_private.entries (
 ledger_id uuid not null references ledger_private.ledgers(id),
 id text not null check(length(id) between 1 and 128),
 description text not null check(length(btrim(description)) between 1 and 120),
 amount_cents bigint not null check(amount_cents between 1 and 99999999900),
 category text not null check(category in ('necessary','discretionary')),
 spent_on date not null check(spent_on between date '1900-01-01' and date '9999-12-31'),
 source text not null check(source in ('voice','manual')),
 created_at text not null,
 updated_at text not null,
 revision bigint not null check(revision between 1 and 9007199254740991),
 deleted boolean not null default false,
 primary key(ledger_id,id)
);
-- Preserve original timestamp spelling in V1 JSON; validate timestamps in RPC.
create table ledger_private.operations (
 ledger_id uuid not null references ledger_private.ledgers(id),
 actor_id uuid not null references auth.users(id),
 operation_id uuid not null,
 payload jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(ledger_id,actor_id,operation_id)
);

alter table ledger_private.ledgers enable row level security;
alter table ledger_private.members enable row level security;
alter table ledger_private.entries enable row level security;
alter table ledger_private.operations enable row level security;
create policy members_read_self on ledger_private.members for select to authenticated
 using(user_id=(select auth.uid()));
create policy ledgers_read_member on ledger_private.ledgers for select to authenticated
 using(exists(select 1 from ledger_private.members m where m.ledger_id=id and m.user_id=(select auth.uid())));
create policy entries_read_member on ledger_private.entries for select to authenticated
 using(exists(select 1 from ledger_private.members m where m.ledger_id=entries.ledger_id and m.user_id=(select auth.uid())));
create policy operations_read_self on ledger_private.operations for select to authenticated
 using(actor_id=(select auth.uid()) and exists(select 1 from ledger_private.members m where m.ledger_id=operations.ledger_id and m.user_id=(select auth.uid())));
revoke all on all tables in schema ledger_private from public,anon,authenticated;
grant select on all tables in schema ledger_private to authenticated;
-- No client INSERT/UPDATE/DELETE policies or grants. No exposed views.

create function public.ll_create_personal_ledger(p_ledger_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); existing ledger_private.ledgers;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 -- Caller-generated ledger UUID also makes initial creation retry-safe.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_ledger_id::text,0));
 select * into existing from ledger_private.ledgers where id=p_ledger_id;
 if found then
  if existing.owner_id<>actor or existing.name<>p_name then raise exception 'Ledger ID unavailable' using errcode='42501'; end if;
  return p_ledger_id;
 end if;
 insert into ledger_private.ledgers(id,owner_id,name) values(p_ledger_id,actor,p_name);
 insert into ledger_private.members values(p_ledger_id,actor,'owner');
 return p_ledger_id;
end $$;

create function public.ll_snapshot(p_ledger_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from ledger_private.members where ledger_id=p_ledger_id and user_id=auth.uid()) then
  raise exception 'Ledger access denied' using errcode='42501';
 end if;
 -- A single SQL statement gives revision and all rows one MVCC snapshot.
 select jsonb_build_object('ledger_revision',l.revision,'rows',coalesce(
  (select jsonb_agg(to_jsonb(e) - 'ledger_id' order by e.id) from ledger_private.entries e where e.ledger_id=l.id),'[]'::jsonb))
 into result from ledger_private.ledgers l where l.id=p_ledger_id;
 return result;
end $$;

create function public.ll_apply_operation(p_ledger_id uuid,p_operation_id uuid,p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 actor uuid := auth.uid(); role_name text; cached ledger_private.operations;
 change jsonb; old ledger_private.entries; entry jsonb; kind text; expected bigint;
 current_revision bigint; next_revision bigint; conflict boolean := false; result jsonb;
 ids text[] := '{}'; id_value text;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 -- Serialize all writes for this small personal ledger, including capacity checks.
 select revision into current_revision from ledger_private.ledgers where id=p_ledger_id for update;
 select role into role_name from ledger_private.members where ledger_id=p_ledger_id and user_id=actor;
 if role_name is null or role_name not in ('owner','editor') then raise exception 'Ledger write denied' using errcode='42501'; end if;
 if p_operation_id is null then raise exception 'Operation ID required' using errcode='22023'; end if;
 select * into cached from ledger_private.operations where ledger_id=p_ledger_id and actor_id=actor and operation_id=p_operation_id;
 if found then
  if cached.payload is distinct from p_changes then raise exception 'Operation ID reused with different payload' using errcode='22023'; end if;
  return cached.result;
 end if;
 if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) not between 1 and 1000 or octet_length(p_changes::text)>2000000 then
  raise exception 'Expected 1..1000 changes' using errcode='22023';
 end if;
 for change in select value from jsonb_array_elements(p_changes) loop
  kind:=change->>'kind'; id_value:=change->>'id';
  if kind is null or kind not in ('create','update','delete','restore') or id_value is null or length(id_value) not between 1 and 128
    or id_value=any(ids) or (change->>'expected_revision') is null or (change->>'expected_revision') !~ '^[0-9]+$' then
   raise exception 'Invalid or duplicate change' using errcode='22023';
  end if;
  ids:=array_append(ids,id_value); expected:=(change->>'expected_revision')::bigint;
  select * into old from ledger_private.entries where ledger_id=p_ledger_id and id=id_value;
  if kind='create' then
   if expected<>0 or found then conflict:=true; end if;
  else
   if not found or old.revision<>expected or (kind='restore' and not old.deleted) or (kind<>'restore' and old.deleted) then conflict:=true; end if;
  end if;
  if kind<>'delete' then
   entry:=change->'entry';
   if exists(select 1 from unnest(array['id','description','category','spent_on','source','created_at','updated_at']) field where jsonb_typeof(entry->field) is distinct from 'string') then raise exception 'Entry text fields must be strings' using errcode='22023'; end if;
   if entry is null or jsonb_typeof(entry)<>'object' or entry->>'id' is distinct from id_value
    or jsonb_typeof(entry->'amount_cents') is distinct from 'number' or (entry->>'amount_cents') !~ '^[0-9]+$'
    or (entry->>'amount_cents')::numeric not between 1 and 99999999900
    or entry->>'description' is null or length(btrim(entry->>'description')) not between 1 and 120
    or entry->>'category' is null or entry->>'category' not in ('necessary','discretionary')
    or entry->>'source' is null or entry->>'source' not in ('voice','manual')
    or entry->>'spent_on' is null or entry->>'spent_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or (entry->>'spent_on')::date not between date '1900-01-01' and date '9999-12-31'
    or entry->>'created_at' is null or entry->>'updated_at' is null
    or entry->>'created_at' !~ '^\d{4}-\d{2}-\d{2}T' or entry->>'updated_at' !~ '^\d{4}-\d{2}-\d{2}T'
   then raise exception 'Invalid V1 entry' using errcode='22023'; end if;
   perform (entry->>'created_at')::timestamptz, (entry->>'updated_at')::timestamptz;
   if kind<>'create' and old.id is not null and (entry->>'created_at' is distinct from old.created_at or entry->>'source' is distinct from old.source) then
    raise exception 'Immutable entry fields changed' using errcode='22023';
   end if;
  end if;
 end loop;
 if conflict then
  result:=jsonb_build_object('status','conflict','ledger_revision',current_revision);
 else
  next_revision:=current_revision+1;
  for change in select value from jsonb_array_elements(p_changes) loop
   if change->>'kind'='delete' then
    update ledger_private.entries set deleted=true,revision=next_revision where ledger_id=p_ledger_id and id=change->>'id';
   else
    entry:=change->'entry';
    insert into ledger_private.entries values(p_ledger_id,entry->>'id',entry->>'description',(entry->>'amount_cents')::bigint,
     entry->>'category',(entry->>'spent_on')::date,entry->>'source',entry->>'created_at',entry->>'updated_at',next_revision,false)
    on conflict(ledger_id,id) do update set description=excluded.description,amount_cents=excluded.amount_cents,
     category=excluded.category,spent_on=excluded.spent_on,updated_at=excluded.updated_at,revision=excluded.revision,deleted=false;
   end if;
  end loop;
  if (select count(*) from ledger_private.entries where ledger_id=p_ledger_id and not deleted)>100000
   or (select coalesce(sum(amount_cents::numeric),0) from ledger_private.entries where ledger_id=p_ledger_id and not deleted)>9007199254740991 then
   raise exception 'Ledger capacity exceeded' using errcode='22023';
  end if;
  update ledger_private.ledgers set revision=next_revision where id=p_ledger_id;
  result:=jsonb_build_object('status','applied','ledger_revision',next_revision);
 end if;
 insert into ledger_private.operations(ledger_id,actor_id,operation_id,payload,result) values(p_ledger_id,actor,p_operation_id,p_changes,result);
 return result;
end $$;

-- PostgreSQL defaults new functions to executable by PUBLIC: revoke explicitly.
revoke all on function public.ll_create_personal_ledger(uuid,text) from public,anon,authenticated;
revoke all on function public.ll_snapshot(uuid) from public,anon,authenticated;
revoke all on function public.ll_apply_operation(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ll_create_personal_ledger(uuid,text) to authenticated;
grant execute on function public.ll_snapshot(uuid) to authenticated;
grant execute on function public.ll_apply_operation(uuid,uuid,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
