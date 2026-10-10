# -*- coding: utf-8 -*-
# Runs on Catalina's built-in Python 2.7, or Python 3. No third-party packages.
from __future__ import print_function
import os
import sys
import subprocess
try:
    from http.server import SimpleHTTPRequestHandler
    from socketserver import TCPServer
except ImportError:
    from SimpleHTTPServer import SimpleHTTPRequestHandler
    from SocketServer import TCPServer

class Handler(SimpleHTTPRequestHandler):
    extensions_map = SimpleHTTPRequestHandler.extensions_map.copy()
    extensions_map.update({'.js': 'application/javascript', '.css': 'text/css',
                           '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml'})
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        SimpleHTTPRequestHandler.end_headers(self)
    def do_POST(self):
        self.send_error(405, 'Read-only static preview')

class Server(TCPServer):
    allow_reuse_address = True

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'site'))
try:
    port = int(os.environ.get('LEDGER_ACCEPTANCE_PORT', '4173'))
    server = Server(('127.0.0.1', port), Handler)
except Exception as error:
    print('Cannot start preview: {0}'.format(error))
    print('If port 4173 is busy, stop your previous preview with Control+C.')
    sys.exit(1)
print('Little Ledger: http://127.0.0.1:{0}'.format(port))
print('Local computer only. Keep this terminal open. Stop with Control+C.')
if sys.platform == 'darwin':
    subprocess.call(['/usr/bin/open', 'http://127.0.0.1:{0}'.format(port)])
try:
    server.serve_forever()
except KeyboardInterrupt:
    print('\nPreview stopped.')
finally:
    server.server_close()
