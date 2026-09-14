/** "1h 47m" rather than 107 — runtime should be readable at a glance. */
export function fmtRuntime(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min) || min <= 0) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export const RUNTIME_BUCKETS = [
  { key: "lt90", label: "< 90 min", min: 0, max: 89 },
  { key: "90-120", label: "90–120", min: 90, max: 120 },
  { key: "120-150", label: "120–150", min: 121, max: 150 },
  { key: "150+", label: "150+", min: 151, max: Infinity },
] as const;
export type RuntimeBucketKey = (typeof RUNTIME_BUCKETS)[number]["key"];

export function runtimeBucket(min: number | null | undefined): RuntimeBucketKey | null {
  if (min == null) return null;
  return RUNTIME_BUCKETS.find((b) => min >= b.min && min <= b.max)?.key ?? null;
}

/** One decimal, no trailing ".0" — "7.5" and "8", never "8.0". */
export function fmtScore(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const r = Number(n.toFixed(digits));
  return String(r);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function decadeOf(year: number | null | undefined): string | null {
  if (!year) return null;
  return `${Math.floor(year / 10) * 10}s`;
}

export function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return fmtDate(iso);
}
