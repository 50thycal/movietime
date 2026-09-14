import { db } from "@/lib/db";
import { BadRequest, fail, ok, readJson } from "@/lib/http";
import { setupMembers } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    if (!Array.isArray(body.names)) throw new BadRequest("names must be a list");
    const names = body.names.map((n) => (typeof n === "string" ? n : ""));
    const sql = await db();
    return ok(await setupMembers(sql, names), 201);
  } catch (err) {
    return fail(err);
  }
}
