# -*- coding: utf-8 -*-
"""Developer-only verifier. Creates temporary test CA on this machine, never bundled."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error
import uuid

package = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('preview', package/'iphone-https.py')
preview = importlib.util.module_from_spec(spec); spec.loader.exec_module(preview)
for ip in ['10.1.2.3','172.16.0.1','172.31.255.1','192.168.1.8']:
    assert preview.private_ip(ip)
for ip in ['0.0.0.0','127.0.0.1','8.8.8.8','172.32.1.1','192.169.1.1','192.168.1.999','192.168.01.1','::1']:
    assert not preview.private_ip(ip)
mkcert = sys.argv[1]
state = Path(tempfile.mkdtemp(prefix='ledger-https-test-')); state.chmod(0o700)
(state/'ca').mkdir(mode=0o700)
host = socket.gethostbyname(socket.gethostname()); assert preview.private_ip(host)
port = 18443
server = None
other = None
try:
    subprocess.run([mkcert,'-key-file',str(state/'server-key.pem'),'-cert-file',str(state/'server-cert.pem'),host],env={**os.environ,'CAROOT':str(state/'ca')},check=True,capture_output=True)
    (state/'server-key.pem').chmod(0o600)
    tool = [sys.executable,str(package/'iphone-https.py'),'--state-dir',str(state)]
    subprocess.run(tool+['--export-ca'],check=True)
    ca_der = ssl.PEM_cert_to_DER_cert((state/'ca/rootCA.pem').read_text())
    assert (state/'iPhone-Test-CA.cer').read_bytes()==ca_der
    marker = uuid.uuid4().hex
    server = subprocess.Popen(tool+['--serve',host,'--instance',marker,'--port',str(port)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    context = ssl.create_default_context(cafile=str(state/'ca/rootCA.pem'))
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPSHandler(context=context))
    url = 'https://%s:%d' % (host,port)
    for _ in range(50):
        if server.poll() is not None: raise RuntimeError(server.communicate())
        try:
            with opener.open(url,timeout=2) as r: assert '小账' in r.read().decode()
            break
        except urllib.error.URLError: time.sleep(.1)
    else: raise RuntimeError('HTTPS start timeout')
    with socket.create_connection((host,port)) as raw:
        with context.wrap_socket(raw,server_hostname=host) as secure:
            assert secure.version()=='TLSv1.2'
    with opener.open(url+'/manifest.webmanifest') as r:
        assert r.headers['Content-Type']=='application/manifest+json'
        assert json.load(r)['display']=='standalone'
    build=json.loads((package/'BUILD.json').read_text())
    import hashlib
    for name,digest in build['files_sha256'].items():
        with opener.open(url+'/'+name) as r: assert hashlib.sha256(r.read()).hexdigest()==digest
    for route in ['/iphone-https.py','/server-key.pem','/ca/rootCA-key.pem','/../README.md','/%2e%2e%2fREADME.md','/assets/']:
        try: opener.open(url+route)
        except urllib.error.HTTPError as e: assert e.code==404
        else: raise AssertionError('Private path exposed '+route)
    with opener.open(urllib.request.Request(url,method='HEAD')) as r: assert not r.read()
    try: opener.open(urllib.request.Request(url,data=b'test',method='POST'))
    except urllib.error.HTTPError as e: assert e.code==405
    else: raise AssertionError('POST permitted')
    for hostname,ca in [('192.168.255.253',str(state/'ca/rootCA.pem')),(host,None)]:
        bad=ssl.create_default_context(cafile=ca)
        try:
            with socket.create_connection((host,port)) as raw:
                with bad.wrap_socket(raw,server_hostname=hostname): pass
        except ssl.SSLCertVerificationError: pass
        else: raise AssertionError('Certificate verification unexpectedly passed')
    result=subprocess.run(tool+['--serve',host,'--instance',uuid.uuid4().hex,'--port',str(port)],capture_output=True)
    assert result.returncode!=0
    subprocess.run(tool+['--stop'],check=True)
    server.wait(timeout=5); assert server.returncode==0 and not (state/'server.json').exists()
    assert socket.socket().connect_ex((host,port))!=0
    # An unrelated process must not be signalled, even if its PID appears in a stale record.
    other=subprocess.Popen(['/bin/sleep','30'])
    (state/'server.json').write_text(json.dumps({'pid':other.pid,'script':str(package/'iphone-https.py'),'instance':uuid.uuid4().hex}))
    (state/'server.json').chmod(0o600)
    subprocess.run(tool+['--stop'],check=True);assert other.poll() is None
    wrong=preview.cert_context
    try: wrong(str(state),'192.168.255.253')
    except RuntimeError:pass
    else:raise AssertionError('Wrong certificate IP permitted')
    decode = preview.ssl._ssl._test_decode_cert
    def expired(path):
        value = decode(path);value['notAfter']='Jan  1 00:00:00 2000 GMT';return value
    preview.ssl._ssl._test_decode_cert=expired
    try:
        try: preview.cert_context(str(state),host)
        except RuntimeError: pass
        else: raise AssertionError('Expired certificate permitted')
    finally: preview.ssl._ssl._test_decode_cert=decode
    (state/'server-key.pem').chmod(0o644)
    try: preview.cert_context(str(state),host)
    except RuntimeError:pass
    else:raise AssertionError('Public private key permissions permitted')
    (state/'server-key.pem').chmod(0o600)
    subprocess.run(tool+['--cleanup'],input='CANCEL\n',text=True,check=True)
    assert (state/'ca/rootCA-key.pem').exists()
    subprocess.run(tool+['--cleanup'],input='DELETE\n',text=True,check=True)
    assert not (state/'ca/rootCA-key.pem').exists() and not (state/'server-key.pem').exists()
    assert (package/'site/index.html').exists()
    print('PASS: trusted HTTPS chain+hostname, TLS1.2, every static asset checksum, private path isolation, read-only methods, duplicate start, stop and stale PID safety, changed IP/key permissions, cleanup confirmation')
finally:
    if server is not None and server.poll() is None: server.terminate();server.wait(timeout=5)
    if other is not None: other.terminate();other.wait(timeout=5)
    shutil.rmtree(state,ignore_errors=True)
