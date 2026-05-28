/** Human-readable byte size: ≥10 of a unit shows whole numbers, otherwise 1 decimal. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const num = v < 10 ? v.toFixed(1) : String(Math.round(v));
  return `${num} ${units[i]}`;
}
