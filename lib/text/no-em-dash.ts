/**
 * The owner never wants em dashes (—) in anything written for them. Claude is
 * told so in every prompt; this is the safety net for emails it writes:
 *   "Thank you — I enjoyed it" → "Thank you, I enjoyed it"
 *   "— a list item"            → "- a list item"
 *   "2024—2025"                → "2024-2025"
 * Text the owner types themselves is left alone.
 */
export function noEmDash(text: string): string {
  if (!text.includes("—")) return text;
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/^(\s*)—\s*/, "$1- ")
        .replace(/(\d)—(\d)/g, "$1-$2")
        .replace(/\s*—\s*([.,;:!?)]|$)/g, "$1")
        .replace(/\s*—\s*/g, ", ")
        .replace(/,\s*,/g, ",")
        .replace(/^,\s*/, ""),
    )
    .join("\n");
}

/** The rule as written in Claude's prompts. */
export const NO_EM_DASH_RULE = "Never use em dashes (—). Use commas, periods, colons or parentheses instead.";
