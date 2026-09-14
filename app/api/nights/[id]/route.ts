import { db } from "@/lib/db";
import { BadRequest, fail, ok, parseId, readJson } from "@/lib/http";
import { memberIdFrom, requireMemberId } from "@/lib/identity";
import { deleteNight, loadNightDetail, requireNight, updateNight, withdrawProposal } from "@/lib/server";

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

/** Fix a finished night's picker or date watched. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await ctx.params).id);
    const me = requireMemberId(req);
    const body = await readJson(req);
    const selectorId = body.selector_id === undefined ? undefined : parseId(body.selector_id, "selector_id");
    let watchedAt: Date | undefined;
    if (body.watched_at !== undefined) {
      watchedAt = new Date(typeof body.watched_at === "string" ? body.watched_at : "");
      if (Number.isNaN(watchedAt.getTime())) throw new BadRequest("watched_at must be a date");
      if (watchedAt.getTime() > Date.now() + 86_400_000) throw new BadRequest("That date is in the future");
    }
    if (!selectorId && !watchedAt) throw new BadRequest("Nothing to change");
    const sql = await db();
    return ok(await updateNight(sql, me, id, { selectorId, watchedAt }));
  } catch (err) {
    return fail(err);
  }
}

/**
 * The picker withdraws their own proposal (keeps the turn), or anyone removes
 * a finished night that shouldn't be in history.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await ctx.params).id);
    const me = requireMemberId(req);
    const sql = await db();
    const night = await requireNight(sql, id);
    if (night.status === "complete") await deleteNight(sql, me, id);
    else await withdrawProposal(sql, id, me);
    return ok({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
