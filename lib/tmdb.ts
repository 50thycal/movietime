import type { Genre, TmdbSearchResult } from "./types";

/**
 * Thin TMDB v3 client. Server-only: the key never reaches the browser.
 *
 * TMDB_API_KEY accepts either the classic v3 "API key" (a 32-char hex string,
 * sent as ?api_key=) or the newer v4 "API Read Access Token" (a long JWT,
 * sent as a Bearer header). Both are shown on the same TMDB settings page and
 * people copy whichever is nearer, so accept both.
 */
// TMDB_API_BASE exists so tests can point the client at a local stub.
const BASE = process.env.TMDB_API_BASE ?? "https://api.themoviedb.org/3";
export const IMAGE_BASE = "https://image.tmdb.org/t/p";

export function posterUrl(path: string | null | undefined, size: "w185" | "w342" | "w500" | "w780" = "w342") {
  return path ? `${IMAGE_BASE}/${size}${path}` : null;
}

type Creds = { kind: "bearer"; token: string } | { kind: "apiKey"; key: string };

function credentials(): Creds {
  const key = process.env.TMDB_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "TMDB_API_KEY is not set. Create a free key at themoviedb.org/settings/api and add it to the " +
        "project's environment variables (Vercel → Settings → Environment Variables), then redeploy.",
    );
  }
  return key.length > 40 ? { kind: "bearer", token: key } : { kind: "apiKey", key };
}

async function tmdb<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const creds = credentials();
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  url.searchParams.set("language", "en-US");
  if (creds.kind === "apiKey") url.searchParams.set("api_key", creds.key);
  const res = await fetch(url.toString(), {
    headers: creds.kind === "bearer" ? { authorization: `Bearer ${creds.token}`, accept: "application/json" } : { accept: "application/json" },
    // Metadata for a given film barely changes; let Next's fetch cache absorb repeats.
    next: { revalidate: 60 * 60 },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`TMDB ${res.status}: ${(body as { status_message?: string }).status_message ?? res.statusText}`);
  }
  return res.json() as Promise<T>;
}

interface TmdbMovieRaw {
  id: number;
  title: string;
  release_date?: string;
  runtime?: number | null;
  genres?: Genre[];
  genre_ids?: number[];
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  credits?: { crew?: { job: string; name: string }[] };
}

function yearOf(date?: string | null): number | null {
  if (!date) return null;
  const y = Number(date.slice(0, 4));
  return Number.isFinite(y) && y > 1800 ? y : null;
}

export function normalizeMovie(raw: TmdbMovieRaw, genreLookup?: Map<number, string>): TmdbSearchResult {
  const genres: Genre[] =
    raw.genres ??
    (raw.genre_ids ?? [])
      .map((id) => ({ id, name: genreLookup?.get(id) ?? "" }))
      .filter((g) => g.name);
  const director = raw.credits?.crew?.find((c) => c.job === "Director")?.name ?? null;
  return {
    tmdb_id: raw.id,
    title: raw.title,
    year: yearOf(raw.release_date),
    release_date: raw.release_date || null,
    runtime_min: raw.runtime ?? null,
    genres,
    overview: raw.overview ?? "",
    poster_path: raw.poster_path ?? null,
    backdrop_path: raw.backdrop_path ?? null,
    director,
    tmdb_rating: raw.vote_average != null && raw.vote_count ? Math.round(raw.vote_average * 10) / 10 : null,
    tmdb_votes: raw.vote_count ?? null,
    popularity: raw.popularity ?? null,
  };
}

let genreCache: { at: number; genres: Genre[] } | null = null;

export async function movieGenres(): Promise<Genre[]> {
  if (genreCache && Date.now() - genreCache.at < 24 * 3_600_000) return genreCache.genres;
  const data = await tmdb<{ genres: Genre[] }>("/genre/movie/list");
  genreCache = { at: Date.now(), genres: data.genres };
  return data.genres;
}

/** Full details for one film, including its director. */
export async function movieDetails(tmdbId: number): Promise<TmdbSearchResult> {
  const raw = await tmdb<TmdbMovieRaw>(`/movie/${tmdbId}`, { append_to_response: "credits" });
  return normalizeMovie(raw);
}

/**
 * Search, then hydrate the top few hits with runtime + director, which the
 * search endpoint doesn't carry. Eight parallel detail calls is cheap and
 * means the picker never has to open a result to learn it's 3 hours long.
 */
export async function searchMovies(query: string, limit = 8): Promise<TmdbSearchResult[]> {
  const data = await tmdb<{ results: TmdbMovieRaw[] }>("/search/movie", { query, include_adult: "false", page: 1 });
  const top = data.results.slice(0, limit);
  const detailed = await Promise.all(
    top.map((r) => movieDetails(r.id).catch(() => normalizeMovie(r))),
  );
  return detailed;
}

export interface DiscoverFilters {
  genreId?: number;
  maxRuntime?: number;
  minRuntime?: number;
  yearFrom?: number;
  yearTo?: number;
  minRating?: number;
  minVotes?: number;
}

/**
 * Discover candidates with popularity guard-rails so roulette doesn't serve
 * obscure junk. Returns several pages' worth so the caller can exclude
 * already-watched films and still have something to pick from.
 */
export async function discoverMovies(filters: DiscoverFilters, page: number): Promise<{ results: TmdbSearchResult[]; totalPages: number }> {
  const genres = await movieGenres();
  const lookup = new Map(genres.map((g) => [g.id, g.name]));
  const data = await tmdb<{ results: TmdbMovieRaw[]; total_pages: number }>("/discover/movie", {
    sort_by: "popularity.desc",
    include_adult: "false",
    include_video: "false",
    "vote_count.gte": filters.minVotes ?? 500,
    "vote_average.gte": filters.minRating,
    with_genres: filters.genreId,
    "with_runtime.lte": filters.maxRuntime,
    "with_runtime.gte": filters.minRuntime ?? 60,
    "primary_release_date.gte": filters.yearFrom ? `${filters.yearFrom}-01-01` : undefined,
    "primary_release_date.lte": filters.yearTo ? `${filters.yearTo}-12-31` : undefined,
    page,
  });
  return {
    results: data.results.map((r) => normalizeMovie(r, lookup)),
    totalPages: data.total_pages,
  };
}
