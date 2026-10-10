// Developer-only visual check using isolated, nonpersistent browser contexts.
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
const temp = mkdtempSync(join(tmpdir(), "ledger-v12-visual-"));
execFileSync("python3", [
  "-c",
  "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",
  "acceptance/小账-V1.1-局域网验收包.zip",
  temp,
]);
const oldRoot = join(temp, readdirSync(temp)[0], "site");
let root = oldRoot;
const server = createServer((req, res) => {
  const name = decodeURIComponent(
    new URL(req.url, "http://localhost").pathname,
  );
  const path = resolve(root, "." + (name === "/" ? "/index.html" : name));
  if (!path.startsWith(resolve(root) + "/")) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const data = readFileSync(path);
    res.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": path.endsWith(".js")
        ? "application/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : path.endsWith(".webmanifest")
            ? "application/manifest+json"
            : path.endsWith(".svg")
              ? "image/svg+xml"
              : path.endsWith(".png")
                ? "image/png"
                : "text/html",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "/usr/bin/chromium",
});
mkdirSync("docs/v1.2-screenshots", { recursive: true });
try {
  for (const label of ["before", "after"]) {
    root = label === "before" ? oldRoot : resolve("dist");
    for (const width of [1440, 320, 390, 430]) {
      const page = await browser.newPage({
        viewport: { width, height: width === 1440 ? 1000 : 844 },
      });
      await page.clock.install({ time: new Date("2026-10-10T12:00:00") });
      await page.goto(origin);
      await page.getByRole("button", { name: "识别账目" }).waitFor();
      await page.getByLabel("今天花了什么？").fill("买菜38元，零食25元");
      await page.getByRole("button", { name: "识别账目" }).click();
      await page.getByLabel("消费日期 1", { exact: true }).fill("2026-10-09");
      await page.getByRole("button", { name: "确认保存 2 笔" }).click();
      await page.locator(".entry").first().waitFor();
      for (const [id, name] of [
        ["home", "首页"],
        ["ledger", "消费流水"],
        ["stats", "统计分析"],
      ]) {
        await page.getByRole("button", { name, exact: true }).click();
        await page.mouse.move(1400, 990);
        await page.waitForTimeout(300);
        if (
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          )
        )
          throw Error(`${label} ${width} ${id} overflows`);
        await page.screenshot({
          path: `docs/v1.2-screenshots/${width}-${id}-${label}.png`,
          fullPage: true,
        });
      }
      await page.close();
    }
  }
  // Lossless PNG byte equality proves identical representative desktop renders.
  for (const page of ["home", "ledger", "stats"]) {
    const before = readFileSync(
      `docs/v1.2-screenshots/1440-${page}-before.png`,
    );
    const after = readFileSync(`docs/v1.2-screenshots/1440-${page}-after.png`);
    if (!before.equals(after))
      throw Error(`Desktop ${page} screenshot differs`);
    console.log(`Desktop ${page}: identical PNG PASS`);
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  rmSync(temp, { recursive: true, force: true });
}
