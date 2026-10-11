import { test, expect, type BrowserContext, type Page } from "@playwright/test";
const A = "00000000-0000-0000-0000-000000000001",
  B = "00000000-0000-0000-0000-000000000002";
type Row = {
  id: string;
  amount_cents: number;
  description: string;
  revision: number;
  deleted: boolean;
  [key: string]: unknown;
};
class VirtualServer {
  ledgers = new Map<string, { revision: number; rows: Row[] }>();
  operations = new Map<string, unknown>();
  lost = false;
  offline = false;
  forceConflict = false;
  failSnapshot = false;
  async install(context: BrowserContext) {
    await context.route("**/*", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (url.hostname === "127.0.0.1") return route.continue();
      if (url.hostname !== "zxoqvkhplrprinhetzid.supabase.co")
        return route.abort();
      if (this.offline) return route.abort();
      const body = req.postDataJSON() ?? {};
      const token = req.headers()["authorization"]?.replace("Bearer ", "");
      const reply = (value: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify(value),
        });
      if (req.method() === "OPTIONS")
        return route.fulfill({
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "POST",
          },
        });
      if (url.pathname === "/auth/v1/token") {
        if (body.password !== "virtual-password") return reply({}, 400);
        const uid = body.email === "a@example.invalid" ? A : B;
        return reply({
          access_token: uid,
          refresh_token: "virtual-refresh",
          expires_in: 3600,
          user: { id: uid },
        });
      }
      if (url.pathname === "/auth/v1/logout") return reply({});
      const ledgerId = body.p_ledger_id;
      if (token !== ledgerId) return reply({ code: "42501" }, 403);
      if (url.pathname.endsWith("ll_create_personal_ledger")) {
        if (!this.ledgers.has(ledgerId))
          this.ledgers.set(ledgerId, { revision: 0, rows: [] });
        return reply(ledgerId);
      }
      const l = this.ledgers.get(ledgerId);
      if (!l) return reply({ code: "42501" }, 403);
      if (url.pathname.endsWith("ll_snapshot")) {
        if (this.failSnapshot && l.revision > 0) return route.abort();
        return reply({ ledger_revision: l.revision, rows: l.rows });
      }
      if (url.pathname.endsWith("ll_apply_operation")) {
        const key = ledgerId + body.p_operation_id;
        if (this.operations.has(key)) return reply(this.operations.get(key));
        const conflict =
          this.forceConflict ||
          body.p_changes.some((c: any) => {
            const old = l.rows.find((r) => r.id === c.id);
            return c.kind === "create"
              ? !!old
              : !old || old.revision !== c.expected_revision || old.deleted;
          });
        if (!conflict) {
          l.revision++;
          for (const c of body.p_changes) {
            const old = l.rows.find((r) => r.id === c.id);
            if (c.kind === "delete") {
              old!.deleted = true;
              old!.revision = l.revision;
            } else if (old) {
              Object.assign(old, c.entry, {
                revision: l.revision,
                deleted: false,
              });
            } else
              l.rows.push({ ...c.entry, revision: l.revision, deleted: false });
          }
        }
        const result = {
          status: conflict ? "conflict" : "applied",
          ledger_revision: l.revision,
        };
        this.operations.set(key, result);
        if (this.lost) {
          this.lost = false;
          return route.abort();
        }
        return reply(result);
      }
      return reply({}, 404);
    });
  }
}
async function login(page: Page, email = "a@example.invalid") {
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill("virtual-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
}
async function create(page: Page) {
  await page.getByRole("button", { name: "建立虚拟测试账本" }).click();
  await expect(page.getByTestId("totals")).toContainText("0 笔");
}
async function draft(page: Page, text = "买菜¥38，零食￥25") {
  await page.getByLabel("消费文字").fill(text);
  await page.getByRole("button", { name: "识别账目", exact: true }).click();
}
test("login, confirmed two records, edit/delete, V1 export, no tokens stored", async ({
  page,
  context,
}) => {
  const server = new VirtualServer();
  await server.install(context);
  await page.goto("/");
  await login(page);
  await expect(page.getByTestId("totals")).toHaveCount(0);
  await create(page);
  await draft(page);
  expect(server.ledgers.get(A)!.rows).toHaveLength(0);
  await page.getByRole("button", { name: "确认提交虚拟账目" }).click();
  await expect(page.getByTestId("totals")).toContainText("2 笔，合计 ¥63.00");
  await page.getByRole("button", { name: "编辑", exact: true }).first().click();
  await page.getByLabel("金额 1", { exact: true }).fill("40");
  await page.getByRole("button", { name: "确认提交虚拟账目" }).click();
  await expect(page.getByTestId("totals")).toContainText("¥65.00");
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "删除", exact: true }).last().click();
  await expect(page.getByTestId("totals")).toContainText("1 笔，合计 ¥40.00");
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出已同步虚拟 JSON" }).click();
  const file = await (await event).path();
  const data = JSON.parse(
    (await import("node:fs")).readFileSync(file!, "utf8"),
  );
  expect(data.version).toBe(1);
  expect(data.entries[0].revision).toBeUndefined();
  expect(data.entries[0].amount_cents).toBe(4000);
  const saved = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const q = indexedDB.open("little-ledger-cloud-v1", 1);
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
    const s = await new Promise((resolve) => {
      const tx = db.transaction("states");
      const q = tx.objectStore("states").getAll();
      tx.oncomplete = () => resolve(q.result);
    });
    db.close();
    return (
      JSON.stringify(s) +
      JSON.stringify(localStorage) +
      JSON.stringify(sessionStorage)
    );
  });
  expect(saved).not.toContain("virtual-password");
  expect(saved).not.toContain("access_token");
  expect(saved).not.toContain("virtual-refresh");
  expect(
    await page.evaluate(() =>
      navigator.serviceWorker.getRegistrations().then((r) => r.length),
    ),
  ).toBe(0);
});
test("commit response lost, double click, reopen, retry uses exact operation", async ({
  page,
  context,
}) => {
  const server = new VirtualServer();
  await server.install(context);
  await page.goto("/");
  await login(page);
  await create(page);
  await draft(page, "买菜38元");
  server.lost = true;
  await page.getByRole("button", { name: "确认提交虚拟账目" }).dblclick();
  await expect(page.getByText(/待同步 1 笔操作/)).toBeVisible();
  expect(server.ledgers.get(A)!.rows).toHaveLength(1);
  expect(server.operations.size).toBe(1);
  await expect(
    page.getByRole("button", { name: "导出已同步虚拟 JSON" }),
  ).toBeDisabled();
  await page.reload();
  await login(page);
  await expect(page.getByText(/待同步 1 笔操作/)).toBeVisible();
  await page.getByRole("button", { name: "同步与重试" }).click();
  await expect(page.getByTestId("totals")).toContainText("1 笔，合计 ¥38.00");
  expect(server.operations.size).toBe(1);
});
test("offline pending, network recovery, no premature cloud success", async ({
  page,
  context,
}) => {
  const server = new VirtualServer();
  await server.install(context);
  await page.goto("/");
  await login(page);
  await create(page);
  await draft(page, "买菜38元");
  server.offline = true; // Route.fulfill otherwise bypasses Playwright offline emulation.
  await context.setOffline(true);
  await page.getByRole("button", { name: "确认提交虚拟账目" }).click();
  await expect(page.getByText(/待同步 1 笔操作/)).toBeVisible();
  expect(server.operations.size).toBe(0);
  await expect(page.getByTestId("totals")).toContainText("0 笔");
  server.offline = false;
  await context.setOffline(false);
  await page.getByRole("button", { name: "同步与重试" }).click();
  await expect(page.getByTestId("totals")).toContainText("1 笔");
});
test("logout B hides A cache, forbidden read/write clearly reported", async ({
  page,
  context,
}) => {
  const server = new VirtualServer();
  await server.install(context);
  await page.goto("/");
  await login(page);
  await create(page);
  await draft(page, "买菜38元");
  await page.getByRole("button", { name: "确认提交虚拟账目" }).click();
  await expect(page.getByTestId("totals")).toContainText("1 笔");
  await page.getByRole("button", { name: "退出登录" }).click();
  await login(page, "b@example.invalid");
  await expect(page.getByTestId("totals")).toHaveCount(0);
  await create(page);
  await expect(page.getByTestId("totals")).toContainText("0 笔");
  await page.getByLabel("另一测试账号的账本 ID").fill(A);
  await page.getByRole("button", { name: "检查跨账号读取" }).click();
  await expect(page.getByRole("status")).toContainText("跨账号读取被拒绝");
  await page.getByRole("button", { name: "检查跨账号写入" }).click();
  await expect(page.getByRole("status")).toContainText("跨账号写入被拒绝");
  await page.getByRole("button", { name: "检查匿名访问" }).click();
  await expect(page.getByRole("status")).toContainText("匿名访问被拒绝");
  expect(server.ledgers.get(A)!.rows).toHaveLength(1);
});
test("conflict stays blocked until explicit keep-cloud choice", async ({
  page,
  context,
}) => {
  const server = new VirtualServer();
  await server.install(context);
  await page.goto("/");
  await login(page);
  await create(page);
  await draft(page, "买菜38元");
  server.forceConflict = true;
  await page.getByRole("button", { name: "确认提交虚拟账目" }).click();
  await expect(page.getByText(/冲突 1 笔操作/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "识别账目", exact: true }),
  ).toBeDisabled();
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "保留云端版本", exact: true }).click();
  await expect(page.getByText(/冲突 0 笔操作/)).toBeVisible();
  expect(server.ledgers.get(A)!.rows).toHaveLength(0);
  await expect(
    page.getByRole("button", { name: "识别账目", exact: true }),
  ).toBeEnabled();
});

test("two devices read same ledger; stale edit conflicts without overwrite", async ({
  page,
  context,
  browser,
}) => {
  const server = new VirtualServer();
  await server.install(context);
  await page.goto("/");
  await login(page);
  await create(page);
  await draft(page, "买菜38元");
  await page.getByRole("button", { name: "确认提交虚拟账目" }).click();
  await expect(page.getByTestId("totals")).toContainText("¥38.00");
  const second = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await server.install(second);
  const p = await second.newPage();
  try {
    await p.goto("http://127.0.0.1:4175/");
    await login(p);
    await p.getByRole("button", { name: "同步与重试" }).click();
    await expect(p.getByTestId("totals")).toContainText("¥38.00");
    await p.getByRole("button", { name: "编辑", exact: true }).click();
    await p.getByLabel("金额 1", { exact: true }).fill("50");
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByLabel("金额 1", { exact: true }).fill("40");
    await page.getByRole("button", { name: "确认提交虚拟账目" }).click();
    await expect(page.getByTestId("totals")).toContainText("¥40.00");
    await p.getByRole("button", { name: "确认提交虚拟账目" }).click();
    await expect(p.getByText(/冲突 1 笔操作/)).toBeVisible();
    await expect(p.getByTestId("totals")).toContainText("¥40.00");
    expect(server.ledgers.get(A)!.rows[0].amount_cents).toBe(4000);
    expect(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await p.screenshot({
      path: "/tmp/little-ledger-cloud-conflict-390.png",
      fullPage: true,
    });
  } finally {
    await second.close();
  }
});
test("confirmed commit with failed snapshot blocks duplicate input until refresh", async ({
  page,
  context,
}) => {
  const server = new VirtualServer();
  await server.install(context);
  await page.goto("/");
  await login(page);
  await create(page);
  await draft(page, "买菜38元");
  server.failSnapshot = true;
  await page.getByRole("button", { name: "确认提交虚拟账目" }).click();
  await expect(
    page.getByText(
      "云端已确认提交，但快照尚未更新。请同步读取，不要重复提交。",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "识别账目", exact: true }),
  ).toBeDisabled();
  expect(server.operations.size).toBe(1);
  server.failSnapshot = false;
  await page.getByRole("button", { name: "同步与重试" }).click();
  await expect(page.getByTestId("totals")).toContainText("1 笔，合计 ¥38.00");
  await expect(
    page.getByRole("button", { name: "识别账目", exact: true }),
  ).toBeEnabled();
  expect(server.operations.size).toBe(1);
});
