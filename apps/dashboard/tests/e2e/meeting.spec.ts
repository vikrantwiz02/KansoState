import { test, expect } from "@playwright/test";

test.describe("public pages", () => {
  test("landing page loads with hero heading", async ({ page }) => {
    await page.goto("/");
    // The h1 on the landing page contains "stands right now"
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("sign-in page renders", async ({ page }) => {
    await page.goto("/auth/signin");
    await expect(page.getByText("KansoState")).toBeVisible();
  });

  test("dashboard redirects unauthenticated users to sign-in", async ({ page }) => {
    await page.goto("/dashboard");
    // Middleware should redirect to the sign-in page
    await expect(page).toHaveURL(/auth\/signin/);
  });
});

test.describe("sentinel connectivity", () => {
  test.skip(!process.env.SENTINEL_URL, "SENTINEL_URL not configured — skipping sentinel tests");

  test("hydrate endpoint reachable", async ({ request }) => {
    const base = process.env.SENTINEL_URL!;
    const resp = await request.get(`${base}/api/v1/meetings/test-meeting/hydrate`);
    // 200 or 404 are both fine; 5xx is not
    expect(resp.status()).toBeLessThan(500);
  });
});
