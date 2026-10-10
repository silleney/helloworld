import { expandDraft } from "./helpers";
import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import type { Entry } from "../../src/domain";
import type { Page } from "@playwright/test";

// All browsers are Playwright's nonpersistent isolated contexts, never a user's
// Safari profile. The same production database name is needed to test upgrades.
const v10 = "ca270f6e143fe992812c7f4dee36a7a5a5d22610";
function oldFiles() {
  const files = new Map<string, Buffer>();
  const paths = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", v10, "site"],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n");
  for (const path of paths)
    files.set(
      "/" + path.slice(5),
      execFileSync("git", ["show", `${v10}:${path}`], {
        maxBuffer: 10 * 1024 * 1024,
      }),
    );
  return files;
}
function currentFiles() {
  const files = new Map<string, Buffer>();
  const root = resolve("dist");
  function walk(dir: string) {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, f.name);
      if (f.isDirectory()) walk(path);
      else files.set("/" + relative(root, path), readFileSync(path));
    }
  }
  walk(root);
  return files;
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const q = indexedDB.open("little-ledger-v1", 1);
      // Abort if unexpectedly missing; inspection never creates a replacement.
      q.onupgradeneeded = () => q.transaction!.abort();
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
    try {
      return await new Promise<Entry[]>((resolve, reject) => {
        const tx = db.transaction("entries", "readonly");
        const q = tx.objectStore("entries").getAll();
        tx.oncomplete = () => resolve(q.result);
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });
}

test("V1.0 多笔真实保存 → V1.2 PWA 更新与 JSON 往返不改变账目", async ({
  page,
  browser,
}) => {
  let files = oldFiles();
  const server = createServer((req, res) => {
    const path = new URL(req.url!, "http://localhost").pathname;
    const data = files.get(path === "/" ? "/index.html" : path);
    if (!data) {
      res.writeHead(404);
      res.end();
      return;
    }
    const type = path.endsWith(".js")
      ? "application/javascript"
      : path.endsWith(".css")
        ? "text/css"
        : path.endsWith(".webmanifest")
          ? "application/manifest+json"
          : path.endsWith(".png")
            ? "image/png"
            : path.endsWith(".svg")
              ? "image/svg+xml"
              : "text/html";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(data);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await page.goto(origin);
    await expect(page.getByRole("button", { name: "识别账目" })).toBeEnabled();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    await page.getByLabel("今天花了什么？").fill("买菜38元，零食25元");
    await page.getByRole("button", { name: "识别账目" }).click();
    await expandDraft(page, 1);
    await page.getByLabel("消费日期 1", { exact: true }).fill("2025-12-31");
    await page.getByRole("button", { name: "确认保存 2 笔" }).click();
    await expect(page.locator(".entry")).toHaveCount(2);
    const before = await records(page);
    expect(before).toHaveLength(2);
    // Confirm that initial load/upgrade itself performs no data write or deletion.
    await page.evaluate(() => {
      for (const method of ["put", "add", "delete", "clear"] as const) {
        IDBObjectStore.prototype[method] = (() => {
          throw new Error("升级期间禁止写入或删除");
        }) as never;
      }
      indexedDB.deleteDatabase = () => {
        throw new Error("升级期间禁止删除数据库");
      };
    });
    await page.context().addInitScript(() => {
      for (const method of ["put", "add", "delete", "clear"] as const)
        IDBObjectStore.prototype[method] = (() => {
          throw new Error("升级期间禁止写入或删除");
        }) as never;
      indexedDB.deleteDatabase = () => {
        throw new Error("升级期间禁止删除数据库");
      };
    });
    files = currentFiles();
    await page.evaluate(async () =>
      (await navigator.serviceWorker.getRegistration())!.update(),
    );
    await page.getByRole("button", { name: "更新应用", exact: true }).click();
    const css = [...files.keys()].find((path) => path.endsWith(".css"))!;
    await page.waitForFunction(
      (css) =>
        [...document.querySelectorAll("link[rel=stylesheet]")].some((el) =>
          (el as HTMLLinkElement).href.endsWith(css),
        ),
      css,
    );
    await expect.poll(() => records(page)).toEqual(before);
    await expect(page.locator(".entry")).toHaveCount(2);
    const version = await page.evaluate(async () => {
      const q = indexedDB.open("little-ledger-v1", 1);
      return new Promise<number>((r) => {
        q.onsuccess = () => {
          const v = q.result.version;
          q.result.close();
          r(v);
        };
      });
    });
    expect(version).toBe(1);
    // New parser demonstrates that the current page is V1.2, not stale V1.0.
    await page.getByLabel("今天花了什么？").fill("买菜¥0.10");
    await page.getByRole("button", { name: "识别账目" }).click();
    await expect(page.getByLabel("金额 1", { exact: true })).toHaveValue(
      "0.10",
    );
    await page.getByRole("button", { name: "取消待确认", exact: true }).click();
    await page.getByRole("button", { name: "仅当前浏览器" }).click();
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 JSON 完整备份" }).click();
    const file = (await (await downloaded).path())!;
    const backup = JSON.parse(readFileSync(file, "utf8"));
    expect(
      backup.entries.sort((a: { id: string }, b: { id: string }) =>
        a.id.localeCompare(b.id),
      ),
    ).toEqual(
      [...before].sort((a: Entry, b: Entry) => a.id.localeCompare(b.id)),
    );
    const context = await browser.newContext();
    try {
      const restored = await context.newPage();
      await restored.goto(origin);
      await expect(
        restored.getByRole("button", { name: "识别账目" }),
      ).toBeEnabled();
      await restored.getByRole("button", { name: "仅当前浏览器" }).click();
      await restored.locator("input[type=file]").setInputFiles(file);
      await restored
        .getByRole("button", { name: "确认恢复", exact: true })
        .click();
      await expect(restored.getByRole("status")).toContainText("新增 2 笔");
      expect(await records(restored)).toEqual(before);
    } finally {
      await context.close();
    }
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
});

test("读取失败明确报错，不能显示正常零账本或导出空备份", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "识别账目" })).toBeEnabled();
  await page.getByLabel("今天花了什么？").fill("买菜38元，零食25元");
  await page.getByRole("button", { name: "识别账目" }).click();
  await page.getByRole("button", { name: "确认保存 2 笔" }).click();
  await expect(page.locator(".entry")).toHaveCount(2);
  const before = await records(page);
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.getAll;
    (window as unknown as { restoreGetAll: () => void }).restoreGetAll = () => {
      IDBObjectStore.prototype.getAll = original;
    };
    IDBObjectStore.prototype.getAll = () => {
      throw new Error("模拟只读事务失败");
    };
  });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("账本未能读取");
  await expect(page.getByRole("alert")).toContainText("模拟只读事务失败");
  await expect(page.locator(".big-money")).toHaveCount(0);
  await expect(page.getByText("还没有账目", { exact: true })).toHaveCount(0);
  for (const name of ["消费流水", "统计分析"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.locator(".ledger-total, .donut")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "仅当前浏览器" }).click();
  await expect(
    page.getByRole("button", { name: "导出 JSON 完整备份" }),
  ).toBeDisabled();
  await expect(
    page.getByText("尚无法确认记录数量。", { exact: false }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { restoreGetAll: () => void }).restoreGetAll(),
  );
  expect(await records(page)).toEqual(before);
});
