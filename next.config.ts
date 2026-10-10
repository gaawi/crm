import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy: the app only ever loads its own code and data.
 *
 * Images: app pages may show remote https images (organization profiles,
 * rendered with referrerPolicy="no-referrer"). Mail and the API keep the
 * strict policy without remote hosts, and HTML email adds its own
 * `img-src data:` policy inside the sandboxed iframe (EMAIL_FRAME_CSP in
 * lib/mail/sanitize.ts) on top of the sanitizer dropping remote images:
 * nothing in an email can make the browser fetch an outside URL (no
 * tracking pixels). Claude's Markdown answers render without images.
 */
function csp(imgSrc: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc}`,
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "frame-src 'self' blob:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

const APP_CSP = csp("'self' data: blob: https:");
const STRICT_CSP = csp("'self' data: blob:");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: APP_CSP },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      // Later entries override the same header: no remote images in Mail or the API.
      ...["/mail", "/mail/:path*", "/api/:path*"].map((source) => ({
        source,
        headers: [{ key: "Content-Security-Policy", value: STRICT_CSP }],
      })),
    ];
  },
};

export default nextConfig;
