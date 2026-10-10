> **iPhone 局域网 HTTPS 验收请先阅读 [手机操作指南](README-iPhone.md)。** 首次执行 `bash Prepare-iPhone.command`，之后使用 `Start-iPhone.command` / `Stop-iPhone.command`。下面的 `Start.command` 仍只用于原有电脑 HTTP 验收。

# 小账 · Mac Catalina 静态验收包

这是阶段 A 的已构建页面，不需要 Node.js、不需要 npm、不安装项目依赖。只在你的 Mac 上预览，没有网站部署、账户或云同步，不收取费用。

源码保存在 [main 分支](https://github.com/silleney/helloworld/tree/main)。本包对应提交 `3a924bd5a308fa8326a5e97c70b13adb458dab7b`，构建命令为 `npm run build -- --target=safari15.4`；校验信息见 BUILD.json。

## MacBook 启动步骤

1. 点击 GitHub 页面绿色 **Code → Download ZIP**，双击 ZIP 解压，得到 `helloworld-acceptance-preview` 文件夹。
2. 更新 Catalina 可用的 Safari，至少 **15.4**，建议 **15.6.1**；在 Safari 菜单 → 关于 Safari 查看版本。旧 Safari 可能缺少保存所需的 `crypto.randomUUID`。本包按 Safari 15.4 构建，但尚未在真实 Catalina 上验证。
3. 打开“终端”，输入 `cd `（最后有一个空格），将解压的整个文件夹拖入终端，再按回车。
4. 粘贴下面这一行，按回车：

   ```sh
   bash Start.command
   ```

5. 浏览器应自动打开小账；若未打开，请在此 Mac 的 Safari 地址栏输入 `http://127.0.0.1:4173`。不要直接双击 site/index.html，文件方式不支持本应用的完整流程。
6. 保持终端打开；测试结束按 **Control+C**。关闭网站数据前先导出 JSON。

启动脚本优先使用 Catalina 自带 `/usr/bin/python`（Python 2.7），也支持已有 Python 3。它只读取 `site/` 的静态页面并监听本机回环地址，不提供上传、账户、源码目录或局域网访问，不需要管理员权限。Python 2 已停止维护，此工具仅用于临时本机验收，请勿改成公网监听或用于长期托管。

如果出现“Python was not found”“端口被占用”或页面报错，请复制原文反馈，不要通过关闭安全校验、随机杀进程或安装旧 Node 来绕过。MacGatekeeper 拦截双击 `.command` 时，也可按上述终端步骤执行，不需要关闭系统安全保护。

## 简短人工验收

| 操作 | 应看到的结果 |
|---|---|
| 输入“买菜38块，买零食25块”并识别 | 两笔候选，确认前没有入账 |
| 核对分类并确认 | 总额63.00，必要38.00，非必要25.00 |
| 将零食改为12.50 | 总额50.50 |
| 将买菜分类改为非必要 | 必要0.00，非必要50.50 |
| 输入“咖啡12块5” | 金额12.50，分类待确认；取消不入账 |
| 删除零食并撤销 | 总额38.00后恢复50.50 |
| 导出JSON和CSV，再恢复同一JSON | 下载文件存在，恢复不新增重复记录 |
| 刷新、退出Safari后重开 | 两笔记录和金额仍然存在 |

数据仅存在这台 Mac 的当前浏览器中，不在 GitHub，也不在这个包里。不同设备、浏览器、协议或端口拥有独立账本。此 localhost 地址只能在这台 Mac 使用，iPhone 不能通过它访问。本包首先解决 Mac 验收；手机 HTTPS 验收另行准备。

## 已知限制与安全

- 实际 Catalina Safari 验收仍由用户执行；自动化 Chromium 验证不等于 Catalina 实机验证。
- 未修改业务功能、未升级依赖。已有开发测试依赖告警涉及 Vitest、@vitest/mocker 和 tinypool；此包不包含 node_modules，也不运行这些工具。
- PWA 需要首次加载并刷新完成 Service Worker 控制，再检查断网刷新。真实 Safari 行为需要测试。
- 如果此前其他小账版本也用过本机4173，更新提示出现时先保存输入再更新；看不到旧账目时先检查浏览器和地址，不清空数据。
