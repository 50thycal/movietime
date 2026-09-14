import { db } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { loadHistory, loadMembers } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = await db();
    const [entries, members] = await Promise.all([loadHistory(sql), loadMembers(sql)]);
    return ok({ entries, members });
  } catch (err) {
    return fail(err);
  }
}
