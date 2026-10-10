# Shared functions for the iPhone acceptance scripts. Does not alter system security.
ledger_find_python() {
  if [ -x /usr/bin/python ] && /usr/bin/python -c 'import sys' >/dev/null 2>&1; then
    ledger_python=/usr/bin/python
  elif command -v python3 >/dev/null 2>&1; then
    ledger_python=$(command -v python3)
  else
    echo '未找到可用 Python。请停止并反馈，不要安装旧 Node 或绕过安全检查。'
    return 1
  fi
}
ledger_state_dir="$HOME/Library/Application Support/LittleLedger-V12-8444-Acceptance"
ledger_wifi_ip() {
  ledger_wifi_device=$(/usr/sbin/networksetup -listallhardwareports | /usr/bin/awk '/Hardware Port: (Wi-Fi|AirPort)/{getline; print $2; exit}')
  if [ -z "$ledger_wifi_device" ]; then echo '未识别到 Wi-Fi 网卡，请停止并反馈。' >&2; return 1; fi
  ledger_ip=$(/usr/sbin/ipconfig getifaddr "$ledger_wifi_device")
  if [ -z "$ledger_ip" ]; then echo 'Wi-Fi 未取得 IPv4 地址，请连接私人 Wi-Fi。' >&2; return 1; fi
  "$ledger_python" "$ledger_package/iphone-https.py" --check-ip "$ledger_ip"
}
ledger_require_mac() {
  if [ "$(/usr/bin/uname -s)" != Darwin ] || [ "$(/usr/bin/uname -m)" != x86_64 ]; then
    echo '此验收工具仅为 Intel Mac 准备，请停止并反馈。'; return 1
  fi
}
