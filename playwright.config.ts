import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  reporter: [["list"]],
  use: {
    ...devices["iPad Pro 11"],
    baseURL: "http://localhost:4273",
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-ipad",
      use: { browserName: "chromium", channel: "chromium" },
    },
    { name: "webkit-ipad", use: { browserName: "webkit" } },
  ],
  webServer: [
    {
      command: "npm run preview -- --host 127.0.0.1 --port 4273",
      url: "http://localhost:4273",
      reuseExistingServer: false,
      env: { FOLIO_TEST_MODE: "1" },
      timeout: 30000,
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 5273",
      url: "http://localhost:5273",
      reuseExistingServer: false,
      env: { FOLIO_TEST_MODE: "1" },
      timeout: 30000,
    },
  ],
});
