/**
 * The streaming services the group can pick from. Client-safe (no TMDB calls).
 *
 * TMDB lists one service under several provider ids ("Netflix" and "Netflix
 * Standard with Ads", "Peacock Premium" and "Peacock Premium Plus"…) and adds
 * new ones as plans change. So a service is matched by name against TMDB's
 * live provider list (see `resolveProviderIds` in lib/tmdb.ts); `ids` is only the
 * fallback used if that list can't be fetched.
 */
export const WATCH_REGION = "US";

export interface StreamingService {
  key: string;
  label: string;
  match: RegExp;
  ids: number[];
}

export const SERVICES: StreamingService[] = [
  { key: "netflix", label: "Netflix", match: /^netflix/i, ids: [8, 1796] },
  { key: "prime", label: "Prime Video", match: /^amazon prime video/i, ids: [9, 2100] },
  { key: "hulu", label: "Hulu", match: /^hulu/i, ids: [15] },
  { key: "disney", label: "Disney+", match: /^disney ?(\+|plus)/i, ids: [337] },
  { key: "paramount", label: "Paramount+", match: /^paramount ?(\+|plus)/i, ids: [531] },
  { key: "peacock", label: "Peacock", match: /^peacock/i, ids: [386, 387] },
  { key: "discovery", label: "discovery+", match: /^discovery ?(\+|plus)/i, ids: [520] },
  { key: "max", label: "Max", match: /^(hbo )?max\b/i, ids: [1899] },
  { key: "appletv", label: "Apple TV+", match: /^apple tv ?(\+|plus)/i, ids: [350] },
  { key: "starz", label: "Starz", match: /^starz/i, ids: [43] },
  { key: "tubi", label: "Tubi", match: /^tubi/i, ids: [73] },
];

/** What the group had when this shipped; used until someone changes it in Settings. */
export const DEFAULT_SERVICE_KEYS = ["netflix", "prime", "hulu", "disney", "paramount", "peacock", "discovery"];

export interface StreamingSettings {
  region: string;
  services: string[];
}

export function cleanServiceKeys(keys: unknown): string[] {
  if (!Array.isArray(keys)) return [];
  const known = new Set(SERVICES.map((s) => s.key));
  return [...new Set(keys.filter((k): k is string => typeof k === "string" && known.has(k)))];
}

/** Which of our catalog services a TMDB provider name belongs to, if any. */
export function serviceKeyFor(providerName: string): string | null {
  // "Paramount+ Amazon Channel" and friends are resold add-ons, not the subscription itself.
  if (/channel/i.test(providerName)) return null;
  return SERVICES.find((s) => s.match.test(providerName))?.key ?? null;
}

export function serviceLabel(key: string): string {
  return SERVICES.find((s) => s.key === key)?.label ?? key;
}
