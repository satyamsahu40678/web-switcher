import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

// UI contract smoke test. The API is intentionally mocked; backend integration
// tests separately exercise authorization, CSRF, persistence and publishing.
const base = process.env.WEB_BASE_URL || "http://127.0.0.1:5173";
const server = process.env.WEB_BASE_URL
  ? null
  : spawn(
      process.execPath,
      ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
      { stdio: "pipe" },
    );
let serverOutput = "";
server?.stdout.on("data", (d) => (serverOutput += d));
server?.stderr.on("data", (d) => (serverOutput += d));
let browser;
const requests = [];
let authenticated = false;
let role = "reviewer";
const candidate = {
  id: "candidate-1",
  familyId: null,
  sourceHost: "old.example",
  proposedOrigin: "https://current.example",
  reason:
    "<script>window.compromised=true</script> Operator announcement submitted for review.",
  state: "pending",
  version: 1,
  createdAt: "2026-10-26T12:00:00Z",
};
let decided = false;
try {
  for (let i = 0; i < 100; i++) {
    if (server && server.exitCode !== null) throw new Error(serverOutput);
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (i === 99) throw new Error(`Vite did not start: ${serverOutput}`);
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(10000);
  await page.route("**/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    requests.push({
      path,
      method: req.method(),
      body: req.postData(),
      headers: req.headers(),
    });
    let body = {};
    let status = 200;
    if (path === "/v1/lookups") {
      const hostname = req.postDataJSON().hostname;
      body = hostname === "queued.example"
        ? {status: "pending", lookupId: "12345678-1234-4123-8123-123456789abc", pollAfterSeconds: 5}
        : {status: "unknown"};
      if (hostname === "queued.example") status = 202;
    }
    else if (path === "/v1/lookups/12345678-1234-4123-8123-123456789abc") body = {status: "unknown", reason: "UNVERIFIED_CANDIDATE_QUEUED", lookupId: "12345678-1234-4123-8123-123456789abc"};
    else if (path === "/v1/reports") {
      body = { id: "report-1", status: "pending" };
      status = 202;
    } else if (path === "/v1/session")
      body = {
        authenticated,
        username: authenticated ? `demo-${role}` : null,
        roles: authenticated ? [role] : [],
        csrfToken: "test-csrf",
        csrfHeader: "X-CSRF-TOKEN",
        demo: true,
      };
    else if (path === "/v1/admin/login") {
      authenticated = true;
      role = req.postData().includes("demo-publisher")
        ? "publisher"
        : "reviewer";
      body = { ok: true };
    } else if (path === "/v1/admin/logout") {
      authenticated = false;
      body = { ok: true };
    } else if (path === "/v1/admin/candidates")
      body = { items: decided ? [] : [candidate], total: decided ? 0 : 1 };
    else if (path.endsWith("/decisions")) {
      decided = true;
      body = { ...candidate, state: "approved", version: 2 };
    } else if (path === "/v1/admin/audit")
      body = {
        items: [
          {
            id: "audit-1",
            actor: "demo-reviewer",
            action: "candidate_approved",
            entityId: candidate.id,
            detail: "Independent evidence checked.",
            createdAt: candidate.createdAt,
          },
        ],
      };
    else if (path === "/v1/admin/releases")
      body =
        req.method() === "POST"
          ? { sequence: 2 }
          : {
              items: [
                {
                  sequence: 1,
                  digest: "abc123",
                  issuedAt: candidate.createdAt,
                  expiresAt: "2026-10-27T12:00:00Z",
                  publisher: "demo-publisher",
                },
              ],
            };
    else {
      status = 404;
      body = { detail: "Unexpected mock endpoint" };
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto(base);
  await page.getByRole("heading", { name: /Addresses change/ }).waitFor();
  assert.equal(
    requests.length,
    0,
    "landing must not send background API requests",
  );
  await page
    .getByLabel("The old hostname")
    .fill("https://old.example/private?token=secret");
  await page.getByRole("button", { name: "Look up hostname" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Enter a hostname only" })
    .waitFor();
  assert.equal(requests.length, 0, "invalid full URL must not be sent");
  await page.getByLabel("The old hostname").fill("old.example");
  await page.getByRole("button", { name: "Look up hostname" }).click();
  await page
    .getByRole("heading", { name: "No verified replacement found" })
    .waitFor();
  assert.deepEqual(JSON.parse(requests.at(-1).body), {
    hostname: "old.example",
  });
  await page.getByLabel("The old hostname").fill("queued.example");
  await page.getByRole("button", {name: "Look up hostname"}).click();
  await page.getByRole("heading", {name: "A discovery check is queued"}).waitFor();
  assert.equal(requests.filter(r => r.method === "GET" && r.path.startsWith("/v1/lookups/")).length, 0, "lookup status must not poll in the background");
  await page.getByRole("button", {name: "Check lookup status"}).click();
  await page.getByRole("heading", {name: "Candidates need review"}).waitFor();
  assert.equal(requests.at(-1).method, "GET");
  assert.equal(await page.locator(".lookup-result .domain").count(), 0, "unverified discovery must not display an approved destination");
  await page
    .getByRole("button", { name: "Know about a move? Submit a report" })
    .click();
  await page.getByLabel("Old hostname", { exact: true }).fill("old.example");
  await page.getByLabel("Proposed hostname").fill("current.example");
  await page
    .getByLabel("Why are these the same site?")
    .fill("An independently reviewed migration announcement.");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Report received for review" })
    .waitFor();
  assert.deepEqual(Object.keys(JSON.parse(requests.at(-1).body)).sort(), [
    "proposedHost",
    "reason",
    "sourceHost",
  ]);
  await page.getByRole("link", { name: "Registry desk" }).click();
  await page.getByLabel("Username", { exact: true }).fill("demo-reviewer");
  await page.getByLabel("Password", { exact: true }).fill("demo-password");
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await page.getByRole("heading", { name: /Review queue/ }).waitFor();
  const login = requests.find((r) => r.path === "/v1/admin/login");
  assert.equal(login.headers["x-csrf-token"], "test-csrf");
  assert.equal(
    new URLSearchParams(login.body).get("username"),
    "demo-reviewer",
  );
  await page.getByRole("button", { name: /old.example/ }).click();
  await page
    .getByRole("heading", { name: "Inspect the proposed move" })
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.compromised),
    undefined,
    "untrusted reasoning must remain text",
  );
  await page.getByRole("button", { name: "Approve for publication" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Record the reasoning" })
    .waitFor();
  assert.equal(
    requests.some((r) => r.path.endsWith("/decisions")),
    false,
  );
  await page
    .getByLabel("Your decision and evidence")
    .fill("Independent historical continuity checked.");
  await page.getByRole("button", { name: "Approve for publication" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Decision recorded" })
    .waitFor();
  const decision = requests.find((r) => r.path.endsWith("/decisions"));
  assert.equal(JSON.parse(decision.body).version, 1);
  assert.equal(JSON.parse(decision.body).decision, "approved");
  assert.equal(decision.headers["x-csrf-token"], "test-csrf");
  await page.getByRole("button", { name: "Publications" }).click();
  await page.getByRole("heading", { name: "Catalog #1" }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: /^Publish next catalog/ })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Audit trail" }).click();
  await page
    .getByText("Independent evidence checked.", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill("demo-publisher");
  await page.getByLabel("Password", { exact: true }).fill("demo-password");
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await page.getByRole("heading", { name: /Review queue/ }).waitFor();
  await page.getByRole("button", { name: "Publications" }).click();
  await page.getByRole("heading", { name: "Catalog #1" }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: /^Publish next catalog/ })
      .isEnabled(),
    true,
  );
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /^Publish next catalog/ }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "New signed release published" })
    .waitFor();
  const publication = requests.find(
    (r) => r.path === "/v1/admin/releases" && r.method === "POST",
  );
  assert.equal(publication.headers["x-csrf-token"], "test-csrf");
  await page.goto(base);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "mobile layout must not overflow",
  );
  if (process.env.WEB_UI_SCREENSHOT)
    await page.screenshot({
      path: process.env.WEB_UI_SCREENSHOT,
      fullPage: true,
    });
  console.log(
    "Web UI browser smoke passed: hostname-only disclosure, report moderation, escaped evidence, CSRF, reason/version review, role-separated publishing, audit, and mobile layout. API responses were mocked.",
  );
} finally {
  await browser?.close();
  server?.kill("SIGTERM");
}
