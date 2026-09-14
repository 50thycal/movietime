import { db } from "@/lib/db";
import { fail, ok, parseId } from "@/lib/http";
import { requireMemberId } from "@/lib/identity";
import { deleteSnack } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await ctx.params).id);
    const sql = await db();
    await deleteSnack(sql, id, requireMemberId(req));
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
