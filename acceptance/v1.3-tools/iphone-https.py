# -*- coding: utf-8 -*-
"""Temporary LAN-only HTTPS preview; Python 2.7.9+ or Python 3, standard library only."""
from __future__ import print_function
import argparse
import json
import os
import signal
import socket
import ssl
import stat
import subprocess
import sys
import time
try:
    from http.server import SimpleHTTPRequestHandler
    from socketserver import TCPServer
    from urllib.parse import urlsplit, unquote
except ImportError:
    from SimpleHTTPServer import SimpleHTTPRequestHandler
    from SocketServer import TCPServer
    from urlparse import urlsplit
    from urllib import unquote

PACKAGE = os.path.dirname(os.path.realpath(__file__))
SITE = os.path.realpath(os.path.join(PACKAGE, 'site'))
DEFAULT_STATE = os.path.join(os.path.expanduser('~'), 'Library', 'Application Support', 'LittleLedger-V13-8444-Acceptance')

def private_ip(ip):
    try:
        parts = ip.split('.')
        if len(parts) != 4 or any(str(int(p)) != p for p in parts): return False
        a, b, c, d = [int(p) for p in parts]
        if any(p < 0 or p > 255 for p in [a, b, c, d]): return False
        return a == 10 or (a == 172 and 16 <= b <= 31) or (a == 192 and b == 168)
    except (TypeError, ValueError): return False

def preflight():
    if sys.version_info < (2, 7, 9): raise RuntimeError('Python is too old; stop and report this message.')
    if not hasattr(ssl, 'SSLContext') or not hasattr(ssl, 'PROTOCOL_TLSv1_2'):
        raise RuntimeError('TLS 1.2 is unavailable; refusing insecure fallback.')
    if not hasattr(ssl._ssl, '_test_decode_cert'):
        raise RuntimeError('Certificate inspection is unavailable; stop and report.')
    context = ssl.SSLContext(ssl.PROTOCOL_TLSv1_2)
    context.set_ciphers('ECDHE+AESGCM:ECDHE+AES:!aNULL:!eNULL:!MD5:!3DES')
    print('Python {0}; TLS library: {1}; TLS 1.2/ECDHE available'.format(sys.version.split()[0], ssl.OPENSSL_VERSION))
    return context

def secure_state(state):
    info = os.lstat(state)
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode): raise RuntimeError('Unsafe state directory.')
    if info.st_uid != os.getuid() or info.st_mode & 0o077: raise RuntimeError('State directory must be owned by you and private (700).')

def cert_context(state, host):
    secure_state(state)
    key = os.path.join(state, 'server-key.pem')
    cert = os.path.join(state, 'server-cert.pem')
    ca = os.path.join(state, 'ca', 'rootCA.pem')
    for name in [key, cert, ca]:
        if not os.path.isfile(name) or os.path.islink(name): raise RuntimeError('Missing/unsafe certificate. Run Prepare-iPhone.command first.')
    if os.stat(key).st_mode & 0o077: raise RuntimeError('Private key permissions must be 600.')
    decoded = ssl._ssl._test_decode_cert(cert)
    ips = [value for kind, value in decoded.get('subjectAltName', []) if kind == 'IP Address']
    if host not in ips: raise RuntimeError('Wi-Fi IP changed; stop and run Prepare-iPhone.command again. Do not ignore browser certificate warnings.')
    now = time.time()
    if now < ssl.cert_time_to_seconds(decoded['notBefore']) or now >= ssl.cert_time_to_seconds(decoded['notAfter']):
        raise RuntimeError('Certificate time invalid; check the clock or regenerate certificates.')
    subprocess.check_output(['/usr/bin/openssl', 'verify', '-CAfile', ca, cert], stderr=subprocess.STDOUT)
    context = preflight()
    if hasattr(ssl, 'OP_NO_COMPRESSION'): context.options |= ssl.OP_NO_COMPRESSION
    context.load_cert_chain(cert, key)  # Also verifies that the private key matches the certificate.
    return context

class Handler(SimpleHTTPRequestHandler):
    extensions_map = SimpleHTTPRequestHandler.extensions_map.copy()
    extensions_map.update({'.js': 'application/javascript', '.webmanifest': 'application/manifest+json', '.css': 'text/css', '.svg': 'image/svg+xml'})
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        SimpleHTTPRequestHandler.end_headers(self)
    def log_message(self, format, *args):
        # Avoid terminal control characters from untrusted request paths on old Python.
        message = format % args
        safe = ''.join(c if 32 <= ord(c) < 127 else '?' for c in message)
        sys.stderr.write('%s - %s\n' % (self.address_string(), safe))
    def list_directory(self, path):
        self.send_error(403, 'Directory listing disabled')
        return None
    def send_head(self):
        try:
            pathname = unquote(urlsplit(self.path).path)
            if pathname == '/': pathname = '/index.html'
            target = os.path.realpath(os.path.join(SITE, pathname.lstrip('/')))
            if not target.startswith(SITE + os.sep) or not os.path.isfile(target):
                self.send_error(404, 'Not found'); return None
            fileobj = open(target, 'rb')
            self.send_response(200)
            self.send_header('Content-Type', self.guess_type(target))
            self.send_header('Content-Length', str(os.fstat(fileobj.fileno()).st_size))
            self.end_headers()
            return fileobj
        except (IOError, ValueError):
            self.send_error(404, 'Not found'); return None
    def do_POST(self): self.send_error(405, 'Read-only preview')

class Server(TCPServer):
    allow_reuse_address = True
    def get_request(self):
        request, address = TCPServer.get_request(self)
        request.settimeout(5)
        if not private_ip(address[0]):
            request.close(); raise socket.error('Only private LAN clients are permitted')
        try: return self.context.wrap_socket(request, server_side=True), address
        except Exception: request.close(); raise

def read_record(state):
    name = os.path.join(state, 'server.json')
    if not os.path.exists(name): return None
    secure_state(state)
    info = os.lstat(name)
    if stat.S_ISLNK(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError('Unsafe process record; refusing to stop any process.')
    with open(name, 'r') as fileobj: return json.load(fileobj)

def process_matches(record):
    pid = record['pid']
    if not isinstance(pid, int) or pid <= 1: return False
    try:
        uid = subprocess.check_output(['/bin/ps', '-p', str(pid), '-o', 'uid=']).decode('utf-8').strip()
        command = subprocess.check_output(['/bin/ps', '-p', str(pid), '-o', 'command=']).decode('utf-8')
    except subprocess.CalledProcessError: return False
    return (uid == str(os.getuid()) and record.get('script') == os.path.realpath(__file__)
            and record['script'] in command and '--serve' in command
            and '--instance' in command and record['instance'] in command)

def stop(state):
    if not os.path.exists(state): print('No service is running.'); return
    record = read_record(state)
    if not record: print('No service is running.'); return
    if not process_matches(record):
        os.unlink(os.path.join(state, 'server.json'))
        print('Removed stale record; no unrelated process was stopped.'); return
    os.kill(record['pid'], signal.SIGTERM)
    for attempt in range(50):
        if not os.path.exists(os.path.join(state, 'server.json')):
            print('HTTPS preview stopped.'); return
        time.sleep(0.1)
    raise RuntimeError('Service has not exited. Keep the window open and report this message; no forced kill performed.')

def serve(state, host, instance, port):
    if not private_ip(host): raise RuntimeError('Only an RFC1918 private Wi-Fi IPv4 address is allowed.')
    if not instance or len(instance) != 32 or any(c not in '0123456789abcdef' for c in instance): raise RuntimeError('Invalid process marker.')
    if os.path.exists(os.path.join(state, 'server.json')): raise RuntimeError('Run Stop-iPhone.command before starting another service.')
    context = cert_context(state, host)
    server = Server((host, port), Handler)
    server.context = context
    record = {'pid': os.getpid(), 'script': os.path.realpath(__file__), 'instance': instance, 'host': host, 'port': port}
    name = os.path.join(state, 'server.json')
    try:
        fd = os.open(name, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'w') as fileobj: json.dump(record, fileobj)
    except Exception: server.server_close(); raise
    def terminate(signum, frame): raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, terminate)
    print('iPhone Safari: https://{0}:{1}'.format(host, port))
    print('Keep this window open. Stop with Control+C or Stop-iPhone.command.')
    sys.stdout.flush()
    try: server.serve_forever()
    except KeyboardInterrupt: print('\nHTTPS preview stopped.')
    finally:
        server.server_close()
        current = read_record(state)
        if current and current.get('instance') == instance: os.unlink(name)

def export_ca(state):
    secure_state(state)
    with open(os.path.join(state, 'ca', 'rootCA.pem'), 'r') as f: pem = f.read()
    data = ssl.PEM_cert_to_DER_cert(pem)
    with open(os.path.join(state, 'iPhone-Test-CA.cer'), 'wb') as f: f.write(data)
    print('Exported public CA only: iPhone-Test-CA.cer')

def cleanup(state):
    if not os.path.exists(state): print('No local test state remains.'); return
    secure_state(state)
    if read_record(state): raise RuntimeError('Stop the service before cleanup.')
    print('First remove the test certificate profile from your iPhone. This deletes only local preview certificates/tools, not browser accounts or ledger data.')
    try: read = raw_input
    except NameError: read = input
    if read('Type DELETE to remove local test CA/private keys: ').strip() != 'DELETE': print('Cancelled.'); return
    for relative in ['server-key.pem', 'server-cert.pem', 'iPhone-Test-CA.cer', 'ca/rootCA-key.pem', 'ca/rootCA.pem', 'bin/mkcert', 'bin/mkcert.download']:
        name = os.path.join(state, relative)
        parent = os.path.realpath(os.path.dirname(name))
        if not parent.startswith(os.path.realpath(state) + os.sep) and parent != os.path.realpath(state):
            raise RuntimeError('Unsafe cleanup path; stopped.')
        if os.path.lexists(name): os.unlink(name)
    for relative in ['ca', 'bin', '']:
        try: os.rmdir(os.path.join(state, relative))
        except OSError: pass
    print('Local test keys/certificates removed. Mac CA trust was never installed by these scripts.')

def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--preflight', action='store_true')
    group.add_argument('--check-ip')
    group.add_argument('--serve')
    group.add_argument('--stop', action='store_true')
    group.add_argument('--export-ca', action='store_true')
    group.add_argument('--cleanup', action='store_true')
    parser.add_argument('--instance')
    parser.add_argument('--state-dir', default=DEFAULT_STATE)
    parser.add_argument('--port', type=int, default=8444)
    args = parser.parse_args()
    if args.preflight: preflight()
    elif args.check_ip:
        if not private_ip(args.check_ip): raise RuntimeError('Connect to a private Wi-Fi network: address is not RFC1918 private IPv4.')
    elif args.stop: stop(args.state_dir)
    elif args.export_ca: export_ca(args.state_dir)
    elif args.cleanup: cleanup(args.state_dir)
    elif args.serve:
        if args.port != 8444: raise RuntimeError('V1.3 isolated preview permits port 8444 only; never use 8443.')
        serve(args.state_dir, args.serve, args.instance, args.port)

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('STOPPED: {0}'.format(error), file=sys.stderr)
        print('Do not bypass TLS/certificate/security checks. Copy this message for help.', file=sys.stderr)
        sys.exit(1)
