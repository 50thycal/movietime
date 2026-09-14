/**
 * The stats page computes over rows loaded straight from Postgres. The driver
 * parses timestamptz into Date objects, so anything treating a timestamp as a
 * string breaks only here — never in the unit tests, which use string fixtures.
 * This runs the real /api/stats pipeline over a real database.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { db } from "../lib/db";
import * as s from "../lib/server";
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
} from "../lib/stats";
import { makeTestDb, MOVIE } from "./helpers/pglite";

let close: () => Promise<void>;
before(async () => {
  ({ close } = await makeTestDb());
});
after(async () => close());

test("every stat computes over rows loaded from the database", async () => {
  const sql = await db();
  const members = await s.setupMembers(sql, ["Calvin", "Molly", "Sam", "Jo"]);
  const active = members.filter((m) => m.active);

  // Two completed nights, one with predictions and snacks, one backfilled.
  const night = await s.proposeMovie(sql, members[0].id, MOVIE());
  for (const m of active.slice(1)) await s.decideApproval(sql, night.night.id, m.id, "approve", null);
  await s.submitPrediction(sql, night.night.id, members[0].id, 8, 7.5);
  await s.submitPrediction(sql, night.night.id, members[1].id, 6, null);
  await s.startMovie(sql, night.night.id, members[0].id);
  await s.finishMovie(sql, night.night.id, members[0].id);
  const snack = await s.addSnack(sql, night.night.id, members[1].id, "Popcorn", "snack", null);
  await s.rateSnack(sql, snack.id, members[0].id, 5);
  for (const [i, m] of active.entries()) await s.submitRating(sql, night.night.id, m.id, 6 + i * 0.5);

  await s.backfillNight(sql, members[0].id, MOVIE({ tmdb_id: 27205, title: "Inception" }), members[1].id, new Date("2024-05-05T20:00:00Z"), [
    { member_id: members[0].id, score: 9 },
    { member_id: members[1].id, score: 8 },
  ]);

  const data = await s.loadDataset(sql);
  assert.equal(data.nights.length, 2);

  // Timestamps must reach the domain layer as ISO strings, as the types promise.
  for (const n of data.nights) {
    assert.equal(typeof n.night.completed_at, "string", "completed_at should be an ISO string");
    assert.match(n.night.completed_at!, /^\d{4}-\d{2}-\d{2}T/);
  }

  // The whole /api/stats payload, exactly as the route builds it.
  const payload = {
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
  };
  assert.equal(payload.predictions.per_member.length, 4);
  assert.ok(payload.predictions.most_accurate);
  assert.equal(payload.pickers.length, 4);
  assert.ok(payload.taste.movies_watched === 2);
  assert.ok(payload.snacks.best_snack);
  assert.doesNotThrow(() => JSON.stringify(payload));

  // History and home state are serialisable and carry string timestamps too.
  const history = await s.loadHistory(sql);
  assert.equal(typeof history[0].night.completed_at, "string");
  const home = await s.loadHomeState(sql, members[0].id);
  assert.equal(typeof home.last_complete?.night.completed_at, "string");
});
