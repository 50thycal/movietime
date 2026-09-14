import { db } from "@/lib/db";
import { fail, ok, parseId } from "@/lib/http";
import { memberIdFrom, requireMemberId } from "@/lib/identity";
import { loadNightDetail, withdrawProposal } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await ctx.params).id);
    const sql = await db();
    return ok(await loadNightDetail(sql, id, memberIdFrom(req)));
  } catch (err) {
    return fail(err);
  }
}

/** The picker withdraws their own proposal (keeps the turn). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await ctx.params).id);
    const me = requireMemberId(req);
    const sql = await db();
    await withdrawProposal(sql, id, me);
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
