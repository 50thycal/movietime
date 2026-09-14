import { db } from "@/lib/db";
import { BadRequest, fail, ok, parseId, readJson } from "@/lib/http";
import { memberIdFrom, requireMemberId } from "@/lib/identity";
import { adjustCoins, loadHomeState, setBudget, startNewCycle } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * Settings → coins.
 *   { initial, allowance }        set the budget amounts
 *   { action: "new_cycle" }       start a new cycle and pay the allowance now
 *   { member_id, delta }          hand-adjust one balance
 */
export async function POST(req: Request) {
  try {
    requireMemberId(req);
    const body = await readJson(req);
    const sql = await db();
    if (body.action === "new_cycle") {
      await startNewCycle(sql);
    } else if (body.member_id !== undefined) {
      await adjustCoins(sql, parseId(body.member_id, "member_id"), Number(body.delta));
    } else if (body.initial !== undefined || body.allowance !== undefined) {
      await setBudget(sql, { initial: Number(body.initial), allowance: Number(body.allowance) });
    } else {
      throw new BadRequest("Nothing to do");
    }
    return ok(await loadHomeState(sql, memberIdFrom(req)));
  } catch (err) {
    return fail(err);
  }
}
