import "server-only";
import type { Browser } from "puppeteer-core";

/**
 * A screenshot of a web page (an organization's site, season page…), taken
 * by a headless Chromium on the server: on Vercel the @sparticuz/chromium
 * build, elsewhere a local Chromium (CHROMIUM_PATH or Playwright's).
 *
 * Only https pages; requests to localhost or private addresses are blocked,
 * so a page cannot make the server reach its own network.
 */

export const SHOT_WIDTH = 1280;
export const SHOT_HEIGHT = 800;
const NAV_TIMEOUT_MS = 20_000;
const SETTLE_MS = 2_000;
const LOCAL_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let browserPromise: Promise<Browser> | null = null;

async function launch(): Promise<Browser> {
  const puppeteer = await import("puppeteer-core");
  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
      defaultViewport: null,
    });
  }
  return puppeteer.launch({
    executablePath: process.env.CHROMIUM_PATH || LOCAL_CHROMIUM,
    // CHROMIUM_ARGS: extra flags for a local machine (a proxy, for instance).
    args: ["--no-sandbox", "--disable-dev-shm-usage", ...(process.env.CHROMIUM_ARGS?.split(" ").filter(Boolean) ?? [])],
    headless: true,
  });
}

/** One browser per server instance, reopened if it died. */
async function browser(): Promise<Browser> {
  if (browserPromise) {
    const current = await browserPromise.catch(() => null);
    if (current?.connected) return current;
  }
  browserPromise = launch();
  return browserPromise;
}

const PRIVATE_HOST = /^(?:localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+|\[.*\])$/i;

/** True for URLs the server may open: https (or http subresources) to a public host. */
export function isPublicWebUrl(value: string, { allowHttp = false } = {}): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) return false;
    if (url.username || url.password) return false;
    return !PRIVATE_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

/** A JPEG of the top of the page (1280×800 viewport, half scale), or null when it cannot load. */
export async function screenshotPage(url: string): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!isPublicWebUrl(url)) return null;
  const page = await (await browser()).newPage();
  try {
    await page.setViewport({ width: SHOT_WIDTH, height: SHOT_HEIGHT, deviceScaleFactor: 0.5 });
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    );
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const target = request.url();
      if (target.startsWith("data:") || target.startsWith("blob:") || isPublicWebUrl(target, { allowHttp: true })) {
        void request.continue();
      } else {
        void request.abort();
      }
    });
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    if (!response || response.status() >= 400) return null;
    if (!isPublicWebUrl(page.url(), { allowHttp: true })) return null;
    // Images, fonts and sliders settle; a page that never goes idle is shot anyway.
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 6_000 }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    // Cookie and consent banners cover the page: hide them (the picture is for recognizing the site).
    await page
      .evaluate(() => {
        const CONSENT = /cookie|consent|gdpr|onetrust|cookiebot|cmp-|usercentrics|termly|iubenda/i;
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
          const marker = `${el.id} ${typeof el.className === "string" ? el.className : ""} ${el.getAttribute("aria-label") ?? ""}`;
          if (!CONSENT.test(marker)) continue;
          const position = getComputedStyle(el).position;
          if (position === "fixed" || position === "sticky" || el.getAttribute("role") === "dialog") el.style.setProperty("display", "none", "important");
        }
        document.documentElement.style.setProperty("overflow", "auto", "important");
        document.body.style.setProperty("overflow", "auto", "important");
      })
      .catch(() => {});
    const shot = await page.screenshot({ type: "jpeg", quality: 62 });
    return new Uint8Array(shot);
  } catch {
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}
