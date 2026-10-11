\set ON_ERROR_STOP on
begin;
insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');
create function pg_temp.assert_true(v boolean,msg text) returns void language plpgsql as $$ begin if v is distinct from true then raise exception 'FAIL: %',msg;end if;end $$;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select public.ll_create_personal_ledger('10000000-0000-0000-0000-000000000001','Virtual A');
select pg_temp.assert_true(public.ll_create_personal_ledger('10000000-0000-0000-0000-000000000001','Virtual A')='10000000-0000-0000-0000-000000000001','ledger create idempotent');
select pg_temp.assert_true(public.ll_apply_operation('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
 '[{"kind":"create","id":"legacy-string-id","expected_revision":0,"entry":{"id":"legacy-string-id","description":"买菜","amount_cents":3850,"category":"necessary","spent_on":"2026-10-11","source":"manual","created_at":"2026-10-11T00:00:00.000Z","updated_at":"2026-10-11T00:00:00.000Z"}}]')->>'status'='applied','create legacy ID');
select pg_temp.assert_true(public.ll_apply_operation('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
 '[{"kind":"create","id":"legacy-string-id","expected_revision":0,"entry":{"id":"legacy-string-id","description":"买菜","amount_cents":3850,"category":"necessary","spent_on":"2026-10-11","source":"manual","created_at":"2026-10-11T00:00:00.000Z","updated_at":"2026-10-11T00:00:00.000Z"}}]')->>'ledger_revision'='1','duplicate does not advance revision');
select pg_temp.assert_true((select count(*)=1 from ledger_private.entries),'single record');
select pg_temp.assert_true(public.ll_snapshot('10000000-0000-0000-0000-000000000001')->'rows'->0->>'amount_cents'='3850','exact cents');
do $$begin
 begin perform public.ll_apply_operation('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','[{"kind":"delete","id":"legacy-string-id","expected_revision":1}]');raise exception 'FAIL reused operation';exception when invalid_parameter_value then null;end;
 begin insert into ledger_private.members values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','owner');raise exception 'FAIL member escalation';exception when insufficient_privilege then null;end;
 begin update ledger_private.entries set amount_cents=1;raise exception 'FAIL direct update';exception when insufficient_privilege then null;end;
end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select public.ll_create_personal_ledger('10000000-0000-0000-0000-000000000002','Virtual B');
select pg_temp.assert_true((select count(*)=0 from ledger_private.entries),'RLS stranger cannot read');
select pg_temp.assert_true((select count(*)=0 from ledger_private.operations),'RLS stranger cannot read operation payload');
do $$begin
 begin perform public.ll_snapshot('10000000-0000-0000-0000-000000000001');raise exception 'FAIL stranger snapshot';exception when insufficient_privilege then null;end;
 begin perform public.ll_apply_operation('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','[]');raise exception 'FAIL stranger replay';exception when insufficient_privilege then null;end;
 begin perform public.ll_create_personal_ledger('10000000-0000-0000-0000-000000000001','Virtual A');raise exception 'FAIL claim owner';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into ledger_private.members values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','viewer');
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select pg_temp.assert_true(jsonb_array_length(public.ll_snapshot('10000000-0000-0000-0000-000000000001')->'rows')=1,'viewer read');
do $$begin
 begin perform public.ll_apply_operation('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000009','[]');raise exception 'FAIL viewer write';exception when insufficient_privilege then null;end;
end $$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select pg_temp.assert_true(public.ll_apply_operation('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','[{"kind":"delete","id":"legacy-string-id","expected_revision":0}]')->>'status'='conflict','stale delete conflict');
select pg_temp.assert_true(public.ll_apply_operation('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','[{"kind":"delete","id":"legacy-string-id","expected_revision":1}]')->>'status'='applied','delete tombstone');
select pg_temp.assert_true(public.ll_snapshot('10000000-0000-0000-0000-000000000001')->'rows'->0->>'deleted'='true','tombstone retained');
select pg_temp.assert_true(public.ll_apply_operation('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004',
 '[{"kind":"create","id":"legacy-string-id","expected_revision":0,"entry":{"id":"legacy-string-id","description":"买菜","amount_cents":3850,"category":"necessary","spent_on":"2026-10-11","source":"manual","created_at":"2026-10-11T00:00:00.000Z","updated_at":"2026-10-11T00:00:00.000Z"}}]')->>'status'='conflict','import cannot resurrect deleted entry');
-- Explicit restore is distinct from import/create; original business fields survive.
select pg_temp.assert_true(public.ll_apply_operation('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005',
 '[{"kind":"restore","id":"legacy-string-id","expected_revision":2,"entry":{"id":"legacy-string-id","description":"买菜","amount_cents":3850,"category":"necessary","spent_on":"2026-10-11","source":"manual","created_at":"2026-10-11T00:00:00.000Z","updated_at":"2026-10-11T00:00:00.000Z"}}]')->>'status'='applied','explicit restore');
select pg_temp.assert_true(public.ll_snapshot('10000000-0000-0000-0000-000000000001')->'rows'->0->>'created_at'='2026-10-11T00:00:00.000Z','original timestamp spelling preserved');
do $$declare payload jsonb;begin
 payload := jsonb_build_array(
 jsonb_build_object('kind','update','id','legacy-string-id','expected_revision',3,'entry',jsonb_build_object('id','legacy-string-id','description','changed','amount_cents',5000,'category','discretionary','spent_on','2026-10-12','source','manual','created_at','2026-10-11T00:00:00.000Z','updated_at','2026-10-11T01:00:00.000Z')),
 jsonb_build_object('kind','delete','id','missing','expected_revision',1));
 perform pg_temp.assert_true(public.ll_apply_operation('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000006',payload)->>'status'='conflict','batch conflict');
 perform pg_temp.assert_true(public.ll_snapshot('10000000-0000-0000-0000-000000000001')->'rows'->0->>'amount_cents'='3850','no partial batch write');
 payload:=jsonb_build_array(payload->0);
 perform pg_temp.assert_true(public.ll_apply_operation('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000007',payload)->>'status'='applied','update exact revision');
 perform pg_temp.assert_true(public.ll_apply_operation('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000008',payload)->>'status'='conflict','other device stale update');
 begin
  perform public.ll_apply_operation('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000010','[{"kind":"create","id":"invalid","expected_revision":0,"entry":{"id":"invalid","description":"invalid","amount_cents":0}}]');
  raise exception 'FAIL invalid amount';
 exception when invalid_parameter_value then null;end;
 perform pg_temp.assert_true((select count(*)=1 from ledger_private.entries),'invalid batch leaves no extra record');
end $$;
set local role anon;
do $$begin
 begin perform public.ll_snapshot('10000000-0000-0000-0000-000000000001');raise exception 'FAIL anon execute';exception when insufficient_privilege then null;end;
 begin select 1 from ledger_private.entries;raise exception 'FAIL anon table';exception when insufficient_privilege then null;end;
end $$;
reset role;
select pg_temp.assert_true((select bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='ledger_private' and c.relkind='r'),'all tables RLS');
select pg_temp.assert_true(not has_function_privilege('anon','public.ll_apply_operation(uuid,uuid,jsonb)','EXECUTE'),'anon function grant denied');
select pg_temp.assert_true((select bool_and(proconfig @> array['search_path=""']) from pg_proc where proname in ('ll_apply_operation','ll_create_personal_ledger')),'definer fixed search path');
rollback;
\echo PASS: PostgreSQL RLS, grants, definer, owner/viewer/stranger/anon, retry, exact cents, stale/delete/import safety
