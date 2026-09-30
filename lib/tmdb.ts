import { SERVICES, WATCH_REGION, serviceKeyFor } from "./streaming";
import type { CastMember, Genre, MovieExtras, MovieWithExtras, TmdbSearchResult, WatchProvider } from "./types";

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
  credits?: { crew?: { job: string; name: string }[]; cast?: { name: string; character?: string; profile_path?: string | null; order?: number }[] };
  tagline?: string;
  imdb_id?: string | null;
  videos?: { results?: TmdbVideoRaw[] };
  release_dates?: { results?: { iso_3166_1: string; release_dates: { certification: string; type: number }[] }[] };
  "watch/providers"?: { results?: Record<string, TmdbRegionProvidersRaw> };
}

interface TmdbVideoRaw {
  key: string;
  site: string;
  type: string;
  official?: boolean;
  published_at?: string;
}

interface TmdbProviderRaw {
  provider_id: number;
  provider_name: string;
  logo_path?: string | null;
  display_priority?: number;
}

interface TmdbRegionProvidersRaw {
  link?: string;
  flatrate?: TmdbProviderRaw[];
  free?: TmdbProviderRaw[];
  ads?: TmdbProviderRaw[];
  rent?: TmdbProviderRaw[];
  buy?: TmdbProviderRaw[];
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

// Everything the pick card shows, in one request. Every details lookup uses
// this same URL, so a film viewed on the roulette card is already in Next's
// fetch cache by the time someone accepts it.
const DETAIL_APPENDS = "credits,videos,release_dates,watch/providers";

/** Full details for one film, including its director. */
export async function movieDetails(tmdbId: number): Promise<TmdbSearchResult> {
  return (await movieWithExtras(tmdbId)).movie;
}

/** Details plus trailer, cast, certification and where to watch it. */
export async function movieWithExtras(tmdbId: number, region = WATCH_REGION): Promise<MovieWithExtras> {
  const raw = await tmdb<TmdbMovieRaw>(`/movie/${tmdbId}`, { append_to_response: DETAIL_APPENDS });
  return { movie: normalizeMovie(raw), extras: extractExtras(raw, region) };
}

const TRAILER_RANK = ["Trailer", "Teaser", "Clip"];

/** Official trailer first, then any trailer, then a teaser; newest wins a tie. */
export function bestTrailer(videos: TmdbVideoRaw[]): string | null {
  const yt = videos.filter((v) => v.site === "YouTube" && TRAILER_RANK.includes(v.type));
  const rank = (v: TmdbVideoRaw) => TRAILER_RANK.indexOf(v.type) * 2 + (v.official ? 0 : 1);
  yt.sort((a, b) => rank(a) - rank(b) || (b.published_at ?? "").localeCompare(a.published_at ?? ""));
  return yt[0]?.key ?? null;
}

function providers(xs: TmdbProviderRaw[] | undefined): WatchProvider[] {
  return (xs ?? [])
    .slice()
    .sort((a, b) => (a.display_priority ?? 99) - (b.display_priority ?? 99))
    .map((p) => ({ provider_id: p.provider_id, provider_name: p.provider_name, logo_path: p.logo_path ?? null, service: serviceKeyFor(p.provider_name) }));
}

/** One entry per provider id, in first-seen order. */
function uniqueProviders(xs: WatchProvider[]): WatchProvider[] {
  return xs.filter((p, i) => xs.findIndex((q) => q.provider_id === p.provider_id) === i);
}

export function extractExtras(raw: TmdbMovieRaw, region = WATCH_REGION): MovieExtras {
  const releases = raw.release_dates?.results?.find((r) => r.iso_3166_1 === region)?.release_dates ?? [];
  // Theatrical (3) is the canonical rating; fall back to any dated release that has one.
  const cert =
    releases.find((r) => r.type === 3 && r.certification)?.certification ??
    releases.find((r) => r.certification)?.certification ??
    null;
  const cast: CastMember[] = (raw.credits?.cast ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .slice(0, 8)
    .map((c) => ({ name: c.name, character: c.character || null, profile_path: c.profile_path ?? null }));
  const wp = raw["watch/providers"]?.results?.[region];
  return {
    tagline: raw.tagline?.trim() || null,
    certification: cert,
    cast,
    trailer_key: bestTrailer(raw.videos?.results ?? []),
    imdb_id: raw.imdb_id || null,
    providers: {
      link: wp?.link ?? null,
      stream: uniqueProviders([...providers(wp?.flatrate), ...providers(wp?.free), ...providers(wp?.ads)]),
      rent: providers(wp?.rent),
      buy: providers(wp?.buy),
    },
  };
}

let providerListCache: { at: number; region: string; list: TmdbProviderRaw[] } | null = null;

/**
 * TMDB provider ids for our catalog services, matched by name against the
 * live list so plan variants ("… with Ads", "… Premium Plus") are included.
 * Amazon/Apple "Channel" resellers are left out: they'd match on name but
 * aren't the subscription the group has.
 */
export async function resolveProviderIds(keys: string[], region = WATCH_REGION): Promise<number[]> {
  const wanted = SERVICES.filter((s) => keys.includes(s.key));
  if (!wanted.length) return [];
  try {
    if (!providerListCache || providerListCache.region !== region || Date.now() - providerListCache.at > 24 * 3_600_000) {
      const data = await tmdb<{ results: TmdbProviderRaw[] }>("/watch/providers/movie", { watch_region: region });
      providerListCache = { at: Date.now(), region, list: data.results };
    }
    const ids = providerListCache.list
      .filter((p) => !/channel/i.test(p.provider_name) && wanted.some((s) => s.match.test(p.provider_name)))
      .map((p) => p.provider_id);
    if (ids.length) return [...new Set(ids)];
  } catch {
    // Fall through to the built-in ids.
  }
  return [...new Set(wanted.flatMap((s) => s.ids))];
}

/** TMDB's "people who liked this also liked" list — raw, without runtime. */
export async function recommendations(tmdbId: number): Promise<TmdbSearchResult[]> {
  const genres = await movieGenres();
  const lookup = new Map(genres.map((g) => [g.id, g.name]));
  const data = await tmdb<{ results: TmdbMovieRaw[] }>(`/movie/${tmdbId}/recommendations`, { page: 1 });
  return data.results.map((r) => normalizeMovie(r, lookup));
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
    // Credits only: search wants runtime + director fast, not the whole pick card.
    top.map((r) =>
      tmdb<TmdbMovieRaw>(`/movie/${r.id}`, { append_to_response: "credits" })
        .then((raw) => normalizeMovie(raw))
        .catch(() => normalizeMovie(r)),
    ),
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
  /** Only films streaming (subscription/free/ads) on one of these provider ids. */
  providerIds?: number[];
  sortBy?: string;
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
    sort_by: filters.sortBy ?? "popularity.desc",
    include_adult: "false",
    include_video: "false",
    "vote_count.gte": filters.minVotes ?? 500,
    "vote_average.gte": filters.minRating,
    with_genres: filters.genreId,
    "with_runtime.lte": filters.maxRuntime,
    "with_runtime.gte": filters.minRuntime ?? 60,
    "primary_release_date.gte": filters.yearFrom ? `${filters.yearFrom}-01-01` : undefined,
    "primary_release_date.lte": filters.yearTo ? `${filters.yearTo}-12-31` : undefined,
    watch_region: filters.providerIds?.length ? WATCH_REGION : undefined,
    with_watch_providers: filters.providerIds?.length ? filters.providerIds.join("|") : undefined,
    with_watch_monetization_types: filters.providerIds?.length ? "flatrate|free|ads" : undefined,
    page,
  });
  return {
    results: data.results.map((r) => normalizeMovie(r, lookup)),
    totalPages: data.total_pages,
  };
}
