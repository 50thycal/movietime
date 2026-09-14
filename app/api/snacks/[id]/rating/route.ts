import { db } from "@/lib/db";
import { fail, ok, parseId, parseSnackScore, readJson } from "@/lib/http";
import { requireMemberId } from "@/lib/identity";
import { rateSnack } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await ctx.params).id);
    const me = requireMemberId(req);
    const body = await readJson(req);
    const sql = await db();
    return ok(await rateSnack(sql, id, me, parseSnackScore(body.score)), 201);
  } catch (err) {
    return fail(err);
  }
}
