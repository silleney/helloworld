import { useRef, useState } from "react";
import { SupabaseAuth } from "../cloud/auth";
import { SupabaseLedgerAPI, CloudAPIError } from "../cloud/api";
import { CloudStateStore, CloudSync, type State } from "../cloud/queue";
import type { CloudRow, Change } from "../cloud/types";
import {
  makeEntry,
  parseExpenses,
  localDate,
  money,
  amountText,
  validateBackup,
  type Draft,
} from "../domain";
import { config } from "./config";
import { timedFetch } from "../cloud/request";
type Context = {
  auth: SupabaseAuth;
  api: SupabaseLedgerAPI;
  sync: CloudSync;
  userId: string;
  ledgerId: string;
};
const blank = (): Draft => ({
  description: "",
  amount: "",
  category: "",
  spent_on: localDate(),
  source: "manual",
});
const explain = (e: unknown) =>
  e instanceof Error ? e.message : "操作失败，原数据已保留";
function download(content: string, name: string) {
  const u = URL.createObjectURL(
    new Blob([content], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
export default function CloudTest() {
  const current = useRef<Context | null>(null),
    lock = useRef(false),
    generation = useRef(0);
  const [context, setContext] = useState<Context | null>(null),
    [busy, setBusy] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [state, setState] = useState<State>({ operations: [] }),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [text, setText] = useState(""),
    [drafts, setDrafts] = useState<Draft[]>([]),
    [editing, setEditing] = useState<CloudRow | null>(null),
    [target, setTarget] = useState("");
  const rows = state.snapshot?.rows.filter((r) => !r.deleted) ?? [];
  const awaitingSnapshot = state.operations.some(
    (o) =>
      o.state === "applied" &&
      (o.result?.ledger_revision ?? 0) >
        (state.snapshot?.ledger_revision ?? -1),
  );
  const blocked =
    awaitingSnapshot ||
    state.operations.some(
      (o) => o.state === "pending" || o.state === "conflict",
    );
  const reset = () => {
    setState({ operations: [] });
    setDrafts([]);
    setEditing(null);
    setText("");
    setTarget("");
  };
  async function capture(c: Context) {
    const next = await c.sync.state();
    if (current.current === c) setState(next);
  }
  async function action(fn: (c: Context) => Promise<void>) {
    const c = current.current;
    if (!c || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn(c);
    } catch (e) {
      if (current.current === c) setError(explain(e));
    } finally {
      try {
        await capture(c);
      } catch (e) {
        if (current.current === c) setError(explain(e));
      }
      lock.current = false;
      setBusy(false);
    }
  }
  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    reset();
    const seq = ++generation.current;
    const auth = new SupabaseAuth(config);
    const value = password;
    setPassword("");
    try {
      const userId = await auth.signIn(email, value);
      if (seq !== generation.current) {
        await auth.signOut();
        return;
      }
      const api = new SupabaseLedgerAPI(config, () => auth.token(userId));
      const c: Context = {
        auth,
        api,
        sync: new CloudSync(
          api,
          new CloudStateStore(),
          config.url,
          userId,
          userId,
        ),
        userId,
        ledgerId: userId,
      };
      current.current = c;
      setContext(c);
      await capture(c);
      setNotice("已登录。首次使用请建立虚拟测试账本；已有账本请点击同步。");
    } catch (e) {
      setError(explain(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function logout() {
    if (lock.current) return;
    const c = current.current;
    c?.sync.close();
    current.current = null;
    ++generation.current;
    setContext(null);
    reset();
    setNotice("本机已退出，待同步操作保留在原账号分区");
    setError("");
    setPassword("");
    try {
      await c?.auth.signOut();
    } catch (e) {
      setError(explain(e));
    }
  }
  async function submit(c: Context, changes: Change[]) {
    if (
      (await c.sync.state()).operations.some(
        (o) => o.state === "pending" || o.state === "conflict",
      )
    )
      throw new Error("请先处理待同步或冲突操作，避免重复提交");
    await c.sync.stage(crypto.randomUUID(), changes);
    if (current.current === c) {
      setDrafts([]);
      setEditing(null);
      setText("");
      setNotice("已保存到本机队列，尚未确认云端保存");
    }
    await c.sync.sync();
    if (current.current === c) setNotice("云端已确认保存，快照已更新");
  }
  function parse() {
    const r = parseExpenses(text, rows);
    setDrafts(r.drafts);
    setEditing(null);
    setError(r.warnings.join("；"));
  }
  function changeDraft(i: number, key: keyof Draft, value: string) {
    setDrafts((d) =>
      d.map((row, n) => (n === i ? { ...row, [key]: value } : row)),
    );
  }
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return (
    <main>
      <h1>小账 · 云账本隔离测试</h1>
      <p className="warning">
        仅使用测试账号与虚拟账目。此页面不迁移本地账目，不更新日常小账。
      </p>
      {error && <p role="alert">{error}</p>}
      <p role="status">{notice}</p>
      {!context ? (
        <form onSubmit={(e) => void login(e)}>
          <h2>测试账号登录</h2>
          <label>
            邮箱
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            密码
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button disabled={busy}>登录</button>
          <p>密码只发送到本测试项目，本页面不保存密码。刷新后需要重新登录。</p>
        </form>
      ) : (
        <>
          <section>
            <h2>账号与同步状态</h2>
            {awaitingSnapshot && (
              <p role="alert">
                云端已确认提交，但快照尚未更新。请同步读取，不要重复提交。
              </p>
            )}
            <p>
              用户 ID：<code>{context.userId}</code>
            </p>
            <p>
              账本 ID：<code data-testid="ledger-id">{context.ledgerId}</code>
            </p>
            <p>
              待同步{" "}
              {state.operations.filter((o) => o.state === "pending").length}{" "}
              笔操作；冲突{" "}
              {state.operations.filter((o) => o.state === "conflict").length}{" "}
              笔操作
            </p>
            <button
              disabled={busy}
              onClick={() =>
                void action(async (c) => {
                  await c.api.createPersonalLedger(
                    c.ledgerId,
                    "小账虚拟测试账本",
                  );
                  await c.sync.sync();
                  if (current.current === c) setNotice("虚拟测试账本已就绪");
                })
              }
            >
              建立虚拟测试账本
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void action(async (c) => {
                  await c.sync.sync();
                  if (current.current === c)
                    setNotice("同步完成，以下为云端已确认记录");
                })
              }
            >
              同步与重试
            </button>
            <button disabled={busy} onClick={() => void logout()}>
              退出登录
            </button>
            <p>
              离线可以保存一批到本机队列；再次提交前先同步。离线刷新无法重新登录，但队列不会删除。本测试页不安装
              Service Worker。
            </p>
          </section>
          <section>
            <h2>虚拟快速记账</h2>
            <label>
              消费文字
              <textarea
                value={text}
                disabled={busy || blocked}
                onChange={(e) => setText(e.target.value)}
                placeholder="买菜38元，零食25元"
              />
            </label>
            <p>iPhone 可使用系统键盘麦克风听写。</p>
            <button
              disabled={busy || blocked || !!drafts.length}
              onClick={parse}
            >
              识别账目
            </button>
            <button
              disabled={busy || blocked || !!drafts.length}
              onClick={() => {
                setDrafts([blank()]);
                setEditing(null);
              }}
            >
              手动记账
            </button>
            {!!drafts.length && (
              <div>
                <h3>{drafts.length} 笔待确认</h3>
                {drafts.map((d, i) => (
                  <fieldset key={i}>
                    <legend>账目 {i + 1}</legend>
                    <label>
                      描述 {i + 1}
                      <input
                        value={d.description}
                        disabled={busy}
                        onChange={(e) =>
                          changeDraft(i, "description", e.target.value)
                        }
                      />
                    </label>
                    <label>
                      金额 {i + 1}
                      <input
                        inputMode="decimal"
                        value={d.amount}
                        disabled={busy}
                        onChange={(e) =>
                          changeDraft(i, "amount", e.target.value)
                        }
                      />
                    </label>
                    <label>
                      日期 {i + 1}
                      <input
                        type="date"
                        value={d.spent_on}
                        disabled={busy}
                        onChange={(e) =>
                          changeDraft(i, "spent_on", e.target.value)
                        }
                      />
                    </label>
                    <label>
                      分类 {i + 1}
                      <select
                        value={d.category}
                        disabled={busy}
                        onChange={(e) =>
                          changeDraft(i, "category", e.target.value)
                        }
                      >
                        <option value="">请选择</option>
                        <option value="necessary">必要支出</option>
                        <option value="discretionary">非必要支出</option>
                      </select>
                    </label>
                  </fieldset>
                ))}
                <button
                  disabled={busy || blocked}
                  onClick={() =>
                    void action((c) => {
                      const changes: Change[] = drafts.map((d) => {
                        const entry = makeEntry(d, editing ?? undefined);
                        return {
                          kind: editing ? "update" : "create",
                          id: entry.id,
                          expected_revision: editing?.revision ?? 0,
                          entry,
                        };
                      });
                      return submit(c, changes);
                    })
                  }
                >
                  确认提交虚拟账目
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setDrafts([]);
                    setEditing(null);
                  }}
                >
                  取消待确认
                </button>
              </div>
            )}
          </section>
          <section>
            <h2>云端已确认记录</h2>
            {!state.snapshot ? (
              <p>尚未读取成功，不能确认账本是否为空。请建立测试账本或同步。</p>
            ) : (
              <>
                <p data-testid="totals">
                  {rows.length} 笔，合计 ¥
                  {money(rows.reduce((n, r) => n + r.amount_cents, 0))}
                </p>
                {rows.map((r) => (
                  <article key={r.id}>
                    <strong>
                      {r.description} ¥{money(r.amount_cents)}
                    </strong>
                    <p>
                      {r.spent_on} ·{" "}
                      {r.category === "necessary" ? "必要支出" : "非必要支出"} ·
                      修订 {r.revision}
                    </p>
                    <button
                      disabled={busy || blocked || !!drafts.length}
                      onClick={() => {
                        setEditing(r);
                        setDrafts([
                          {
                            description: r.description,
                            amount: amountText(r.amount_cents),
                            category: r.category,
                            spent_on: r.spent_on,
                            source: r.source,
                          },
                        ]);
                      }}
                    >
                      编辑
                    </button>
                    <button
                      disabled={busy || blocked || !!drafts.length}
                      onClick={() => {
                        if (window.confirm("仅删除这笔虚拟测试记录？"))
                          void action((c) =>
                            submit(c, [
                              {
                                kind: "delete",
                                id: r.id,
                                expected_revision: r.revision,
                              },
                            ]),
                          );
                      }}
                    >
                      删除
                    </button>
                  </article>
                ))}
              </>
            )}
            {state.operations
              .filter((o) => o.state === "conflict")
              .map((o) => (
                <article key={o.operationId}>
                  <p>
                    冲突操作：{o.operationId}。原请求已保留；不会自动覆盖云端。
                  </p>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "保留云端版本，放弃这次本地修改？原请求仍保留作审计。",
                        )
                      )
                        void action(async (c) => {
                          await c.sync.keepCloudVersion(o.operationId);
                          if (current.current === c)
                            setNotice("已保留云端版本，原冲突请求留存");
                        });
                    }}
                  >
                    保留云端版本
                  </button>
                </article>
              ))}
          </section>
          <section>
            <h2>测试备份</h2>
            <button
              disabled={busy || blocked || !state.snapshot}
              onClick={() => {
                validateBackup({ version: 1, entries: rows });
                download(
                  JSON.stringify(
                    {
                      version: 1,
                      exported_at: new Date().toISOString(),
                      entries: rows.map(
                        ({ revision: _r, deleted: _d, ...e }) => e,
                      ),
                    },
                    null,
                    2,
                  ),
                  "小账-虚拟云账本.json",
                );
              }}
            >
              导出已同步虚拟 JSON
            </button>
            <p>
              有待同步或冲突时不允许导出不完整的账目备份。本轮不提供真实数据导入。
            </p>
          </section>
          <section>
            <h2>账号隔离验证</h2>
            <label>
              另一测试账号的账本 ID
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="从另一账号复制的 UUID"
              />
            </label>
            <button
              disabled={
                busy || !uuid.test(target) || target === context.ledgerId
              }
              onClick={() =>
                void action(async (c) => {
                  try {
                    await c.api.snapshot(target);
                    setError(
                      "读取成功：当前账号具有访问权限，不能判定隔离通过",
                    );
                  } catch (e) {
                    if (
                      e instanceof CloudAPIError &&
                      e.code === "42501" &&
                      e.status === 403
                    )
                      setNotice("跨账号读取被拒绝（42501）：本次验证通过");
                    else throw e;
                  }
                })
              }
            >
              检查跨账号读取
            </button>
            <button
              disabled={
                busy || !uuid.test(target) || target === context.ledgerId
              }
              onClick={() =>
                void action(async (c) => {
                  try {
                    await c.api.apply(target, crypto.randomUUID(), [
                      {
                        kind: "delete",
                        id: "__virtual_permission_probe__",
                        expected_revision: 0,
                      },
                    ]);
                    setError(
                      "写接口允许访问：不能判定隔离通过。未要求删除任何有效版本记录。",
                    );
                  } catch (e) {
                    if (
                      e instanceof CloudAPIError &&
                      e.code === "42501" &&
                      e.status === 403
                    )
                      setNotice("跨账号写入被拒绝（42501）：本次验证通过");
                    else throw e;
                  }
                })
              }
            >
              检查跨账号写入
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void action(async (c) => {
                  const response = await timedFetch(
                    `${config.url}/rest/v1/rpc/ll_snapshot`,
                    {
                      method: "POST",
                      cache: "no-store",
                      headers: {
                        apikey: config.publishableKey,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({ p_ledger_id: c.ledgerId }),
                    },
                  );
                  const value = await response.json().catch(() => ({}));
                  if (
                    [401, 403].includes(response.status) &&
                    value.code === "42501"
                  )
                    setNotice("匿名访问被拒绝（42501）：本次验证通过");
                  else
                    throw new Error(
                      "匿名访问结果未符合预期，请停止并核对；网络错误或无效密钥不算隔离通过",
                    );
                })
              }
            >
              检查匿名访问
            </button>
            <p>
              写权限探测使用不存在的虚拟 ID 和修订
              0；若权限错误地放行，只可能留下操作日志，不能删除合法修订记录。
            </p>
          </section>
        </>
      )}
    </main>
  );
}
