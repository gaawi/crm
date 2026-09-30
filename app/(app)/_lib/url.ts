/** Helpers for reading searchParams and building links that keep the current filters. */

export type SearchParams = Record<string, string | string[] | undefined>;

/** First value of a search param, trimmed and capped. */
export function param(sp: SearchParams, key: string, max = 200): string {
  const value = sp[key];
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim().slice(0, max);
}

/** First value if it is one of `options`, else "". */
export function oneOf<T extends string>(sp: SearchParams, key: string, options: readonly T[]): T | "" {
  const value = param(sp, key) as T;
  return options.includes(value) ? value : "";
}

/** `path?a=1&b=2`, skipping empty values. */
export function hrefWith(path: string, params: Record<string, string | number | null | undefined | false>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === false || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}
