#!/bin/bash
set -eu
cd "$(dirname "$0")"
# Catalina ships Python 2.7; prefer it to avoid triggering Xcode installation.
if [ -x /usr/bin/python ] && /usr/bin/python -c 'import sys' >/dev/null 2>&1; then
  exec /usr/bin/python preview.py
elif command -v python3 >/dev/null 2>&1; then
  exec python3 preview.py
else
  echo "Python was not found. Please report this message; do not install Node for this preview."
  exit 1
fi
