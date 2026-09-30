import { db } from "@/lib/db";
import { BadRequest, fail, ok } from "@/lib/http";
import { filterCandidates, pickRandom } from "@/lib/roulette";
import { loadDataset, watchedTmdbIds } from "@/lib/server";
import { cleanServiceKeys } from "@/lib/streaming";
import { buildTasteModel, favouriteGenre, MIN_RATED, rankForSpin, scoreCandidate, seedFilms, type Candidate } from "@/lib/taste";
import {
  discoverMovies,
  movieGenres,
  movieWithExtras,
  recommendations,
  resolveProviderIds,
  type DiscoverFilters,
} from "@/lib/tmdb";
import type { SpinResult, TmdbSearchResult } from "@/lib/types";

export const dynamic = "force-dynamic";

function num(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * ?mode=genre   → a random genre
 * ?mode=movie   → a random well-known, unwatched film matching the filters
 * ?mode=full    → a random genre, then a film in it
 * ?mode=taste   → a film scored against the group's ratings (&for=<member id> for one person's)
 *
 * &services=netflix,hulu limits films to ones streaming on those services.
 */
export async function GET(req: Request) {
  try {
    const p = new URL(req.url).searchParams;
    const mode = p.get("mode") ?? "full";
    const genres = await movieGenres();
    let genre = genres.find((g) => g.id === num(p.get("genre"))) ?? null;

    if (mode === "genre" || (mode === "full" && !genre)) {
      genre = pickRandom(genres);
      if (mode === "genre") return ok<SpinResult>({ genre, movie: null, extras: null });
    }

    const serviceKeys = cleanServiceKeys((p.get("services") ?? "").split(","));
    const providerIds = await resolveProviderIds(serviceKeys);
    const filters: DiscoverFilters = {
      genreId: genre?.id,
      maxRuntime: num(p.get("max_runtime")),
      yearFrom: num(p.get("year_from")),
      yearTo: num(p.get("year_to")),
      minRating: num(p.get("min_rating")) ?? 6.5,
      minVotes: num(p.get("min_votes")) ?? 500,
      providerIds,
    };

    const sql = await db();
    const watched = await watchedTmdbIds(sql);

    if (mode === "taste") {
      const forMember = p.get("for") && p.get("for") !== "group" ? p.get("for") : null;
      return ok(await tasteSpin(sql, filters, watched, forMember));
    }

    // Pull a random page from the first few pages of popularity-sorted results,
    // so a spin can land on something the group hasn't heard of every time
    // but never on a film nobody has.
    const first = await discoverMovies(filters, 1);
    const pages = Math.min(first.totalPages, 10);
    if (pages === 0) throw new BadRequest(providerIds.length ? "Nothing on your services matches those filters — loosen them up" : "Nothing matches those filters — loosen them up");
    const page = 1 + Math.floor(Math.random() * pages);
    const results = page === 1 ? first.results : (await discoverMovies(filters, page)).results;
    let pool = filterCandidates(results, watched);
    if (!pool.length) pool = filterCandidates(first.results, watched);
    const picked = pickRandom(pool);
    if (!picked) throw new BadRequest("You've watched everything that matches. Loosen the filters.");
    // Discover results carry no runtime, director or providers — hydrate the winner.
    const full = await movieWithExtras(picked.tmdb_id).catch(() => null);
    return ok<SpinResult>({ genre, movie: full?.movie ?? picked, extras: full?.extras ?? null });
  } catch (err) {
    return fail(err);
  }
}

async function tasteSpin(
  sql: Awaited<ReturnType<typeof db>>,
  filters: DiscoverFilters,
  watched: Set<number>,
  forMember: string | null,
): Promise<SpinResult> {
  const data = await loadDataset(sql);
  const model = buildTasteModel(data, forMember);
  if (model.rated.length < MIN_RATED) {
    throw new BadRequest(
      `Pick like ${forMember ? model.who : "us"} needs at least ${MIN_RATED} rated movies (${model.rated.length} so far). Use normal roulette for now.`,
    );
  }

  const seeds = seedFilms(model);
  const steerGenre = filters.genreId ?? favouriteGenre(model) ?? undefined;
  const page = () => 1 + Math.floor(Math.random() * 3);
  const empty = { results: [] as TmdbSearchResult[], totalPages: 0 };
  const [recLists, byGenre, acclaimed] = await Promise.all([
    Promise.all(seeds.map((s) => recommendations(s.tmdb_id).catch(() => [] as TmdbSearchResult[]))),
    discoverMovies({ ...filters, genreId: steerGenre }, page()).catch(() => empty),
    discoverMovies({ ...filters, sortBy: "vote_average.desc" }, page()).catch(() => empty),
  ]);

  // Recommendations ignore discover's filters, so apply what we can locally.
  // Runtime and streaming need full details and are checked after hydration.
  const passes = (m: TmdbSearchResult) =>
    !watched.has(m.tmdb_id) &&
    !!m.poster_path &&
    (m.tmdb_votes ?? 0) >= (filters.minVotes ?? 0) &&
    (m.tmdb_rating ?? 0) >= (filters.minRating ?? 0) &&
    (!filters.yearFrom || (m.year ?? 0) >= filters.yearFrom) &&
    (!filters.yearTo || (m.year ?? 9999) <= filters.yearTo) &&
    (!filters.genreId || m.genres.some((g) => g.id === filters.genreId));

  const pool = new Map<number, Candidate>();
  const add = (m: TmdbSearchResult, seed?: (typeof seeds)[number]) => {
    if (!passes(m)) return;
    const c = pool.get(m.tmdb_id) ?? { movie: m, recommended_by: [] };
    if (seed && !c.recommended_by.includes(seed)) c.recommended_by.push(seed);
    pool.set(m.tmdb_id, c);
  };
  recLists.forEach((list, i) => list.forEach((m) => add(m, seeds[i])));
  [...byGenre.results, ...acclaimed.results].forEach((m) => add(m));
  if (!pool.size) throw new BadRequest("Couldn't find anything new that fits your taste and those filters — loosen them up");

  const ordered = rankForSpin([...pool.values()].map((c) => scoreCandidate(model, c)));
  // Hydrate a few at a time until one passes runtime + streaming checks.
  for (let i = 0; i < Math.min(ordered.length, 12); i += 4) {
    const batch = ordered.slice(i, i + 4);
    const full = await Promise.all(batch.map((c) => movieWithExtras(c.movie.tmdb_id).catch(() => null)));
    for (let j = 0; j < batch.length; j++) {
      const f = full[j];
      if (!f) continue;
      const rt = f.movie.runtime_min;
      if (filters.maxRuntime && (rt == null || rt > filters.maxRuntime)) continue;
      if (filters.providerIds?.length && !f.extras.providers.stream.some((x) => filters.providerIds!.includes(x.provider_id))) continue;
      return { genre: null, movie: f.movie, extras: f.extras, reasons: batch[j].reasons, for_member: forMember };
    }
  }
  throw new BadRequest("Nothing that fits your taste is on your services with those filters — loosen them up");
}
