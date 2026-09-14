import { db } from "@/lib/db";
import { fail, ok, parseInt_, parseText, readJson } from "@/lib/http";
import { requireMemberId } from "@/lib/identity";
import { addToWishlist, loadWishlist } from "@/lib/server";
import { movieDetails } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = await db();
    return ok(await loadWishlist(sql));
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  try {
    const me = requireMemberId(req);
    const body = await readJson(req);
    const tmdbId = parseInt_(body.tmdb_id, "tmdb_id");
    const note = parseText(body.note, "note", 140, false);
    const sql = await db();
    const movie = await movieDetails(tmdbId);
    return ok(await addToWishlist(sql, me, movie, note), 201);
  } catch (err) {
    return fail(err);
  }
}
