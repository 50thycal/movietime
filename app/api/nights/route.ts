import { db } from "@/lib/db";
import { fail, ok, parseInt_, readJson } from "@/lib/http";
import { requireMemberId } from "@/lib/identity";
import { proposeMovie } from "@/lib/server";
import { movieDetails } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

/** Propose a film: metadata is imported server-side from its TMDB id. */
export async function POST(req: Request) {
  try {
    const me = requireMemberId(req);
    const body = await readJson(req);
    const tmdbId = parseInt_(body.tmdb_id, "tmdb_id");
    const sql = await db();
    const movie = await movieDetails(tmdbId);
    return ok(await proposeMovie(sql, me, movie), 201);
  } catch (err) {
    return fail(err);
  }
}
