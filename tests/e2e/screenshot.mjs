// Usage: node tests/e2e/screenshot.mjs <outDir> <path> [<path>...]
// Logs in with APP_PASSWORD (default demo-password-123) and saves full-page PNGs (light + dark).
// MOBILE=1 renders as an iPhone 15 (393×852, touch, @3x); SCHEMES=light limits the color schemes.
import { chromium, devices } from "@playwright/test";

const [outDir, ...paths] = process.argv.slice(2);
const base = process.env.BASE_URL ?? "http://localhost:3000";
const mobile = process.env.MOBILE === "1";
const schemes = (process.env.SCHEMES ?? "light,dark").split(",");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });

for (const scheme of schemes) {
  const context = await browser.newContext({
    ...(mobile ? devices["iPhone 15"] : { viewport: { width: 1360, height: 900 } }),
    colorScheme: scheme,
  });
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  await page.fill('input[name="password"]', process.env.APP_PASSWORD ?? "demo-password-123");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click('button[type="submit"]')]);
  for (const p of paths) {
    await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
    const name = (p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home") + `${mobile ? ".mobile" : ""}.${scheme}.png`;
    await page.screenshot({ path: `${outDir}/${name}`, fullPage: !mobile });
    console.log("saved", name);
  }
  await context.close();
}
await browser.close();
