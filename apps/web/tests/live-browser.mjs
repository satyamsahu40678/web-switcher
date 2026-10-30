import assert from "node:assert/strict";
import { chromium } from "playwright";
const base = process.env.WEB_BASE_URL || "http://127.0.0.1:5173";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const expectedResponse = await fetch(`${base}/v1/lookups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hostname: "old.web-switcher.test" }),
  });
  assert.equal(expectedResponse.ok, true);
  const expected = await expectedResponse.json();
  await page.goto(base);
  await page.getByRole("heading", { name: /Addresses change/ }).waitFor();
  await page.screenshot({ path: "/tmp/web-switcher-home.png", fullPage: true });
  await page.getByLabel("The old hostname").fill("old.web-switcher.test");
  await page.getByRole("button", { name: "Look up hostname" }).click();
  await page
    .getByRole("heading", {
      name:
        expected.status === "verified"
          ? "A reviewed destination is available"
          : "No verified replacement found",
    })
    .waitFor();
  if (expected.destinationOrigin)
    await page.getByText(expected.destinationOrigin, { exact: true }).waitFor();
  await page.getByRole("link", { name: "Registry desk" }).click();
  await page.getByLabel("Username", { exact: true }).fill("demo-reviewer");
  await page.getByLabel("Password", { exact: true }).fill("demo-password");
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await page.getByRole("heading", { name: /Review queue/ }).waitFor();
  await page.screenshot({
    path: "/tmp/web-switcher-admin.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Publications" }).click();
  await page
    .getByRole("heading", { name: /Catalog #/ })
    .first()
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: /^Publish next catalog/ })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Audit trail" }).click();
  await page
    .getByRole("heading", { name: "The record behind the release." })
    .waitFor();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill("demo-publisher");
  await page.getByLabel("Password", { exact: true }).fill("demo-password");
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await page.getByRole("heading", { name: /Review queue/ }).waitFor();
  await page.getByRole("button", { name: "Publications" }).click();
  await page
    .getByRole("heading", { name: /Catalog #/ })
    .first()
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: /^Publish next catalog/ })
      .isEnabled(),
    true,
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(
    `PASS live API browser integration: hostname lookup matched current API state (${expected.status}); real reviewer/publisher CSRF sessions; queue/releases/audit views; reviewer publishing disabled, publisher enabled. No report/review/release mutations.`,
  );
} finally {
  await browser.close();
}
