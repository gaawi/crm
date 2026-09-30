// Usage: node tests/e2e/mail-flow.mjs   (dev server with the demo data from scripts/seed-demo.mjs)
// Walks the mail client on desktop and iPhone: inbox → thread → archive (the demo accounts have no
// Gmail access, so the change must fail visibly and the row must stay) → compose → discard.
import { chromium, devices } from "@playwright/test";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) failures.push(message);
};

async function login(context) {
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/Download the React DevTools/.test(m.text())) problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(`${base}/login`);
  await page.fill('input[name="password"]', process.env.APP_PASSWORD ?? "demo-password-123");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click('button[type="submit"]')]);
  return { page, problems };
}

// Desktop ------------------------------------------------------------------
{
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const { page, problems } = await login(context);
  await page.goto(`${base}/mail`, { waitUntil: "networkidle" });
  const row = page.locator('[data-row]:has-text("Spring cycle")');
  check((await row.count()) === 1, "inbox lists the Spring cycle thread");

  await row.locator("a").first().click();
  await page.waitForURL(/\/mail\/t\//);
  check(await page.getByRole("heading", { name: "Spring cycle — open call" }).isVisible(), "thread opens with its subject");
  check(await page.getByText("Showing the copy stored in the CRM").isVisible(), "stored-copy notice is shown when Gmail is unavailable");
  check((await page.locator("article").count()) >= 1, "latest message is expanded");

  await page.getByRole("button", { name: "Archive (e)" }).click();
  await page.waitForURL((u) => u.pathname === "/mail");
  const alert = page.getByRole("alert").filter({ hasText: /Reconnect|Gmail/ });
  await alert.waitFor({ timeout: 10_000 });
  check(true, `archive failure is reported: “${(await alert.innerText()).trim()}”`);
  await page.waitForTimeout(800);
  check((await page.locator('[data-row]:has-text("Spring cycle")').count()) === 1, "the row is back in the inbox after the failed archive");

  // Hover action on a row, same outcome.
  const liam = page.locator('[data-row]:has-text("Booking inquiry")');
  await liam.hover();
  await liam.getByRole("button", { name: "Archive" }).click();
  await page.getByRole("alert").first().waitFor();
  await page.waitForTimeout(800);
  check((await page.locator('[data-row]:has-text("Booking inquiry")').count()) === 1, "hover archive restores the row on error");

  // Compose, fill, discard.
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 700, y: 850 } });
  await page.keyboard.press("c");
  const dialog = page.getByRole("dialog", { name: "New Message" });
  await dialog.waitFor();
  check(true, "c opens the composer");
  await dialog.getByRole("combobox").first().fill("maya");
  await page.getByRole("option").first().waitFor();
  await page.keyboard.press("Enter");
  check(await dialog.getByText("Maya Chen").isVisible(), "autocomplete adds Maya Chen as a chip");
  await dialog.locator("#compose-subject").fill("Budget");
  await dialog.locator('textarea[aria-label="Message"]').fill("Hi Maya,\n\nThe budget is attached.");
  await dialog.getByRole("button", { name: "Discard" }).first().click();
  await dialog.getByRole("button", { name: /Discard/ }).last().click();
  await page.waitForTimeout(300);
  check((await page.getByRole("dialog", { name: "New Message" }).count()) === 0, "discard (confirmed) closes the composer");

  check(problems.length === 0, `no console errors on desktop${problems.length ? `: ${problems.join(" | ")}` : ""}`);
  await context.close();
}

// iPhone -------------------------------------------------------------------
{
  const context = await browser.newContext({ ...devices["iPhone 15"] });
  const { page, problems } = await login(context);
  await page.goto(`${base}/mail`, { waitUntil: "networkidle" });
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check(width <= 393, `no horizontal scroll at 393px (scrollWidth ${width})`);

  const link = page.locator(".md\\:hidden a:has-text('Press preview')").first();
  const box = await link.boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width - 10, y);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) await page.mouse.move(box.x + box.width - 10 - i * 18, y);
  await page.mouse.up();
  await page.getByRole("alert").first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(800);
  check((await page.locator(".md\\:hidden a:has-text('Press preview')").count()) === 1, "full swipe archive restores the row on error");

  await link.click();
  await page.waitForURL(/\/mail\/t\//);
  await page.waitForLoadState("networkidle");
  const threadWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  check(threadWidth <= 393, `thread screen has no horizontal scroll (scrollWidth ${threadWidth})`);
  check(await page.getByRole("button", { name: "Draft reply with Claude" }).isVisible(), "thread screen offers Draft reply with Claude");
  await page.getByRole("link", { name: /All Inboxes/ }).click();
  await page.waitForURL((u) => u.pathname === "/mail");

  await page.getByRole("button", { name: "Mailboxes" }).click();
  check(await page.getByRole("dialog", { name: "Mailboxes" }).isVisible(), "Mailboxes sheet opens");
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Compose" }).last().click();
  const sheet = page.getByRole("dialog", { name: "New Message" });
  await sheet.waitFor();
  await sheet.locator('textarea[aria-label="Message"]').fill("Hello");
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Delete Draft" }).click();
  await page.waitForTimeout(300);
  check((await page.getByRole("dialog", { name: "New Message" }).count()) === 0, "Cancel → Delete Draft closes the compose sheet");

  check(problems.length === 0, `no console errors on iPhone${problems.length ? `: ${problems.join(" | ")}` : ""}`);
  await context.close();
}

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nAll mail flow checks passed.");
