import { db } from "@/lib/db";
import { BadRequest, fail, ok } from "@/lib/http";
import { filterCandidates, pickRandom } from "@/lib/roulette";
import { watchedTmdbIds } from "@/lib/server";
import { discoverMovies, movieGenres, type DiscoverFilters } from "@/lib/tmdb";

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
 */
export async function GET(req: Request) {
  try {
    const p = new URL(req.url).searchParams;
    const mode = p.get("mode") ?? "full";
    const genres = await movieGenres();
    let genre = genres.find((g) => g.id === num(p.get("genre"))) ?? null;

    if (mode === "genre" || (mode === "full" && !genre)) {
      genre = pickRandom(genres);
      if (mode === "genre") return ok({ genre, movie: null });
    }

    const filters: DiscoverFilters = {
      genreId: genre?.id,
      maxRuntime: num(p.get("max_runtime")),
      yearFrom: num(p.get("year_from")),
      yearTo: num(p.get("year_to")),
      minRating: num(p.get("min_rating")) ?? 6.5,
      minVotes: num(p.get("min_votes")) ?? 500,
    };

    const sql = await db();
    const watched = await watchedTmdbIds(sql);

    // Pull a random page from the first few pages of popularity-sorted results,
    // so a spin can land on something the group hasn't heard of every time
    // but never on a film nobody has.
    const first = await discoverMovies(filters, 1);
    const pages = Math.min(first.totalPages, 10);
    if (pages === 0) throw new BadRequest("Nothing matches those filters — loosen them up");
    const page = 1 + Math.floor(Math.random() * pages);
    const results = page === 1 ? first.results : (await discoverMovies(filters, page)).results;
    let pool = filterCandidates(results, watched);
    if (!pool.length) pool = filterCandidates(first.results, watched);
    const movie = pickRandom(pool);
    if (!movie) throw new BadRequest("You've watched everything that matches. Loosen the filters.");
    return ok({ genre, movie });
  } catch (err) {
    return fail(err);
  }
}
