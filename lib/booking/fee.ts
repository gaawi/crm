/** Fees as owners type them (client and server). */

/**
 * "4.500" / "4.500,50 €" (Spanish), "4,500.50" / "$4,500" (English), "4500",
 * "1200,5" → a plain decimal string ("4500", "4500.50", "1200.5"). Null when
 * the text is not an amount ("a convenir").
 */
export function normalizeFee(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : null;
  const s = raw
    .trim()
    .replace(/\s| /g, "")
    .replace(/^(?:EUR|USD|GBP|€|\$|£)+|(?:EUR|USD|GBP|euros?|€|\$|£)+$/gi, "");
  if (!s) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return s.replace(/\./g, "").replace(",", ".");
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return s.replace(/,/g, "");
  if (/^-?\d+,\d{1,2}$/.test(s)) return s.replace(",", ".");
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  return null;
}

/** "4500.00" EUR → "4500 €"; USD → "$4,500". Empty without a value. */
export function formatFee(value: string | number | null | undefined, currency: string): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const locale = currency === "EUR" ? "es-ES" : currency === "GBP" ? "en-GB" : "en-US";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
    }).format(n);
  } catch {
    return `${n} ${currency}`;
  }
}
