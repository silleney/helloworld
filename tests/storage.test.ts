import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import { IndexedDBLedger } from "../src/storage";
import { makeEntry, totals } from "../src/domain";
it("IndexedDB 保存、刷新重读、编辑、删除与撤销", async () => {
  const name = "test-" + crypto.randomUUID(),
    db = new IndexedDBLedger(name);
  const a = makeEntry({
    description: "买菜",
    amount: "38",
    category: "necessary",
    spent_on: "2026-01-01",
    source: "manual",
  });
  await db.put([a]);
  expect(await new IndexedDBLedger(name).list()).toEqual([a]);
  const updated = { ...a, amount_cents: 1234 };
  await db.put([updated]);
  expect(totals(await db.list()).total).toBe(1234);
  await db.remove(a.id);
  expect(await db.list()).toEqual([]);
  await db.put([updated]);
  expect(await db.list()).toEqual([updated]);
});
it("多笔写入为原子事务，失败不留下部分记录", async () => {
  const db = new IndexedDBLedger("atomic-" + crypto.randomUUID());
  const a = makeEntry({
    description: "买菜",
    amount: "1",
    category: "necessary",
    spent_on: "2026-01-01",
    source: "manual",
  });
  await expect(db.put([a, { ...a, id: undefined } as never])).rejects.toThrow();
  expect(await db.list()).toEqual([]);
});

it("超出安全整数总额时拒绝整个事务", async () => {
  const db = new IndexedDBLedger("limit-" + crypto.randomUUID());
  const a = makeEntry({
    description: "买菜",
    amount: "1",
    category: "necessary",
    spent_on: "2026-01-01",
    source: "manual",
  });
  await expect(
    db.put([
      { ...a, amount_cents: Number.MAX_SAFE_INTEGER },
      { ...a, id: crypto.randomUUID() },
    ]),
  ).rejects.toThrow("精确计算范围");
  expect(await db.list()).toEqual([]);
});
