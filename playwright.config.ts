import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["ui-smoke.spec.ts", "direct-deployment.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  reporter: [["list"]],
  use: {
    ...devices["iPad Pro 11"],
    baseURL: "http://localhost:4273/Folio-pdf-reader/",
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-ipad",
      use: { browserName: "chromium", channel: "chromium" },
    },
    { name: "webkit-ipad", use: { browserName: "webkit" } },
    { name: "chromium-android", testMatch: "direct-deployment.spec.ts", use: { ...devices["Pixel 7"], browserName: "chromium", channel: "chromium" } },
  ],
  webServer: [
    {
      command: "npm run preview -- --host 127.0.0.1 --port 4273 --base /Folio-pdf-reader/",
      url: "http://localhost:4273/Folio-pdf-reader/",
      reuseExistingServer: false,
      env: { FOLIO_TEST_MODE: "1" },
      timeout: 30000,
    },
  ],
});
