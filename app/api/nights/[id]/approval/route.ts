import { db } from "@/lib/db";
import { BadRequest, fail, ok, parseId, parseText, readJson } from "@/lib/http";
import { requireMemberId } from "@/lib/identity";
import { decideApproval } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await ctx.params).id);
    const me = requireMemberId(req);
    const body = await readJson(req);
    if (body.decision !== "approve" && body.decision !== "reject") throw new BadRequest("decision must be approve or reject");
    const reason = parseText(body.reason, "reason", 200, false);
    const sql = await db();
    return ok(await decideApproval(sql, id, me, body.decision, reason));
  } catch (err) {
    return fail(err);
  }
}
