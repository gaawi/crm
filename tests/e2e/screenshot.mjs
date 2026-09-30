// Usage: node tests/e2e/screenshot.mjs <outDir> <path> [<path>...]
// Logs in with APP_PASSWORD (default demo-password) and saves full-page PNGs (light + dark).
import { chromium } from "@playwright/test";
const [outDir, ...paths] = process.argv.slice(2);
const base = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
for (const scheme of ["light", "dark"]) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: scheme });
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  await page.fill('input[name="password"]', process.env.APP_PASSWORD ?? "demo-password-123");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click('button[type="submit"]')]);
  for (const p of paths) {
    await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
    const name = (p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home") + `.${scheme}.png`;
    await page.screenshot({ path: `${outDir}/${name}`, fullPage: true });
    console.log("saved", name);
  }
  await context.close();
}
await browser.close();
