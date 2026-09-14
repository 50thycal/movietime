import { db } from "@/lib/db";
import { fail, ok, parseId } from "@/lib/http";
import { requireMemberId } from "@/lib/identity";
import { finishMovie } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await ctx.params).id);
    const sql = await db();
    return ok(await finishMovie(sql, id, requireMemberId(req)));
  } catch (err) {
    return fail(err);
  }
}
