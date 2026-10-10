import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
async function open(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "识别账目" })).toBeEnabled();
}
async function manual(page: Page, name = "买菜", amount = "38", date?: string) {
  await page.getByRole("button", { name: "手动记账", exact: true }).click();
  await page
    .getByRole("textbox", { name: "消费内容 1", exact: true })
    .fill(name);
  await page.getByRole("textbox", { name: "金额 1", exact: true }).fill(amount);
  if (date) await page.getByLabel("消费日期 1", { exact: true }).fill(date);
  await page.getByLabel("分类 1", { exact: true }).selectOption("necessary");
  await page.getByRole("button", { name: "确认保存 1 笔" }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
}
test("多笔解析必须确认，增删改、统计、刷新与撤销", async ({ page }) => {
  await open(page);
  await page
    .getByLabel("今天花了什么？")
    .fill("今天买菜花了38块，买零食花了25块。");
  await page.getByRole("button", { name: "识别账目" }).click();
  await expect(page.getByRole("heading", { name: "还没有账目" })).toHaveCount(
    0,
  );
  await expect(page.getByText("还没有账目", { exact: true })).toBeVisible();
  await expect(page.getByLabel("金额 1", { exact: true })).toHaveValue("38.00");
  await expect(page.getByLabel("分类 1", { exact: true })).toHaveValue(
    "necessary",
  );
  await page.getByLabel("金额 2", { exact: true }).fill("12.50");
  await page.getByRole("button", { name: "确认保存 2 笔" }).dblclick();
  await expect(page.getByRole("status")).toContainText("已保存 2 笔");
  await expect(page.locator(".big-money")).toContainText("50.50");
  await page.reload();
  await expect(page.locator(".entry")).toHaveCount(2);
  await page.getByRole("button", { name: "编辑 买菜", exact: true }).click();
  await page.getByLabel("金额 1", { exact: true }).fill("30.10");
  await page
    .getByLabel("分类 1", { exact: true })
    .selectOption("discretionary");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.locator(".big-money")).toContainText("42.60");
  await page.getByRole("button", { name: "删除 买菜", exact: true }).click();
  await page.getByRole("button", { name: "保留账目" }).click();
  await expect(page.locator(".entry")).toHaveCount(2);
  await page.getByRole("button", { name: "删除 买菜", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.locator(".entry")).toHaveCount(1);
  await expect(page.locator(".big-money")).toContainText("12.50");
  await page.getByRole("button", { name: "撤销删除", exact: true }).click();
  await expect(page.locator(".entry")).toHaveCount(2);
  await page.getByRole("button", { name: "统计分析", exact: true }).click();
  await expect(page.locator(".donut")).toHaveAttribute(
    "aria-label",
    /非必要开支 42.60 元/,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("手动校验、未知分类与取消待确认不会入账", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "手动记账", exact: true }).click();
  await page.getByRole("button", { name: "确认保存 1 笔" }).click();
  await expect(page.getByRole("alert")).toContainText("消费内容");
  await page.getByLabel("消费内容 1", { exact: true }).fill("咖啡");
  await page.getByLabel("金额 1", { exact: true }).fill("0");
  await page
    .getByLabel("分类 1", { exact: true })
    .selectOption("discretionary");
  await page.getByRole("button", { name: "确认保存 1 笔" }).click();
  await expect(page.getByRole("alert")).toContainText("金额");
  await page.getByRole("button", { name: "取消待确认", exact: true }).click();
  await expect(page.locator(".entry")).toHaveCount(0);
  await page.getByLabel("今天花了什么？").fill("咖啡12块5");
  await page.getByRole("button", { name: "识别账目" }).click();
  await expect(page.getByLabel("分类 1", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "确认保存 1 笔" }).click();
  await expect(page.getByRole("alert")).toContainText("请选择");
  await page
    .getByLabel("分类 1", { exact: true })
    .selectOption("discretionary");
  await page.getByRole("button", { name: "确认保存 1 笔" }).click();
  await expect(page.locator(".entry")).toHaveCount(1);
});
test("JSON 备份、重复恢复与异常文件拒绝", async ({ page }) => {
  await open(page);
  await manual(page);
  await page.getByRole("button", { name: "仅当前浏览器" }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON 完整备份" }).click();
  const path = await (await downloaded).path();
  expect(path).toBeTruthy();
  await page.locator("input[type=file]").setInputFiles(path!);
  await page.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("新增 0 笔，跳过 1 笔");
  await expect(page.locator(".entry")).toHaveCount(1);
  await page.getByRole("button", { name: "仅当前浏览器" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ version: 1, entries: [{ amount_cents: -10 }] }),
    ),
  });
  await expect(page.getByRole("alert")).toContainText("无效");
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await expect(page.locator(".entry")).toHaveCount(1);
});
test("离线刷新、保存和未提交输入保留", async ({ page, context }) => {
  await open(page);
  await page.evaluate(
    async () => !!(await navigator.serviceWorker.ready).active,
  );
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "识别账目" })).toBeEnabled();
  await manual(page, "离线买菜", "0.10");
  await page.getByLabel("今天花了什么？").fill("买零食0.20元");
  await page.getByRole("button", { name: "识别账目" }).click();
  await page.reload();
  await expect(page.getByLabel("消费内容 1", { exact: true })).toHaveValue(
    "买零食",
  );
  await page.getByRole("button", { name: "确认保存 1 笔" }).click();
  await expect(page.locator(".big-money")).toContainText("0.30");
  await expect(page.locator(".entry")).toHaveCount(2);
});
test("历史月份与跨年统计", async ({ page }) => {
  await open(page);
  await manual(page, "去年买菜", "10.50", "2025-12-31");
  await manual(page, "今年地铁", "2.30", "2026-01-01");
  await page.getByRole("button", { name: "消费流水", exact: true }).click();
  await page.getByLabel("月份", { exact: true }).selectOption("2025-12");
  await expect(page.locator(".entry")).toHaveCount(1);
  await expect(page.locator(".ledger-total")).toContainText("10.50");
  await page.getByRole("button", { name: "统计分析", exact: true }).click();
  await expect(page.locator(".donut")).toHaveAttribute("aria-label", /10.50/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("月份", { exact: true }).selectOption("2026-01");
  await expect(page.locator(".donut")).toHaveAttribute("aria-label", /2.30/);
});
test("不支持网页语音时仍可手动输入", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", { value: undefined });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      value: undefined,
    });
  });
  await open(page);
  await expect(
    page.getByRole("button", { name: "语音输入", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("iPhone 可点击系统键盘麦克风，直接听写"),
  ).toBeVisible();
  await manual(page);
  await expect(page.locator(".entry")).toHaveCount(1);
});
test("麦克风拒绝不产生账目，手动输入可用", async ({ page }) => {
  await page.addInitScript(() => {
    class MockSpeech {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: unknown = null;
      onerror: ((e: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        setTimeout(() => this.onerror?.({ error: "not-allowed" }), 50);
      }
      abort() {
        this.onend?.();
      }
    }
    Object.defineProperty(window, "SpeechRecognition", { value: MockSpeech });
  });
  await open(page);
  await page.getByRole("button", { name: "语音输入", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("权限被拒绝");
  await expect(page.locator(".entry")).toHaveCount(0);
  await manual(page);
  await expect(page.locator(".entry")).toHaveCount(1);
});
test("保存失败保留输入，修复存储后重试", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "手动记账", exact: true }).click();
  await page.getByLabel("消费内容 1", { exact: true }).fill("买菜");
  await page.getByLabel("金额 1", { exact: true }).fill("38");
  await page.getByLabel("分类 1", { exact: true }).selectOption("necessary");
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    (window as unknown as { restore: () => void }).restore = () => {
      IDBDatabase.prototype.transaction = original;
    };
    IDBDatabase.prototype.transaction = function (
      ...args: Parameters<typeof original>
    ) {
      if (args[1] === "readwrite") throw new Error("测试存储空间不足");
      return original.apply(this, args);
    };
  });
  await page.getByRole("button", { name: "确认保存 1 笔" }).click();
  await expect(page.getByRole("alert")).toContainText("存储空间不足");
  await expect(page.getByLabel("金额 1", { exact: true })).toHaveValue("38");
  await expect(page.locator(".entry")).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { restore: () => void }).restore(),
  );
  await page.getByRole("button", { name: "确认保存 1 笔" }).click();
  await expect(page.locator(".entry")).toHaveCount(1);
});

test("语音结果仍须确认，空结果和取消不会入账", async ({ page }) => {
  await page.addInitScript(() => {
    class MockSpeech {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult:
        | ((e: { results: { 0: { 0: { transcript: string } } } }) => void)
        | null = null;
      onerror: unknown = null;
      onend: (() => void) | null = null;
      start() {
        (window as unknown as { mock: MockSpeech }).mock = this;
      }
      abort() {
        this.onend?.();
      }
    }
    Object.defineProperty(window, "SpeechRecognition", { value: MockSpeech });
  });
  await open(page);
  await page.getByRole("button", { name: "语音输入", exact: true }).click();
  await page.evaluate(() =>
    (
      window as unknown as {
        mock: { onresult: (e: unknown) => void; onend: () => void };
      }
    ).mock.onresult({ results: { 0: { 0: { transcript: "" } } } }),
  );
  await expect(page.getByRole("alert")).toContainText("没有听到");
  await page.getByRole("button", { name: "取消语音", exact: true }).click();
  await expect(page.locator(".entry")).toHaveCount(0);
  await page.getByRole("button", { name: "语音输入", exact: true }).click();
  await page.getByRole("button", { name: "取消语音", exact: true }).click();
  await page.evaluate(() => {
    (
      window as unknown as { mock: { onresult: ((e: unknown) => void) | null } }
    ).mock.onresult?.({ results: { 0: { 0: { transcript: "买菜38元" } } } });
  });
  await expect(page.getByLabel("今天花了什么？")).toHaveValue("");
  await page.getByRole("button", { name: "语音输入", exact: true }).click();
  await page.evaluate(() => {
    const m = (
      window as unknown as {
        mock: { onresult: (e: unknown) => void; onend: () => void };
      }
    ).mock;
    m.onresult({ results: { 0: { 0: { transcript: "买菜三十八元" } } } });
    m.onend();
  });
  await expect(page.getByLabel("今天花了什么？")).toHaveValue("买菜三十八元");
  await expect(page.locator(".entry")).toHaveCount(0);
  await page.getByRole("button", { name: "识别账目" }).click();
  await page.getByRole("button", { name: "确认保存 1 笔" }).click();
  await expect(page.locator(".entry")).toHaveCount(1);
});
test("新浏览器从 JSON 恢复，冲突不覆盖，CSV 可导出", async ({
  page,
  browser,
}) => {
  await open(page);
  await manual(page);
  await page.getByRole("button", { name: "仅当前浏览器" }).click();
  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON 完整备份" }).click();
  const file = await (await download).path();
  const context = await browser.newContext();
  try {
    const second = await context.newPage();
    await open(second);
    await second.locator("input[type=file]").setInputFiles(file!);
    await second.getByRole("button", { name: "确认恢复", exact: true }).click();
    await expect(second.locator(".entry")).toHaveCount(1);
    await expect(second.locator(".big-money")).toContainText("38.00");
    await second
      .getByRole("button", { name: "编辑 买菜", exact: true })
      .click();
    await second.getByLabel("金额 1", { exact: true }).fill("12");
    await second.getByRole("button", { name: "保存修改", exact: true }).click();
    await second.getByRole("button", { name: "仅当前浏览器" }).click();
    await second.locator("input[type=file]").setInputFiles(file!);
    await expect(second.getByRole("alert")).toContainText("内容不同");
    await second.getByRole("button", { name: "关闭弹窗" }).click();
    await expect(second.locator(".big-money")).toContainText("12.00");
  } finally {
    await context.close();
  }
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 CSV 流水" }).click();
  expect((await download).suggestedFilename()).toContain(".csv");
});

test("V1.1 符号解析、精确合计、取消保留原文与零候选反馈", async ({
  page,
}, testInfo) => {
  await open(page);
  const input = page.getByLabel("今天花了什么？");
  await input.fill("买菜¥0.10，零食￥0.20元");
  await page.getByRole("button", { name: "识别账目" }).click();
  await expect(page.locator(".draft-row")).toHaveCount(2);
  await expect(page.locator(".entry")).toHaveCount(0);
  if (testInfo.project.name === "iphone-size") {
    await expect(page.locator(".mobile-draft-total")).toContainText(
      "合计 ¥ 0.30",
    );
    await page.getByLabel("金额 2", { exact: true }).fill("1.234");
    await expect(page.locator(".mobile-draft-total")).toContainText(
      "合计待核对",
    );
  }
  await page.getByRole("button", { name: "取消待确认", exact: true }).click();
  await expect(input).toHaveValue("买菜¥0.10，零食￥0.20元");
  await page.reload();
  await expect(input).toHaveValue("买菜¥0.10，零食￥0.20元");
  await input.fill("买2斤苹果");
  await page.getByRole("button", { name: "识别账目" }).click();
  await expect(input).toHaveValue("买2斤苹果");
  await expect(page.locator(".entry")).toHaveCount(0);
  if (testInfo.project.name === "iphone-size") {
    await expect(
      page.locator(".mobile-input-feedback").getByRole("alert"),
    ).toContainText("没有识别到明确金额");
    await expect(
      page.getByRole("region", { name: "确认账目" }),
    ).not.toBeVisible();
  } else
    await expect(page.locator(".banner.warning").last()).toContainText(
      "没有识别到明确金额",
    );
});

test("V1.1 手机首屏、聚焦展开、长金额和页面隔离", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "iphone-size", "只检查手机首页");
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 700 });
    await open(page);
    await expect(page.locator(".page-heading")).not.toBeVisible();
    const input = page.getByLabel("今天花了什么？");
    const h = await input.evaluate((el) => el.getBoundingClientRect().height);
    const button = page.getByRole("button", { name: "识别账目" });
    expect(
      await button.evaluate((el) => el.getBoundingClientRect().bottom),
    ).toBeLessThan(620);
    await input.focus();
    await expect
      .poll(() => input.evaluate((el) => el.getBoundingClientRect().height))
      .toBeGreaterThan(h);
    await input.fill("买菜¥999999999，零食￥999999999");
    await button.click();
    expect(await input.evaluate((el) => document.activeElement === el)).toBe(
      false,
    );
    await expect(page.locator(".mobile-draft-total")).toContainText(
      "1,999,999,998.00",
    );
    await page.getByRole("button", { name: "确认保存 2 笔" }).click();
    await expect(page.locator(".entry")).toHaveCount(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "消费流水", exact: true }).click();
    await expect(page.locator(".page-heading")).toBeVisible();
    expect(
      await page
        .locator(".app-shell")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).not.toBe("rgb(249, 249, 251)");
    await page.getByRole("button", { name: "统计分析", exact: true }).click();
    await expect(page.locator(".page-heading")).toBeVisible();
    // New context per width is unnecessary: clear only this automated test's records via UI.
    await page.getByRole("button", { name: "首页", exact: true }).click();
    for (const name of ["买菜", "零食"]) {
      await page
        .getByRole("button", { name: `删除 ${name}`, exact: true })
        .click();
      await page.getByRole("button", { name: "确认删除", exact: true }).click();
      await expect(page.locator(".entry")).toHaveCount(name === "买菜" ? 1 : 0);
    }
  }
});
