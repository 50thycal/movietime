import { db } from "@/lib/db";
import { BadRequest, fail, ok, parseId, parseSnackKind, parseText, readJson } from "@/lib/http";
import { requireMemberId } from "@/lib/identity";
import { deleteSnack, updateSnack } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Fix who brought it, what it was, or its note. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await ctx.params).id);
    const me = requireMemberId(req);
    const body = await readJson(req);
    const changes = {
      broughtBy: body.member_id === undefined ? undefined : parseId(body.member_id, "member_id"),
      name: body.name === undefined ? undefined : parseText(body.name, "name", 60)!,
      kind: body.kind === undefined ? undefined : parseSnackKind(body.kind),
      note: body.note === undefined ? undefined : parseText(body.note, "note", 140, false),
    };
    if (Object.values(changes).every((v) => v === undefined)) throw new BadRequest("Nothing to change");
    const sql = await db();
    return ok(await updateSnack(sql, id, me, changes));
  } catch (err) {
    return fail(err);
  }
}

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
