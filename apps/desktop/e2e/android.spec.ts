import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const theme of ["ember", "paper"]) {
  test(`Android start has accessible project controls in ${theme}`, async ({ page }) => {
    await page.goto(`/visual.html?screen=android-start&theme=${theme}`);
    await expect(page.getByRole("heading", { name: "Set up an Android project" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create Android app", exact: true }),
    ).toBeDisabled();
    await page.getByLabel("Open existing project").check();
    await expect(page.getByLabel("Android project folder", { exact: true })).toBeVisible();
    const results = await new AxeBuilder({ page }).include(".android-section").analyze();
    expect(results.violations).toEqual([]);
  });
}

test("Android canvas maps scaled taps and swipes to emulator pixels and runs a native build", async ({
  page,
}) => {
  const inputs: object[] = [];
  const jobs: object[] = [];
  await page.route("**/api/sessions/s1/android/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/environment"))
      return route.fulfill({
        json: {
          sdk: "/test/android-sdk",
          avds: ["Pixel_9", "Pixel_Tablet"],
          devices: [{ serial: "emulator-5554", state: "device" }],
          issues: [],
        },
      });
    if (path.endsWith("/screen"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect width="1080" height="1920" fill="#203b31"/><text x="100" y="250" fill="white" font-size="60">Test emulator fixture</text></svg>',
      });
    if (path.endsWith("/input")) {
      inputs.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/job") && route.request().method() === "POST") {
      jobs.push(route.request().postDataJSON());
      return route.fulfill({
        status: 202,
        json: {
          id: "j1",
          action: "run",
          status: "running",
          startedAt: "2026-01-01",
          log: ":app:assembleDebug",
        },
      });
    }
    if (path.endsWith("/job")) return route.fulfill({ json: { job: null } });
    return route.fulfill({ json: { started: true } });
  });
  await page.goto("/visual.html?screen=android-canvas&theme=ember");
  const screen = page.getByAltText("Live Android emulator screen. Tap or drag to interact.");
  await expect(screen).toBeVisible();
  const bounds = (await screen.boundingBox())!;
  await screen.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
  await expect.poll(() => inputs.length).toBe(1);
  expect(inputs[0]).toMatchObject({
    serial: "emulator-5554",
    input: { type: "tap", x: 540, y: 960 },
  });
  await expect(page.getByRole("button", { name: "Back", exact: true })).toBeEnabled();
  await page.mouse.move(bounds.x + 30, bounds.y + 100);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 100, bounds.y + 200);
  await page.mouse.up();
  await expect.poll(() => inputs.length).toBe(2);
  expect(inputs[1]).toMatchObject({ input: { type: "swipe" } });
  await page.getByLabel("Canvas zoom").selectOption("0.5");
  await expect(page.locator(".android-device-frame")).toHaveCSS("width", "150px");
  await page.getByLabel("Application ID").fill("com.example.habits");
  await page.getByRole("button", { name: "Build & run", exact: false }).click();
  await expect(page.getByLabel("Android build log")).toContainText(":app:assembleDebug");
  expect(jobs[0]).toEqual({
    action: "run",
    serial: "emulator-5554",
    packageName: "com.example.habits",
  });
  await expect(page.getByRole("link", { name: "Download debug APK" })).toHaveCount(0);
});
