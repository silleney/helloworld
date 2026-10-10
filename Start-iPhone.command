#!/bin/bash
set -eu
umask 077
cd "$(dirname "$0")"
ledger_package=$(pwd -P)
. "$ledger_package/iphone-common.sh"
ledger_require_mac
ledger_find_python
"$ledger_python" "$ledger_package/iphone-https.py" --preflight
ledger_wifi_ip
ledger_instance=$("$ledger_python" -c 'import uuid; print(uuid.uuid4().hex)')
echo '服务将在此终端前台运行，不会隐藏到后台。停止可按 Control+C，或双击 Stop-iPhone.command。'
exec "$ledger_python" "$ledger_package/iphone-https.py" --serve "$ledger_ip" --instance "$ledger_instance"
