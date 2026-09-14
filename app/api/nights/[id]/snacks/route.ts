import { db } from "@/lib/db";
import { fail, ok, parseId, parseSnackKind, parseText, readJson } from "@/lib/http";
import { requireMemberId } from "@/lib/identity";
import { addSnack } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await ctx.params).id);
    const me = requireMemberId(req);
    const body = await readJson(req);
    const sql = await db();
    const item = await addSnack(sql, id, me, parseText(body.name, "name", 60)!, parseSnackKind(body.kind), parseText(body.note, "note", 140, false));
    return ok(item, 201);
  } catch (err) {
    return fail(err);
  }
}
