-- Maintenance rollback, TEST PROJECT ONLY. Preserves all records and snapshots.
-- Does not delete tables, users, operations or any browser database.
begin;
revoke execute on function public.ll_create_personal_ledger(uuid,text) from authenticated;
revoke execute on function public.ll_apply_operation(uuid,uuid,jsonb) from authenticated;
-- Leave ll_snapshot readable for an authorized user to export a backup.
notify pgrst, 'reload schema';
commit;
-- Re-enable only after diagnosis + explicit approval, using the grants at the end
-- of the original migration. Never rerun CREATE TABLE blindly or DROP CASCADE.
