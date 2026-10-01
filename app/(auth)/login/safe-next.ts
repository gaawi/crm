/** Only same-origin paths survive (checked by parsing, not by prefix: "/\t/evil.com" is a host). */
export function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  // eslint-disable-next-line no-control-regex
  if (!next.startsWith("/") || /[\u0000-\u0020\u007f\\]/.test(next)) return "/";
  try {
    const url = new URL(next, "http://app.invalid");
    return url.origin === "http://app.invalid" ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}
