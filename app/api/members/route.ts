import { db } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { loadMembers } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = await db();
    return ok(await loadMembers(sql));
  } catch (err) {
    return fail(err);
  }
}
