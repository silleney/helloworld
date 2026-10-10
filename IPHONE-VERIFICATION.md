# iPhone HTTPS 工具：兼容性与安全验证

检查日期：2026-10-10。用户设备：Intel MacBook、Catalina 10.15.7；手机 iPhone 13。源页面沿用 acceptance-preview 提交 `ca270f6e143fe992812c7f4dee36a7a5a5d22610` 的全部 `site/` 文件；SHA-256 逐项比较，未改动。

## 已验证

| 项目 | 结果与证据 |
|---|---|
| mkcert Mac 工具 | 固定官方 v1.4.4，Darwin amd64；解析 Mach-O 得到 x86_64 和 `LC_BUILD_VERSION` 最低 macOS **10.9.0**，覆盖目标版本 |
| 下载与完整性 | 从官方 HTTPS Release 下载，SHA-256 为 `a32dfab51f1845d51e810db8e47dcf0e6b51ae3422426514bf5a2b8302e97d4e`；准备脚本同样固定版本、HTTPS 和此指纹，失败立即停止 |
| SHA 来源说明 | 指纹来自本次通过受验证 HTTPS 取得的固定官方发布文件，不宣称它是作者单独签署的校验文件或 Apple Developer ID 签名 |
| Shell 脚本 | `bash -n` 通过，仅使用 Bash 3.2 支持的基础语法，不依赖 Homebrew、Node 或新版 Bash |
| Python 2 路线 | Python 2 语法检查通过，使用 2.7.9+ 标准库 API；准备/启动时强制检测 SSLContext、TLS1.2 和 ECDHE，不足即停止 |
| HTTPS 服务 | Linux Python3 中使用官方 mkcert 同版本生成的临时测试 CA/证书；客户端显式信任该 CA，并开启证书链、有效期和主机名校验，成功请求全部静态文件，校验和一致 |
| TLS | 实际握手为 TLS1.2；服务器固定 TLS1.2，不提供旧 TLS/SSL 降级 |
| 负向证书测试 | 不信任 CA、错误主机名均被客户端拒绝；启动时 IP/SAN 不匹配、模拟过期证书和私钥过宽权限均被拒绝 |
| 访问范围 | 只绑定指定私人 IPv4；拒绝公网/回环/无效 IP；源码、CA/私钥、路径穿越、目录列表不可读取；POST 被拒绝，HEAD 正常 |
| 进程生命周期 | 重复启动被拒绝；停止脚本关闭当前服务并释放端口，清理 PID 文件；伪造为无关 sleep 进程的旧 PID 记录不会导致该进程被终止 |
| 清理 | 输入 CANCEL 不删除私钥，输入 DELETE 才清理本工具本地文件；原 site 文件保留 |
| 不改变其他版本 | 推送前后核对 main 与 acceptance-preview 远端提交，保持原 SHA；新分支不修改业务源代码或依赖 |

## 未验证，不能作承诺

- 云端为 Linux，不能直接执行 Darwin 二进制或复现 Apple Gatekeeper、Catalina 系统 Python/LibreSSL、防火墙弹窗和 AirDrop。Mach-O 最低版本检查是兼容性证据，**不等于真实 Mac 已运行成功**。
- 没有连接真实 iPhone：证书描述文件安装、Safari 听写、离线 PWA、桌面安装与备份下载需用户实机验收。已有 Chromium 的阶段 A 通过结果不替代实机。
- 无法保证用户网络实时可访问 GitHub、权限策略允许本地执行，或路由器不隔离 Wi-Fi 客户端；脚本遇到问题明确停止，不提供不安全绕过。
- Python2 已停止维护，本脚本只供临时私人网络、短时验收；不把它推荐为公网/生产服务器。仅静态读取、无上传/目录浏览、只绑定 Wi-Fi IP和拒绝非私人客户端用于缩小范围，不代表消除运行时全部漏洞。

## 信任与密钥范围

- Mac 没有执行 `mkcert -install`，不修改 Mac 系统 CA 信任；仅 iPhone 经用户手动授权安装本地公开 CA。
- CA/私钥由用户 Mac 在其个人目录生成，GitHub 包只有脚本和静态文件，没有证书或私钥。自动化测试产生的临时 CA 用于 Linux 测试，测试结束删除，不随包提供。
- CA 私钥可签发该 iPhone 信任的证书，必须保密并在结束后撤销手机信任。私人 Wi-Fi 其他设备可访问静态页面，本工具无账号访问控制；不得开公网转发。
- 依赖安全告警未修复：工具不安装 node_modules、不执行 npm/Vitest。复用原有 dist 页面，未升级应用依赖。

开发者可运行 `python3 verify-iphone-tools.py /path/to/official-linux-mkcert` 重现自动化检查，需已有可信 Linux 同版本 mkcert 和可用私人 IPv4。该文件仅供开发者验证，Mac 用户不需要运行。
