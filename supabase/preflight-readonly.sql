-- Safe inspection in little-ledger-dev SQL Editor; creates/writes nothing.
select current_database(), version(), current_user;
select nspname from pg_namespace where nspname in ('auth','ledger_private','public');
select rolname from pg_roles where rolname in ('anon','authenticated','service_role');
select to_regprocedure('auth.uid()') as auth_function;
select n.nspname,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'll_%';
-- Before migration ledger_private / ll_* must be absent; otherwise STOP.
