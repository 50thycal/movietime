import { db } from "@/lib/db";
import { BadRequest, fail, ok, parseInt_, readJson } from "@/lib/http";
import { requireMemberId } from "@/lib/identity";
import { MAX_CANDIDATES, proposeMovies } from "@/lib/server";
import { movieDetails } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

/** Propose one film or a shortlist: metadata is imported server-side from TMDB ids. */
export async function POST(req: Request) {
  try {
    const me = requireMemberId(req);
    const body = await readJson(req);
    const ids = Array.isArray(body.tmdb_ids) ? body.tmdb_ids : body.tmdb_id != null ? [body.tmdb_id] : [];
    if (ids.length < 1 || ids.length > MAX_CANDIDATES) throw new BadRequest(`Pick between 1 and ${MAX_CANDIDATES} movies`);
    const tmdbIds = ids.map((v: unknown) => parseInt_(v, "tmdb_id"));
    const sql = await db();
    const movies = await Promise.all(tmdbIds.map((id: number) => movieDetails(id)));
    return ok(await proposeMovies(sql, me, movies), 201);
  } catch (err) {
    return fail(err);
  }
}
