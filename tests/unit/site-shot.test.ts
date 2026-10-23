import { describe, expect, it } from "vitest";
import { isPublicWebUrl } from "@/lib/sites/screenshot";

describe("isPublicWebUrl", () => {
  it("opens public https pages only, and http subresources when allowed", () => {
    expect(isPublicWebUrl("https://www.salastina.org/season")).toBe(true);
    expect(isPublicWebUrl("http://example.org/")).toBe(false);
    expect(isPublicWebUrl("http://example.org/a.png", { allowHttp: true })).toBe(true);
    expect(isPublicWebUrl("file:///etc/passwd", { allowHttp: true })).toBe(false);
    expect(isPublicWebUrl("https://user:pw@example.org/")).toBe(false);
  });

  it("never reaches localhost or private networks", () => {
    for (const host of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.1", "172.20.0.5", "169.254.169.254", "100.64.0.1", "[::1]", "db.internal", "printer.local"]) {
      expect(isPublicWebUrl(`https://${host}/`, { allowHttp: true })).toBe(false);
    }
    expect(isPublicWebUrl("https://172.32.0.1/")).toBe(true);
  });
});
