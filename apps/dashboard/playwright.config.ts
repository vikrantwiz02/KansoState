import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL,
    trace: "on-first-retry",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],

  // Start the production server (requires a prior `pnpm build`).
  // Locally, reuse an already-running dev server if one exists.
  webServer: {
    command: "pnpm start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      NEXTAUTH_SECRET:      process.env.NEXTAUTH_SECRET      ?? "ci-test-secret-must-be-at-least-32-chars!!",
      NEXTAUTH_URL:         process.env.NEXTAUTH_URL          ?? baseURL,
      SENTINEL_URL:         process.env.SENTINEL_URL          ?? "http://localhost:8080",
      SENTINEL_WS_URL:      process.env.SENTINEL_WS_URL       ?? "ws://localhost:8080",
      SENTINEL_PUBLIC_URL:  process.env.SENTINEL_PUBLIC_URL   ?? "http://localhost:8080",
    },
  },
});
