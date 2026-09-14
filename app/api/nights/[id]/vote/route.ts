import { db } from "@/lib/db";
import { fail, ok, parseId, readJson } from "@/lib/http";
import { requireMemberId } from "@/lib/identity";
import { castVote } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await ctx.params).id);
    const me = requireMemberId(req);
    const body = await readJson(req);
    const sql = await db();
    return ok(await castVote(sql, id, me, parseId(body.movie_id, "movie_id")));
  } catch (err) {
    return fail(err);
  }
}
