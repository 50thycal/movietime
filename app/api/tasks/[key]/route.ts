import { db } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { memberIdFrom, requireMemberId } from "@/lib/identity";
import { completeTask, loadHomeState, reopenTask } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Tick a one-off to-do (POST) or un-tick it (DELETE). */
export async function POST(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  try {
    const me = requireMemberId(_req);
    const sql = await db();
    await completeTask(sql, me, (await ctx.params).key);
    return ok(await loadHomeState(sql, memberIdFrom(_req)));
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ key: string }> }) {
  try {
    const me = requireMemberId(req);
    const sql = await db();
    await reopenTask(sql, me, (await ctx.params).key);
    return ok(await loadHomeState(sql, memberIdFrom(req)));
  } catch (err) {
    return fail(err);
  }
}
