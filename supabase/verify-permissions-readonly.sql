-- Catalog inspection only; real JWT/API allow/deny testing is ALSO mandatory.
select n.nspname,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='ledger_private' and c.relkind='r';
select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='ledger_private';
select table_schema,table_name,grantee,privilege_type from information_schema.role_table_grants
 where table_schema='ledger_private' and grantee in ('anon','authenticated','PUBLIC');
select p.proname,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) as owner,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'll_%';
select schemaname,viewname from pg_views where schemaname='ledger_private';
