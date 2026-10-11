"""Virtual users only, inside the disposable offline container."""
import json,subprocess,sys,uuid,concurrent.futures
container=sys.argv[1]
actor=str(uuid.uuid4());ledger=str(uuid.uuid4())
def sql(text):
 r=subprocess.run(['docker','exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-At'],input=text,text=True,capture_output=True,check=True)
 return r.stdout
entry=dict(id='virtual-concurrent',description='virtual',amount_cents=100,category='necessary',spent_on='2026-10-11',source='manual',created_at='2026-10-11T00:00:00.000Z',updated_at='2026-10-11T00:00:00.000Z')
def operation(oid,changes):
 payload=json.dumps(changes).replace("'","''")
 return "select public.ll_apply_operation('%s','%s','%s'::jsonb);"%(ledger,oid,payload)
prefix="begin;set local role authenticated;set local request.jwt.claim.sub='%s';"%actor
sql("insert into auth.users values('%s');"%actor+prefix+"select public.ll_create_personal_ledger('%s','Virtual concurrency');commit;"%ledger)
create=[dict(kind='create',id=entry['id'],expected_revision=0,entry=entry)]
oid=str(uuid.uuid4())
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
 results=list(ex.map(lambda _:sql(prefix+operation(oid,create)+'commit;'),range(2)))
assert all('"status": "applied"' in r and '"ledger_revision": 1' in r for r in results),results
updates=[dict(kind='update',id=entry['id'],expected_revision=1,entry={**entry,'amount_cents':200})]
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
 results=list(ex.map(lambda _:sql(prefix+operation(str(uuid.uuid4()),updates)+'commit;'),range(2)))
assert sum('"status": "applied"' in r for r in results)==1,results
assert sum('"status": "conflict"' in r for r in results)==1,results
result=sql(prefix+"select public.ll_snapshot('%s');commit;"%ledger)
assert '"amount_cents": 200' in result and '"ledger_revision": 2' in result,result
print('PASS: two independent DB connections: duplicate commit once; concurrent stale updates one applied/one conflict')

from pathlib import Path
rollback=(Path(__file__).resolve().parents[1]/'rollback-disable-cloud.sql').read_text()
sql(rollback)
result=sql(prefix+"select public.ll_snapshot('%s');commit;"%ledger)
assert '"amount_cents": 200' in result,result
assert sql("select has_function_privilege('authenticated','public.ll_apply_operation(uuid,uuid,jsonb)','EXECUTE');").strip()=='f'
assert sql("select has_function_privilege('authenticated','public.ll_create_personal_ledger(uuid,text)','EXECUTE');").strip()=='f'
print('PASS: maintenance rollback revokes writes/creation, preserves records and authorized snapshot')
