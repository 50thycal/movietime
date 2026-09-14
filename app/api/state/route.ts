import { db } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { memberIdFrom } from "@/lib/identity";
import { loadHomeState } from "@/lib/server";

export const dynamic = "force-dynamic";

/** The home screen's single source of truth. */
export async function GET(req: Request) {
  try {
    const sql = await db();
    return ok(await loadHomeState(sql, memberIdFrom(req)));
  } catch (err) {
    return fail(err);
  }
}
