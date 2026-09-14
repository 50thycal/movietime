import { db } from "@/lib/db";
import { fail, ok, parseId, parseScore, readJson } from "@/lib/http";
import { requireMemberId } from "@/lib/identity";
import { submitPrediction } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await ctx.params).id);
    const me = requireMemberId(req);
    const body = await readJson(req);
    const own = parseScore(body.own_score, "own_score");
    const group = body.group_score == null || body.group_score === "" ? null : parseScore(body.group_score, "group_score");
    const sql = await db();
    return ok(await submitPrediction(sql, id, me, own, group), 201);
  } catch (err) {
    return fail(err);
  }
}
