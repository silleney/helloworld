#!/bin/bash
set -eu
cd "$(dirname "$0")"
ledger_package=$(pwd -P)
. "$ledger_package/iphone-common.sh"
ledger_find_python
"$ledger_python" "$ledger_package/iphone-https.py" --stop
"$ledger_python" "$ledger_package/iphone-https.py" --cleanup
