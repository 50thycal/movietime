import { db } from "@/lib/db";
import { BadRequest, fail, ok, parseId, parseInt_, parseScore, readJson } from "@/lib/http";
import { requireMemberId } from "@/lib/identity";
import { backfillNight } from "@/lib/server";
import { movieDetails } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

/** Add a movie the group watched before MovieTime existed. */
export async function POST(req: Request) {
  try {
    const me = requireMemberId(req);
    const body = await readJson(req);
    const tmdbId = parseInt_(body.tmdb_id, "tmdb_id");
    const selectorId = parseId(body.selector_id, "selector_id");
    const watched = new Date(typeof body.watched_at === "string" ? body.watched_at : "");
    if (Number.isNaN(watched.getTime())) throw new BadRequest("watched_at must be a date");
    if (watched.getTime() > Date.now() + 86_400_000) throw new BadRequest("That date is in the future");
    const ratings = Array.isArray(body.ratings)
      ? body.ratings
          .filter((r: { score?: unknown }) => r && r.score != null && r.score !== "")
          .map((r: { member_id: unknown; score: unknown }) => ({ member_id: parseId(r.member_id, "member_id"), score: parseScore(r.score) }))
      : [];
    const sql = await db();
    const movie = await movieDetails(tmdbId);
    return ok(await backfillNight(sql, me, movie, selectorId, watched, ratings), 201);
  } catch (err) {
    return fail(err);
  }
}
