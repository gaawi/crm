/** "$2,500" / "€1,250.50": no ".00" for whole amounts. Null when there is no value. */
export function formatMoney(value: string | number | null | undefined, currency = "USD"): string | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return null;
  const whole = Number.isInteger(amount);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("en-US")} ${currency}`;
  }
}

/** Sum of the values that share one currency; null when mixed or empty. */
export function totalMoney(items: { value: string | null; currency: string }[]): string | null {
  const priced = items.filter((i) => i.value !== null);
  if (!priced.length) return null;
  const currency = priced[0].currency;
  if (priced.some((i) => i.currency !== currency)) return null;
  return formatMoney(
    priced.reduce((sum, i) => sum + Number(i.value), 0),
    currency,
  );
}

/** Calendar-month arithmetic on 'YYYY-MM-DD' (Jan 31 + 1 month → Feb 28/29). */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}
