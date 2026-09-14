import { db } from "@/lib/db";
import { fail, ok, parseId, parseText, readJson } from "@/lib/http";
import { requireMemberId } from "@/lib/identity";
import { deleteReview, editReview } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await ctx.params).id);
    const me = requireMemberId(req);
    const body = await readJson(req);
    const sql = await db();
    return ok(await editReview(sql, id, me, parseText(body.text, "review", 500)!));
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await ctx.params).id);
    const sql = await db();
    await deleteReview(sql, id, requireMemberId(req));
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
