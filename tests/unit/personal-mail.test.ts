import { describe, expect, it } from "vitest";
import { isPersonalMailDomain } from "@/lib/constants";

describe("isPersonalMailDomain", () => {
  it("recognizes webmail and internet providers", () => {
    for (const d of ["gmail.com", "yahoo.es", "hotmail.es", "optonline.net", "earthlink.net", "sbcglobal.net", "juno.com", "t-online.de", "gmx.at", "btinternet.com", "live.co.uk", "abv.bg", "mail.ru", "126.com", "cox.net", "sonic.net", "nyc.rr.com", "mail.tele.dk", "yahoo.co.jp", "centrum.cz", "home.nl", "live.com"]) {
      expect(isPersonalMailDomain(d), d).toBe(true);
    }
  });
  it("keeps organizations' own domains, including mail subdomains", () => {
    for (const d of ["schubert.org", "mail.wvu.edu", "mail.indstate.edu", "live.stanford.edu", "web.mit.edu", "post.harvard.edu", "home.example.org", "centrum.org", "home.org", "post.org", "vineyard.org", "online.org", "lincolncenter.org", "gijon.es", "caramoor.org"]) {
      expect(isPersonalMailDomain(d), d).toBe(false);
    }
  });
});
