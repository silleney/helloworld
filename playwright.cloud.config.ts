import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/cloud-e2e",
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:4175",
    browserName: "chromium",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    },
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
  webServer: {
    command:
      "npm run preview -- --config vite.cloud-test.config.ts --host 127.0.0.1 --port 4175 --strictPort",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: false,
  },
});
