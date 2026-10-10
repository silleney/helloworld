import { test, expect } from "@playwright/test";

test("V1.3 长输入自适应、有界滚动并可继续识别", async ({ page }, info) => {
  test.skip(info.project.name !== "iphone-size", "手机输入行为");
  await page.goto("/");
  const input = page.getByLabel("今天花了什么？");
  await expect(input).toBeVisible();
  const initial = await input.evaluate(
    (el) => el.getBoundingClientRect().height,
  );
  await input.fill("买菜38元，零食25元\n".repeat(40));
  expect(
    await input.evaluate((el) => el.getBoundingClientRect().height),
  ).toBeGreaterThan(initial);
  expect(
    await input.evaluate((el) => el.getBoundingClientRect().height),
  ).toBeLessThanOrEqual(240);
  expect(await input.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
    true,
  );
  await input.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(await input.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await input.fill("买菜38元");
  expect(
    await input.evaluate((el) => el.getBoundingClientRect().height),
  ).toBeLessThan(240);
  await page.getByRole("button", { name: "识别账目" }).click();
  await expect(
    page.getByRole("button", { name: "编辑待确认 1" }),
  ).toContainText("买菜");
  await expect(page.locator(".entry")).toHaveCount(0);
});

test("V1.3 摘要默认折叠、单笔编辑、合计与确认保存", async ({ page }, info) => {
  test.skip(info.project.name !== "iphone-size", "手机摘要行为");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "识别账目" })).toBeEnabled();
  await page.getByLabel("今天花了什么？").fill("买菜¥38，零食¥25，打车¥20");
  await page.getByRole("button", { name: "识别账目" }).click();
  await expect(page.locator(".mobile-draft-total")).toContainText(
    "3 笔待确认 · 合计 ¥ 83.00",
  );
  await expect(page.locator(".draft-summary")).toHaveCount(3);
  for (const i of [1, 2, 3])
    await expect(
      page.getByLabel(`消费内容 ${i}`, { exact: true }),
    ).not.toBeVisible();
  await page.getByRole("button", { name: "编辑待确认 2", exact: true }).click();
  await page.getByLabel("消费内容 2", { exact: true }).fill("奶茶");
  await page.getByLabel("金额 2", { exact: true }).fill("12.50");
  await page.getByLabel("消费日期 2", { exact: true }).fill("2026-01-02");
  await page
    .getByLabel("分类 2", { exact: true })
    .selectOption("discretionary");
  await expect(page.locator(".mobile-draft-total")).toContainText(
    "合计 ¥ 70.50",
  );
  await page.getByRole("button", { name: "编辑待确认 3", exact: true }).click();
  await expect(
    page.getByLabel("消费内容 2", { exact: true }),
  ).not.toBeVisible();
  await page.getByLabel("分类 3", { exact: true }).selectOption("necessary");
  await page.getByRole("button", { name: "编辑待确认 3", exact: true }).click();
  await expect(page.getByLabel("分类 3", { exact: true })).not.toBeVisible();
  await expect(page.locator(".entry")).toHaveCount(0);
  await page.getByRole("button", { name: "确认保存 3 笔" }).dblclick();
  await expect(page.locator(".entry")).toHaveCount(3);
  await page.reload();
  await expect(page.locator(".entry")).toHaveCount(3);
  await page.getByRole("button", { name: "编辑 奶茶", exact: true }).click();
  await expect(page.getByLabel("金额 1", { exact: true })).toHaveValue("12.50");
  await expect(page.getByLabel("消费日期 1", { exact: true })).toHaveValue(
    "2026-01-02",
  );
});
