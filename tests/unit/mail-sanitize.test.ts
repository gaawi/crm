import { describe, expect, it } from "vitest";
import { buildSrcDoc, sanitizeCss, sanitizeEmailHtml, urlScheme } from "@/lib/mail/sanitize";

const clean = (html: string, inline?: Map<string, string>) =>
  sanitizeEmailHtml(html, inline ? { inlineImages: inline } : {});

describe("sanitizeEmailHtml", () => {
  it("removes scripts, frames and embedded objects with their content", () => {
    const { html } = clean(
      '<p>Hi</p><script>alert(1)</script><iframe src="https://x.test">x</iframe><object data="a.swf"><p>fallback</p></object><embed src="b"><noscript>ns</noscript><p>Bye</p>',
    );
    expect(html).toBe("<p>Hi</p><p>Bye</p>");
  });

  it("strips event handlers and dangerous attributes", () => {
    const { html } = clean('<div onclick="x()" onMouseOver="y" style="color:red" data-x="1" srcdoc="<b>">t</div>');
    expect(html).toBe('<div style="color:red" data-x="1">t</div>');
  });

  it("drops javascript:, vbscript: and data: links, including obfuscated ones", () => {
    for (const href of [
      "javascript:alert(1)",
      " JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      "&#106;avascript:alert(1)",
      "vbscript:msgbox",
      "data:text/html,<script>alert(1)</script>",
    ]) {
      const { html } = clean(`<a href="${href}">x</a>`);
      expect(html, href).toBe("<a>x</a>");
    }
  });

  it("keeps web and mail links and opens them in a new tab", () => {
    expect(clean('<a href="https://ex.test/a?b=1&amp;c=2" target="_top" rel="opener">x</a>').html).toBe(
      '<a href="https://ex.test/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">x</a>',
    );
    expect(clean('<a href="mailto:a@b.test">m</a>').html).toContain('href="mailto:a@b.test"');
    expect(clean('<a href="#top">t</a>').html).toBe('<a href="#top" target="_self">t</a>');
    expect(clean('<a href="/relative">r</a>').html).toBe("<a>r</a>");
  });

  it("removes meta refresh, base, link and forms but keeps form content", () => {
    const { html } = clean(
      '<meta http-equiv="refresh" content="0;url=https://evil.test"><base href="https://evil.test/"><link rel="stylesheet" href="https://x.test/a.css"><form action="https://evil.test"><p>Inside</p><input name="q"><button>Go</button></form>',
    );
    expect(html).toBe("<p>Inside</p><button>Go</button>");
  });

  it("removes remote images (tracking pixels) and counts them", () => {
    const result = clean(
      '<img src="https://track.test/p.gif" width="1" height="1" alt=""><img src="http://x.test/logo.png" alt="Logo" srcset="https://x.test/2x.png 2x"><table background="https://x.test/bg.jpg"><tr><td style="background-image:url(\'https://x.test/c.png\')">c</td></tr></table>',
    );
    expect(result.remoteImages).toBe(4);
    expect(result.html).not.toMatch(/https?:/);
    expect(result.html).toContain('<img alt="Logo">');
  });

  it("replaces cid: images with the inline data and keeps data: images", () => {
    const inline = new Map([["logo@mail", "data:image/png;base64,AAAA"]]);
    expect(clean('<img src="cid:Logo@Mail" alt="l">', inline).html).toBe('<img src="data:image/png;base64,AAAA" alt="l">');
    expect(clean('<img src="cid:missing">', inline).html).toBe("<img>");
    expect(clean('<img src="data:image/gif;base64,R0lG">').html).toBe('<img src="data:image/gif;base64,R0lG">');
    expect(clean('<img src="data:text/html;base64,PHNjcmlwdD4=">').html).toBe("<img>");
  });

  it("sanitizes <style> blocks but keeps the rules", () => {
    const result = clean(
      '<html><head><title>T</title><style>@import url(https://x.test/a.css); .a>.b{color:red;background:url(https://x.test/i.png)}</style></head><body><p class="a">x</p></body></html>',
    );
    expect(result.html).toBe('<style> .a>.b{color:red;background:none}</style><p class="a">x</p>');
    expect(result.remoteImages).toBe(1);
  });

  it("escapes text and attribute values", () => {
    expect(clean("<p>a &lt;b&gt; &amp; c</p>").html).toBe("<p>a &lt;b&gt; &amp; c</p>");
    expect(clean('<p title="&quot;&gt;<script>">x</p>').html).toBe('<p title="&quot;&gt;&lt;script&gt;">x</p>');
  });

  it("drops comments (including Outlook conditional comments)", () => {
    expect(clean("<p>a</p><!--[if mso]><table><tr><td><![endif]--><p>b</p><!-- note -->").html).toBe("<p>a</p><p>b</p>");
  });

  it("handles SVG images and void elements", () => {
    const result = clean('<svg><image href="https://x.test/a.png"/><script>x</script><path d="M0 0"/></svg><br/><hr>');
    expect(result.html).toBe('<svg><image></image><path d="M0 0"></path></svg><br><hr>');
    expect(result.remoteImages).toBe(1);
  });
});

describe("sanitizeCss", () => {
  it("neutralizes expressions and bindings", () => {
    expect(sanitizeCss("width:expression(alert(1));-moz-binding:url(x.xml#a);behavior:url(x.htc)").css).not.toMatch(
      /expression\(|-moz-binding:|behavior:|url\(/,
    );
  });

  it("cannot be tricked into closing <style> early (parser differential)", () => {
    const { html } = sanitizeEmailHtml('<style>x{}</st</styleyle/><a href="https://evil.test/login">Sign in</a></style><p>ok</p>');
    expect(html.match(/<\/style/gi)).toEqual(["</style"]); // only the real end tag
    expect(html.match(/<a\b/g)).toBeNull();
    expect(html).toContain("<p>ok</p>");
  });

  it("cannot close the style element", () => {
    expect(sanitizeCss("a{}</style><script>x</script>").css).not.toMatch(/<\/style/i);
  });
});

describe("urlScheme", () => {
  it("ignores whitespace and control characters", () => {
    expect(urlScheme("  java\nscript:alert(1)")).toBe("javascript");
    expect(urlScheme("/path")).toBeNull();
    expect(urlScheme("HTTPS://x")).toBe("https");
  });
});

describe("buildSrcDoc", () => {
  it("puts the restrictive CSP before any content", () => {
    const doc = buildSrcDoc("<p>x</p>");
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<p>x</p>"));
    expect(doc).toContain("default-src 'none'");
    expect(doc).not.toContain("script-src");
  });
});
