#!/bin/bash
set -eu
umask 077
cd "$(dirname "$0")"
ledger_package=$(pwd -P)
. "$ledger_package/iphone-common.sh"
ledger_require_mac
ledger_find_python
"$ledger_python" "$ledger_package/iphone-https.py" --preflight
if [ -L "$ledger_state_dir" ] || [ -L "$ledger_state_dir/bin" ] || [ -L "$ledger_state_dir/ca" ]; then
  echo '本地状态目录不允许使用符号链接，已停止。'; exit 1
fi
mkdir -p "$ledger_state_dir/bin" "$ledger_state_dir/ca"
chmod 700 "$ledger_state_dir" "$ledger_state_dir/bin" "$ledger_state_dir/ca"
ledger_wifi_ip
ledger_tool="$ledger_state_dir/bin/mkcert"
ledger_expected_sha=a32dfab51f1845d51e810db8e47dcf0e6b51ae3422426514bf5a2b8302e97d4e
if [ ! -f "$ledger_tool" ]; then
  echo '正在下载官方固定版本 mkcert 1.4.4（约 5.3 MB），保持 HTTPS 验证。'
  ledger_download="$ledger_state_dir/bin/mkcert.download"
  trap 'rm -f "$ledger_download"' EXIT
  /usr/bin/curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --output "$ledger_download" 'https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-darwin-amd64'
  ledger_actual=$(/usr/bin/shasum -a 256 "$ledger_download" | /usr/bin/awk '{print $1}')
  if [ "$ledger_actual" != "$ledger_expected_sha" ]; then echo '校验和不符，已停止。不要绕过检查。'; exit 1; fi
  mv "$ledger_download" "$ledger_tool"
fi
ledger_actual=$(/usr/bin/shasum -a 256 "$ledger_tool" | /usr/bin/awk '{print $1}')
if [ "$ledger_actual" != "$ledger_expected_sha" ]; then echo 'mkcert 完整性检查失败，已停止。'; exit 1; fi
chmod 700 "$ledger_tool"
"$ledger_tool" -version
if [ -e "$ledger_state_dir/server.json" ]; then echo '请先运行 Stop-iPhone.command 停止服务，再生成证书。'; exit 1; fi
for ledger_file in server-key.pem server-cert.pem ca/rootCA.pem ca/rootCA-key.pem iPhone-Test-CA.cer; do
  if [ -L "$ledger_state_dir/$ledger_file" ]; then echo '证书路径存在符号链接，已停止。'; exit 1; fi
done
# Creates this project's CA locally; deliberately DOES NOT install it into Mac trust stores.
CAROOT="$ledger_state_dir/ca" "$ledger_tool" -key-file "$ledger_state_dir/server-key.pem" -cert-file "$ledger_state_dir/server-cert.pem" "$ledger_ip"
chmod 600 "$ledger_state_dir/server-key.pem" "$ledger_state_dir/server-cert.pem"
"$ledger_python" "$ledger_package/iphone-https.py" --export-ca
/usr/bin/openssl x509 -in "$ledger_state_dir/ca/rootCA.pem" -noout -fingerprint -sha256
printf '\n准备完成，手机访问地址：https://%s:8444\n' "$ledger_ip"
echo '接下来将 Finder 中的 iPhone-Test-CA.cer 通过 AirDrop 传到你的 iPhone，并按指南安装信任。'
echo '不要分享或上传任何名称含 key 的文件。Mac 本身没有安装此 CA 信任。'
/usr/bin/open -R "$ledger_state_dir/iPhone-Test-CA.cer"
