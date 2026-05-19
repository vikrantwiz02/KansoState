import { test, expect } from "@playwright/test";

test.describe("Meeting page", () => {
  test("shows meetings list", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Meetings" })).toBeVisible();
  });

  test("hydrate endpoint reachable", async ({ request }) => {
    const base = process.env.SENTINEL_URL ?? "http://localhost:8080";
    const resp = await request.get(`${base}/api/v1/meetings/test-meeting/hydrate`);
    // 200 or 404 are both acceptable; 500 is not
    expect(resp.status()).toBeLessThan(500);
  });
});
