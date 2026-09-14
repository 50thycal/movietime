import type { TmdbSearchResult } from "./types";

/** Drop anything the group has already watched, then anything with no poster (junk signal). */
export function filterCandidates(results: TmdbSearchResult[], watched: Set<number>): TmdbSearchResult[] {
  return results.filter((r) => !watched.has(r.tmdb_id) && r.poster_path);
}

export function pickRandom<T>(xs: T[], rand: () => number = Math.random): T | null {
  if (!xs.length) return null;
  return xs[Math.floor(rand() * xs.length) % xs.length];
}
