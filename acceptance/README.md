# V1.1 预构建验收包

浏览器下载 `小账-V1.1-局域网验收包.zip`：打开文件页，点击 Download raw file；或使用同分支 raw 下载链接。完整升级说明见 [验收指南](../docs/V1.1-验收指南.md)。

ZIP 内已构建 site 和 Catalina 启动工具，无需 Node。已有 HTTPS 验收请先备份，在原文件夹替换 site，保持原 IP、协议和端口，保留 CA；不要清除 Safari 网站数据。

开发者重建：仓库根目录运行 `npm run build -- --target=safari15.4`，然后 `python3 acceptance/build-package.py`。`tools` 为工具源码，不能单独启动（没有 site）；解压 ZIP 后才是完整包。

开发者 HTTPS 验证：把 tools/verify-iphone-tools.py 放到解压后的包根目录，以 Python3 执行，参数为 Linux mkcert 路径。此验证器会在临时目录生成自己的测试 CA，清理后退出，不包含用户 CA；Mac 用户不用运行它。
