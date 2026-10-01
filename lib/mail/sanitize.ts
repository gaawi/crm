import { Parser } from "htmlparser2";

/**
 * HTML email sanitizer. Defense in depth: the result is rendered inside
 * `<iframe sandbox>` without `allow-scripts` and with its own CSP (see
 * buildSrcDoc), so nothing can run and nothing remote can load even if a
 * construct slipped through. This pass removes active content, neutralizes
 * URLs and drops remote images (no tracking pixels), counting them so the UI
 * can say they were hidden.
 */

/** Removed together with everything inside them. */
const DROP_WITH_CONTENT = new Set([
  "script",
  "noscript",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "template",
  "title",
  "math",
  "select",
  "textarea",
  "portal",
  "fencedframe",
]);

/** The tag is removed, its children are kept. */
const UNWRAP = new Set([
  "html",
  "head",
  "body",
  "form",
  "xmp",
  "plaintext",
  "listing",
  "noembed",
  "noframes",
  "slot",
]);

/** Removed (void or irrelevant, no meaningful children). */
const DROP = new Set(["base", "meta", "link", "input", "keygen", "param", "source", "track"]);

const VOID = new Set(["area", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr", "base", "keygen"]);

const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "background",
  "poster",
  "cite",
  "longdesc",
  "lowsrc",
  "dynsrc",
  "data",
  "xlink:href",
  "manifest",
  "codebase",
  "usemap",
]);

const DROP_ATTRIBUTES = new Set(["srcset", "srcdoc", "ping", "formaction", "action", "nonce", "autofocus", "http-equiv"]);

const SAFE_LINK_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

export interface SanitizeOptions {
  /** Content-ID (without angle brackets, any case) → `data:` URI for inline images. */
  inlineImages?: ReadonlyMap<string, string>;
}

export interface SanitizedHtml {
  html: string;
  /** Number of remote images (tags, backgrounds, CSS urls) that were removed. */
  remoteImages: number;
}

export function normalizeContentId(value: string): string {
  return value.trim().replace(/^<|>$/g, "").trim().toLowerCase();
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Scheme of a URL after removing whitespace/control characters browsers ignore, or null if relative. */
export function urlScheme(value: string): string | null {
  const compact = value.replace(/[\u0000- \u007f-\u009f]/g, "");
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(compact);
  return match ? match[1].toLowerCase() : null;
}

function isDataImage(value: string): boolean {
  const compact = value.replace(/[\u0000- \u007f-\u009f]/g, "").toLowerCase();
  return /^data:image\/(png|gif|jpe?g|webp|bmp|avif);/.test(compact);
}

/**
 * Neutralize CSS that can fetch or execute: @import, url() pointing anywhere
 * but data:image, legacy expression()/behaviors. Returns the CSS and the
 * number of remote urls removed.
 */
export function sanitizeCss(css: string): { css: string; remote: number } {
  let remote = 0;
  let out = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(['"]?)([\s\S]*?)\1\s*\)/gi, (_match, _quote: string, target: string) => {
      if (isDataImage(target)) return `url("${target.replace(/["\\\n\r]/g, "")}")`;
      remote++;
      return "none";
    })
    .replace(/expression\s*\(/gi, "(")
    .replace(/(-moz-binding|behavior)\s*:/gi, "x-blocked:");
  // A stray "</style" would end the element early in the browser.
  // No "<" at all inside CSS (as a CSS escape): a stray "</style" — even one
  // assembled by the removals above — could otherwise end the element early.
  out = out.replace(/</g, "\\3c ");
  return { css: out, remote };
}

export function sanitizeEmailHtml(input: string, options: SanitizeOptions = {}): SanitizedHtml {
  const out: string[] = [];
  const stack: string[] = [];
  /** Stack depth at which dropped content started (-1 = not dropping). */
  let dropDepth = -1;
  let remoteImages = 0;

  const inlineImage = (value: string): string | null => {
    const id = normalizeContentId(value.replace(/^\s*cid:/i, ""));
    return options.inlineImages?.get(id) ?? null;
  };

  const parser = new Parser(
    {
      onopentag(rawName, attribs) {
        const name = rawName.toLowerCase();
        stack.push(name);
        if (dropDepth !== -1) return;
        if (DROP_WITH_CONTENT.has(name)) {
          dropDepth = stack.length;
          return;
        }
        if (UNWRAP.has(name) || DROP.has(name)) return;

        const attrs: string[] = [];
        let link: "external" | "fragment" | null = null;
        const linkable = name === "a" || name === "area";
        for (const [rawAttr, rawValue] of Object.entries(attribs)) {
          const attr = rawAttr.toLowerCase();
          const value = rawValue ?? "";
          if (attr.startsWith("on") || DROP_ATTRIBUTES.has(attr)) continue;
          if (attr === "style") {
            const { css, remote } = sanitizeCss(value);
            remoteImages += remote;
            if (css.trim()) attrs.push(`style="${escapeAttribute(css)}"`);
            continue;
          }
          if (attr === "target" || attr === "rel") continue; // set below for links
          if (URL_ATTRIBUTES.has(attr)) {
            const scheme = urlScheme(value);
            if (attr === "href" && linkable) {
              if (scheme && SAFE_LINK_SCHEMES.has(scheme)) {
                attrs.push(`href="${escapeAttribute(value.trim())}"`);
                link = "external";
              } else if (!scheme && value.trim().startsWith("#")) {
                attrs.push(`href="${escapeAttribute(value.trim())}"`);
                link = "fragment";
              }
              continue;
            }
            if ((attr === "href" || attr === "xlink:href") && name === "image" && value.trim() && !isDataImage(value)) {
              remoteImages++; // SVG <image>
              continue;
            }
            if (attr === "src" && name === "img") {
              if (scheme === "cid") {
                const data = inlineImage(value);
                if (data) attrs.push(`src="${escapeAttribute(data)}"`);
              } else if (scheme === "data" && isDataImage(value)) {
                attrs.push(`src="${escapeAttribute(value.trim())}"`);
              } else if (value.trim()) {
                remoteImages++;
              }
              continue;
            }
            if (attr === "background") {
              if (value.trim() && !isDataImage(value)) remoteImages++;
              else if (value.trim()) attrs.push(`background="${escapeAttribute(value.trim())}"`);
              continue;
            }
            // Any other URL-bearing attribute is dropped.
            continue;
          }
          if (!/^[a-z_:][a-z0-9_.:-]*$/.test(attr)) continue;
          attrs.push(value === "" ? attr : `${attr}="${escapeAttribute(value)}"`);
        }
        if (link === "external") attrs.push('target="_blank"', 'rel="noopener noreferrer"');
        if (link === "fragment") attrs.push('target="_self"');
        out.push(`<${name}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`);
      },
      ontext(text) {
        if (dropDepth !== -1) return;
        const current = stack[stack.length - 1];
        if (current === "style") {
          const { css, remote } = sanitizeCss(text);
          remoteImages += remote;
          out.push(css);
        } else {
          out.push(escapeText(text));
        }
      },
      onclosetag(rawName) {
        const name = rawName.toLowerCase();
        const depth = stack.length;
        stack.pop();
        if (dropDepth !== -1) {
          if (depth === dropDepth) dropDepth = -1;
          return;
        }
        if (VOID.has(name) || UNWRAP.has(name) || DROP.has(name) || DROP_WITH_CONTENT.has(name)) return;
        out.push(`</${name}>`);
      },
      // Comments (incl. Outlook conditional comments), doctypes and CDATA are dropped.
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true, recognizeSelfClosing: true },
  );
  parser.write(input);
  parser.end();
  return { html: out.join(""), remoteImages };
}

/**
 * Policy inside the frame: nothing remote, no scripts, only inline styles and
 * data: images/fonts. The app's own CSP is inherited on top of this.
 */
export const EMAIL_FRAME_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'";

/** Full document for `<iframe srcdoc>`: CSP first, then light "paper" base styles. */
export function buildSrcDoc(sanitizedHtml: string): string {
  return [
    "<!doctype html><html><head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${EMAIL_FRAME_CSP}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta http-equiv="x-dns-prefetch-control" content="off">',
    '<base target="_blank">',
    "<style>",
    ":root{color-scheme:light}",
    "html,body{margin:0;padding:0;background:#fff}",
    "body{color:#1f1f1f;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;overflow-wrap:break-word;word-break:break-word}",
    "img{max-width:100%;height:auto}",
    "pre{white-space:pre-wrap}",
    "blockquote{margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex}",
    "a{color:#0b57d0}",
    "</style></head><body>",
    sanitizedHtml,
    "</body></html>",
  ].join("");
}
