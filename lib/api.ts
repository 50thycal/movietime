"use client";

import useSWR, { mutate } from "swr";
import { getMemberId } from "./me";
import type { HomeState, HistoryEntry, Member, NightDetail, TmdbSearchResult, Genre, WishlistEntry } from "./types";

function headers(): Record<string, string> {
  const me = getMemberId();
  return me ? { "x-member-id": me } : {};
}

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", headers: headers() });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

/**
 * Four phones on a couch: poll every 8s and on refocus. Fast enough that an
 * approval shows up on the picker's screen before they've looked up.
 */
const SHARED_OPTS = { refreshInterval: 8_000, revalidateOnFocus: true, keepPreviousData: true };

export function useHomeState() {
  return useSWR<HomeState>("/api/state", fetcher, SHARED_OPTS);
}
export function useNight(id: string | null) {
  return useSWR<NightDetail>(id ? `/api/nights/${id}` : null, fetcher, SHARED_OPTS);
}
export function useHistory() {
  return useSWR<{ entries: HistoryEntry[]; members: Member[] }>("/api/history", fetcher, SHARED_OPTS);
}
export function useStats() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useSWR<any>("/api/stats", fetcher, { ...SHARED_OPTS, refreshInterval: 30_000 });
}
export function useWishlist() {
  return useSWR<WishlistEntry[]>("/api/wishlist", fetcher, SHARED_OPTS);
}
export function useGenres() {
  return useSWR<Genre[]>("/api/genres", fetcher, { revalidateOnFocus: false });
}
export function useSearch(q: string) {
  return useSWR<TmdbSearchResult[]>(q.trim().length >= 2 ? `/api/movies/search?q=${encodeURIComponent(q.trim())}` : null, fetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
}

/** After any write, pull every shared view back in sync. */
export function refreshAll() {
  return mutate((key) => typeof key === "string" && key.startsWith("/api/") && !key.startsWith("/api/movies/search"), undefined, {
    revalidate: true,
  });
}

type Method = "POST" | "PATCH" | "DELETE";

export async function send<T>(method: Method, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { ...headers(), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(payload?.error ?? `Request failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  await refreshAll();
  return payload as T;
}

export { fetcher };

export function useVersionInfo() {
  return useSWR<{ build: string; builtAt: string }>("/api/version", fetcher, { refreshInterval: 5 * 60_000 }).data;
}
