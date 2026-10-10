import type { Page } from "@playwright/test";
export async function expandDraft(page: Page, index: number) {
  const summary = page.getByRole("button", {
    name: `编辑待确认 ${index}`,
    exact: true,
  });
  if (
    (await summary.isVisible()) &&
    (await summary.getAttribute("aria-expanded")) !== "true"
  )
    await summary.click();
}
