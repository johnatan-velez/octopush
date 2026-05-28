/** Human-readable byte size: ≥10 of a unit shows whole numbers, otherwise 1 decimal.
 *  Non-finite or negative input renders as an em-dash placeholder. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  // Round to one decimal first so values like 9.95 promote to "10" (whole),
  // never "10.0", keeping the ≥10 → whole-number rule consistent.
  const oneDecimal = Math.round(v * 10) / 10;
  const num = oneDecimal < 10 ? oneDecimal.toFixed(1) : String(Math.round(v));
  return `${num} ${units[i]}`;
}
