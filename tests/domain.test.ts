import { describe, it, expect } from "vitest";
import {
  amountText,
  exportCSV,
  localDate,
  makeEntry,
  parseExpenses,
  planImport,
  suggestCategory,
  toCents,
  totals,
  validateBackup,
  validDate,
} from "../src/domain";
import type { Entry } from "../src/domain";
const today = "2026-01-01";
const entry = (description = "买菜", amount = "38.00"): Entry =>
  makeEntry({
    description,
    amount,
    category: "necessary",
    spent_on: today,
    source: "manual",
  });
describe("精确金额与本地日期", () => {
  it.each([
    ["0.01", 1],
    ["12.5", 1250],
    ["12.50", 1250],
    ["38", 3800],
    ["999999999", 99999999900],
  ])("%s 转为整数分", (a, c) => expect(toCents(a)).toBe(c));
  it.each(["0", "-1", "1.234", "NaN", "1e3", "999999999.99", "Infinity"])(
    "拒绝非法金额 %s",
    (a) => expect(() => toCents(a)).toThrow(),
  );
  it("相加不会产生浮点误差", () =>
    expect(totals([entry("一", "0.10"), entry("二", "0.20")]).total).toBe(30));
  it("校验闰日并使用本地日期", () => {
    expect(validDate("2024-02-29")).toBe(true);
    expect(validDate("2025-02-29")).toBe(false);
    expect(validDate("2026-13-01")).toBe(false);
    expect(localDate(new Date(2026, 0, 1, 0, 1))).toBe(today);
  });
});
describe("中文消费解析", () => {
  it.each([
    ["38元", "38.00"],
    ["三十八块", "38.00"],
    ["12块5", "12.50"],
    ["12.50元", "12.50"],
    ["一百二十元五角", "120.50"],
    ["十二元五角二分", "12.52"],
    ["三点五元", "3.50"],
  ])("解析 %s", (a, b) =>
    expect(parseExpenses("买菜花了" + a, [], today).drafts[0].amount).toBe(b),
  );
  it("一句话多笔，保留消费内容", () => {
    const { drafts } = parseExpenses(
      "今天买菜花了38块，买零食花了25块。",
      [],
      today,
    );
    expect(drafts).toHaveLength(2);
    expect(drafts.map((d) => [d.description, d.amount, d.category])).toEqual([
      ["买菜", "38.00", "necessary"],
      ["买零食", "25.00", "discretionary"],
    ]);
  });
  it("商品数量不是金额", () => {
    const r = parseExpenses("买了2斤苹果花了18元", [], today);
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0].amount).toBe("18.00");
    expect(r.drafts[0].description).toBe("买了2斤苹果");
    expect(parseExpenses("买了2斤苹果", [], today).drafts).toHaveLength(0);
  });
  it.each([
    "买菜大约20元",
    "买菜20元还是30元",
    "买菜-5元",
    "买菜12.345元",
    "买菜三点一二三元",
    "买菜12块50",
  ])("歧义金额不编造：%s", (text) =>
    expect(parseExpenses(text, [], today).drafts).toHaveLength(0),
  );
  it("消费描述缺失不编造", () =>
    expect(parseExpenses("38元", [], today).drafts).toHaveLength(0));
  it("昨天正确跨年", () =>
    expect(parseExpenses("昨天买菜20元", [], today).drafts[0].spent_on).toBe(
      "2025-12-31",
    ));
  it("未识别片段提示核对", () =>
    expect(
      parseExpenses("买菜20元，买了咖啡", [], today).warnings.length,
    ).toBeGreaterThan(0));
  it("未知或上下文敏感商品待确认", () => {
    expect(suggestCategory("咖啡", [])).toBe("");
    expect(suggestCategory("礼物", [])).toBe("");
    expect(suggestCategory("其他", [])).toBe("");
  });
  it("用户最新历史分类优先", () =>
    expect(
      suggestCategory("买菜", [{ ...entry(), category: "discretionary" }]),
    ).toBe("discretionary"));
  it("保存要求分类和必填字段", () => {
    expect(() =>
      makeEntry({
        description: "买菜",
        amount: "12",
        category: "",
        spent_on: today,
        source: "voice",
      }),
    ).toThrow();
    expect(() => entry("")).toThrow();
  });
});
describe("备份与恢复", () => {
  it("完整往返、重复导入跳过", () => {
    const a = entry();
    const restored = validateBackup(
      JSON.parse(JSON.stringify({ version: 1, entries: [a] })),
    );
    expect(restored).toEqual([a]);
    expect(planImport([a], restored)).toEqual({ add: [], skipped: 1 });
    expect(planImport([], restored).add).toEqual([a]);
  });
  it("同 ID 不同内容不会覆盖", () => {
    const a = entry();
    expect(() => planImport([a], [{ ...a, amount_cents: 1 }])).toThrow(
      /取消导入/,
    );
  });
  it.each([
    { amount_cents: 0 },
    { amount_cents: 1.2 },
    { category: "income" },
    { spent_on: "2026-02-30" },
    { source: "unknown" },
    { created_at: "invalid" },
    { description: "" },
  ])("异常记录拒绝整份备份", (bad) =>
    expect(() =>
      validateBackup({
        version: 1,
        entries: [entry(), { ...entry(), ...bad }],
      }),
    ).toThrow(),
  );
  it("拒绝重复 ID", () => {
    const a = entry();
    expect(() => validateBackup({ version: 1, entries: [a, a] })).toThrow();
  });
  it("CSV 正确转义且防止公式执行", () => {
    const csv = exportCSV([entry("=SUM(1,2)")]);
    expect(csv).toContain('"\'=SUM(1,2)"');
    expect(csv).toContain("38.00");
    expect(amountText(1)).toBe("0.01");
  });
});

it("备份比较不依赖 JSON 属性顺序", () => {
  const a = entry();
  const b = Object.fromEntries(Object.entries(a).reverse()) as Entry;
  expect(planImport([b], [a]).skipped).toBe(1);
});
