import { db } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { loadDataset } from "@/lib/server";
import {
  awardTotals,
  criticStats,
  groupGenreStats,
  leaderboards,
  memberGenreStats,
  pickerStats,
  predictionStats,
  runtimeStats,
  snackStats,
  tasteProfile,
} from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = await db();
    const data = await loadDataset(sql);
    return ok({
      members: data.members,
      nights: data.nights.length,
      leaderboards: leaderboards(data),
      pickers: pickerStats(data),
      critics: criticStats(data),
      group_genres: groupGenreStats(data),
      member_genres: memberGenreStats(data),
      runtime: runtimeStats(data),
      snacks: snackStats(data),
      predictions: predictionStats(data),
      awards: awardTotals(data),
      taste: tasteProfile(data),
    });
  } catch (err) {
    return fail(err);
  }
}
