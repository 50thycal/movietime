import { db } from "@/lib/db";
import { fail, ok, parseId, readJson } from "@/lib/http";
import { loadHomeState, setRotation } from "@/lib/server";
import { memberIdFrom } from "@/lib/identity";

export const dynamic = "force-dynamic";

/** Settings → "it's actually X's turn". */
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const memberId = parseId(body.member_id, "member_id");
    const sql = await db();
    await setRotation(sql, memberId);
    return ok(await loadHomeState(sql, memberIdFrom(req)));
  } catch (err) {
    return fail(err);
  }
}
