import { db } from "@/lib/db";
import { BadRequest, fail, NotFound, ok, parseId, parseText, readJson } from "@/lib/http";
import type { Member } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Settings: rename, recolour, reorder or bench a member. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await ctx.params).id);
    const body = await readJson(req);
    const sql = await db();
    const rows = (await sql`SELECT * FROM members WHERE id = ${id}`) as Member[];
    if (!rows.length) throw new NotFound("Unknown member");
    const m = rows[0];
    const name = body.name === undefined ? m.name : parseText(body.name, "name", 40)!;
    const color = body.color === undefined ? m.color : parseText(body.color, "color", 20)!;
    const emoji = body.emoji === undefined ? m.emoji : parseText(body.emoji, "emoji", 8)!;
    const active = body.active === undefined ? m.active : Boolean(body.active);
    let position = m.rotation_position;
    if (body.rotation_position !== undefined) {
      position = Number(body.rotation_position);
      if (!Number.isInteger(position)) throw new BadRequest("rotation_position must be a whole number");
    }
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new BadRequest("color must be a hex colour");
    const updated = (await sql`UPDATE members SET name = ${name}, color = ${color}, emoji = ${emoji}, active = ${active}, rotation_position = ${position}
      WHERE id = ${id} RETURNING *`) as Member[];
    return ok(updated[0]);
  } catch (err) {
    return fail(err);
  }
}
