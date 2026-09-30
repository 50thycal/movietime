import { db } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { requireMemberId } from "@/lib/identity";
import { setStreaming } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Settings → streaming services. { services: ["netflix", "hulu", …] } */
export async function POST(req: Request) {
  try {
    requireMemberId(req);
    const body = await readJson(req);
    return ok(await setStreaming(await db(), body.services));
  } catch (err) {
    return fail(err);
  }
}
