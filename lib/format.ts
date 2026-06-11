// Number formatting helpers

export function fmtTHBClean(n: number, decimals = 0): string {
  const v = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Math.abs(n));
  return `${n < 0 ? "-" : ""}฿${v}`;
}

/**
 * Format a percentage with a leading sign. Precision is ADAPTIVE by magnitude
 * unless the caller pins `decimals`: values under 1% keep 2dp (a 0.2% gain reads
 * as 0.24%, not a rounded 0.2%), 1–100% keep 1dp, and 100%+ drop to 0dp (no
 * false precision on a +240% return). One rule, applied everywhere, keeps the
 * app's percentages consistent without forcing a uniform digit count.
 */
export function fmtPct(n: number, decimals?: number): string {
  const abs = Math.abs(n);
  const d = decimals ?? (abs < 1 ? 2 : abs < 100 ? 1 : 0);
  return `${(n >= 0 ? "+" : "") + n.toFixed(d)}%`;
}

export function fmtNum(n: number, d = 2): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
}

const DAY_MS = 86_400_000;

export function fmtRelativeDate(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const days = Math.max(0, Math.floor((now.getTime() - then.getTime()) / DAY_MS));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 week ago";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return "1 month ago";
  return `${Math.floor(days / 30)} months ago`;
}
