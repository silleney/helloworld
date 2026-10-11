# Supabase little-ledger-dev 执行步骤（分步暂停）

本轮只准备文件，尚未执行。不要发送数据库密码、secret/service_role、access token、测试用户密码。公开项目 URL 与 publishable key 可以后续配置；这些标识本身不能替代 RLS。无需连接 Supabase GitHub集成。

## 第一步（当前只做这一件）

在 Supabase 控制台选择 **little-ledger-dev**，打开左侧 **SQL Editor**。确认项目名称仍是 dev；先不要粘贴或运行 SQL。返回聊天告知“已打开 little-ledger-dev SQL Editor”。

## 后续步骤，逐次指导

1. 运行 preflight-readonly.sql，检查 auth.uid、角色、服务器版本。ledger_private 和 ll_* 必须不存在；否则先调查，不删表重建。
2. 核对 migrations/202610110001_cloud_ledger.sql 的完整内容和事务边界，确认只有测试项目，将其作为一次迁移运行。不要运行 tests 目录的任何SQL，这些仅属本地隔离harness。
3. 运行 verify-permissions-readonly.sql；应有4业务表全部RLS、SELECT策略、authenticated只有SELECT、anon无表权限，3函数只有authenticated可execute，2definer固定空search_path，0业务视图。
4. 在 API 设置检查 exposed schema 包含 public，**不包含 ledger_private**；不打开“自动暴露新表”，不关闭自动RLS。若RPC返回找不到函数，检查精确函数授权及schema reload，不放宽整个schema权限。
5. Authentication 中关闭公开注册；仅建立两名虚拟测试用户，选择邮箱密码测试方式。账户密码只由你保管和在测试登录页输入，不发给Codex。确认邮箱机制使用正常控制台设置，不修改auth内部表。上线OAuth/找回密码以后另审计。
6. 再提供公开 Project URL 与 publishable key，禁用用secret/service_role替代。部署隔离测试前先确认 Pages 自动预览策略；不能更新现有生产站点。
7. 用账号A创建虚拟账本、账号B独立账本；测试匿名/A/B读取、修改、删除、伪造账本ID及直接表写，越权必须失败。一个请求响应丢失重试不得重复，旧revision冲突不得覆盖，删除不得自动复活。
8. iPhone/电脑虚拟跨设备保存、修改、删除、离线重开、断网续传、过期登录、切换账号、备份与隔离恢复。正式数据迁移仍需另行批准。

## 回滚

首先停止测试客户端，不删除网站数据。保存测试JSON/操作队列和数据库备份。仅在测试项目执行 rollback-disable-cloud.sql 撤销云写入与建账，保留查询和数据。检查写失败、已授权查询可用。保留SQL和数据用于诊断，不DROP/TRUNCATE/CASCADE。
