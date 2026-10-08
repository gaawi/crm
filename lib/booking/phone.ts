/**
 * Phone numbers (client and server). Stored normalized: digits with an
 * optional leading "+" ("+34612345678"); only such strings ever reach a
 * tel: or wa.me link.
 */

const STORED = /^\+?[0-9]{6,16}$/;

/** "+34", "34", "0034" → "+34"; anything else → null. */
export function normalizePrefix(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().replace(/\s/g, "");
  if (!s) return null;
  const digits = s.replace(/^(\+|00)/, "");
  return /^[0-9]{1,4}$/.test(digits) ? `+${digits}` : null;
}

/**
 * Clean a typed number: spaces, dots, dashes, slashes and parentheses go;
 * "00" becomes "+". A number without a country code gets `prefix` (the
 * sheet's, e.g. "+34"), dropping a national trunk 0 ("07700…" → "+447700…",
 * except Italy, which keeps it). A number that already starts with the
 * prefix's country code and is long enough is taken as international
 * ("34 612 345 678" with +34 → "+34612345678"). Null when it is not a phone
 * number (letters, fewer than 6 or more than 16 digits).
 */
export function normalizePhone(raw: string | null | undefined, prefix?: string | null): string | null {
  if (raw === null || raw === undefined) return null;
  let s = raw.trim().replace(/[\s.\-()/ ‑‒–—]/g, "");
  if (!s) return null;
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  s = s.replace(/^\++/, "+");
  if (!/^\+?[0-9]+$/.test(s)) return null;
  // Too short as typed, before any country code is added.
  if (s.replace("+", "").length < 6) return null;

  if (!s.startsWith("+")) {
    const code = normalizePrefix(prefix)?.slice(1);
    if (code) {
      if (s.startsWith(code) && s.length - code.length >= 9) s = `+${s}`;
      else s = `+${code}${code === "39" ? s : s.replace(/^0/, "")}`;
    }
  }
  return STORED.test(s) ? s : null;
}

/** The digits of a stored number, or of anything typed ("+34 612" → "34612"). */
export function phoneDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/** "tel:+34612345678", or null when the value is not a clean number. */
export function telHref(phone: string | null | undefined): string | null {
  const clean = phone && STORED.test(phone) ? phone : normalizePhone(phone);
  return clean ? `tel:${clean}` : null;
}

/** Spanish mobiles start with 6 or 7; landlines (8, 9) have no WhatsApp. */
function canWhatsApp(phone: string): boolean {
  if (!phone.startsWith("+")) return false;
  if (phone.startsWith("+34")) return /^\+34[67]/.test(phone);
  return true;
}

/**
 * wa.me link: the contact's WhatsApp number when set, else their phone when
 * it can have WhatsApp (a Spanish mobile, or any other international
 * number). Null otherwise.
 */
export function whatsappUrl(contact: { whatsapp?: string | null; phone?: string | null } | null | undefined): string | null {
  if (!contact) return null;
  const wa = contact.whatsapp && STORED.test(contact.whatsapp) ? contact.whatsapp : normalizePhone(contact.whatsapp);
  if (wa) return `https://wa.me/${phoneDigits(wa)}`;
  const phone = contact.phone && STORED.test(contact.phone) ? contact.phone : normalizePhone(contact.phone);
  if (phone && canWhatsApp(phone)) return `https://wa.me/${phoneDigits(phone)}`;
  return null;
}

/** The number WhatsApp will open (whatsapp, else a WhatsApp-capable phone), or null. */
export function whatsappNumber(contact: { whatsapp?: string | null; phone?: string | null } | null | undefined): string | null {
  const url = whatsappUrl(contact);
  return url ? `+${url.slice("https://wa.me/".length)}` : null;
}

/** Two-digit country codes (the others are 1, 7, or three digits; codes are prefix-free). */
const TWO_DIGIT_CODE = /^(2[07]|3[0-469]|4[013-9]|5[1-8]|6[0-6]|8[1246]|9[0-58])/;

/** "770090012" → "770 090 012"; a last single digit joins the group before ("770 090 0123"). */
function groupDigits(digits: string): string {
  const groups = digits.match(/.{1,3}/g) ?? [];
  if (groups.length > 1 && groups[groups.length - 1].length === 1) groups.splice(-2, 2, groups[groups.length - 2] + groups[groups.length - 1]);
  return groups.join(" ");
}

/**
 * For display: "+34 612 345 678", "+1 212 555 0100", "985 123 456"; other
 * international numbers as country code + groups of three
 * ("+351 912 345 678", "+44 770 090 0123"). Anything else as stored.
 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  let m = /^\+34([0-9]{3})([0-9]{3})([0-9]{3})$/.exec(phone);
  if (m) return `+34 ${m[1]} ${m[2]} ${m[3]}`;
  m = /^\+1([0-9]{3})([0-9]{3})([0-9]{4})$/.exec(phone);
  if (m) return `+1 ${m[1]} ${m[2]} ${m[3]}`;
  m = /^([0-9]{3})([0-9]{3})([0-9]{3})$/.exec(phone);
  if (m) return `${m[1]} ${m[2]} ${m[3]}`;
  m = /^\+([0-9]{7,15})$/.exec(phone);
  if (m) {
    const digits = m[1];
    const codeLength = /^[17]/.test(digits) ? 1 : TWO_DIGIT_CODE.test(digits) ? 2 : 3;
    return `+${digits.slice(0, codeLength)} ${groupDigits(digits.slice(codeLength))}`;
  }
  return phone;
}
