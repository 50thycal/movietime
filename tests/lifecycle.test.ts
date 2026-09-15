import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { db } from "../lib/db";
import * as s from "../lib/server";
import { firstImpressionStats, snackStats } from "../lib/stats";
import { makeTestDb, MOVIE } from "./helpers/pglite";

let close: () => Promise<void>;
before(async () => {
  ({ close } = await makeTestDb());
});
after(async () => close());

test("full movie night lifecycle against a real Postgres", async () => {
  const sql = await db();
  const members = await s.setupMembers(sql, ["Calvin", "Molly", "Sam", "Jo"]);
  assert.equal(members.length, 4);
  const [calvin, molly, sam, jo] = members;

  let home = await s.loadHomeState(sql, calvin.id);
  assert.equal(home.setup_complete, true);
  assert.equal(home.rotation.current?.id, calvin.id);
  assert.deepEqual(home.rotation.upcoming.map((m) => m.name), ["Molly", "Sam", "Jo"]);
  assert.equal(home.current, null);

  // Only the current selector may propose.
  await assert.rejects(s.proposeMovie(sql, molly.id, MOVIE()), /isn't your turn/);
  let night = await s.proposeMovie(sql, calvin.id, MOVIE());
  assert.equal(night.night.status, "proposed");
  assert.equal(night.movie.title, "The Matrix");
  assert.equal(night.movie.runtime_min, 136);
  assert.equal(night.movie.genres[1].name, "Science Fiction");

  // A second active proposal is blocked by the partial unique index too.
  await assert.rejects(s.proposeMovie(sql, calvin.id, MOVIE({ tmdb_id: 604, title: "Reloaded" })), /already a movie/);
  await assert.rejects(
    sql`INSERT INTO movie_nights (movie_id, selector_id, status) VALUES (${night.movie.id}, ${calvin.id}, 'proposed')`,
  );

  // Selector can't vote; others must.
  await assert.rejects(s.decideApproval(sql, night.night.id, calvin.id, "approve", null), /own pick/);
  night = await s.decideApproval(sql, night.night.id, molly.id, "approve", null);
  assert.equal(night.night.status, "proposed");
  night = await s.decideApproval(sql, night.night.id, sam.id, "approve", null);
  assert.equal(night.night.status, "proposed");
  night = await s.decideApproval(sql, night.night.id, jo.id, "approve", null);
  assert.equal(night.night.status, "approved");
  assert.equal(night.approvals.length, 3);

  // Predictions allowed before start, replaced on resubmit, locked after.
  await s.submitPrediction(sql, night.night.id, calvin.id, 8, 7.5);
  const p = await s.submitPrediction(sql, night.night.id, calvin.id, 8.5, 7.5);
  assert.equal(p.own_score, 8.5);
  await s.submitPrediction(sql, night.night.id, molly.id, 6, null);

  night = await s.startMovie(sql, night.night.id, calvin.id);
  assert.equal(night.night.status, "watching");
  await assert.rejects(s.submitPrediction(sql, night.night.id, sam.id, 7, null), /lock/);
  // Ratings not open yet.
  await assert.rejects(s.submitRating(sql, night.night.id, calvin.id, 8), /once the movie is finished/);

  night = await s.finishMovie(sql, night.night.id, molly.id);
  assert.equal(night.night.status, "rating");
  // Double tap is harmless.
  night = await s.finishMovie(sql, night.night.id, molly.id);
  assert.equal(night.night.status, "rating");

  // Hidden ratings until everyone is in; own score visible to self.
  night = await s.submitRating(sql, night.night.id, calvin.id, 9);
  assert.deepEqual(night.ratings, []);
  assert.deepEqual(night.rated_member_ids, [calvin.id]);
  assert.equal(night.my_rating, 9);
  const asMolly = await s.loadNightDetail(sql, night.night.id, molly.id);
  assert.equal(asMolly.my_rating, null);
  assert.deepEqual(asMolly.predictions, []);
  assert.equal(asMolly.my_prediction?.own_score, 6);

  // No double rating, no 7.3.
  await assert.rejects(s.submitRating(sql, night.night.id, calvin.id, 5), /already rated/);
  await assert.rejects(sql`INSERT INTO ratings (night_id, member_id, score) VALUES (${night.night.id}, ${molly.id}, 7.3)`);

  await s.submitRating(sql, night.night.id, molly.id, 6.5);
  await s.submitRating(sql, night.night.id, sam.id, 8);
  night = await s.submitRating(sql, night.night.id, jo.id, 7.5);
  assert.equal(night.night.status, "complete");
  assert.equal(night.ratings.length, 4);
  assert.equal(night.predictions.length, 2);
  assert.ok(night.night.completed_at);

  // Rotation advanced exactly once.
  home = await s.loadHomeState(sql, calvin.id);
  assert.equal(home.rotation.current?.id, molly.id);
  assert.equal(home.current, null);
  assert.equal(home.last_complete?.night.id, night.night.id);
  assert.equal(home.watched_count, 1);
  assert.equal(await s.completeNight(sql, night.night.id), false);
  assert.equal((await s.currentSelectorId(sql)), molly.id);
  await assert.rejects(s.submitRating(sql, night.night.id, calvin.id, 5), /already/);

  // History and dataset see it.
  const history = await s.loadHistory(sql);
  assert.equal(history.length, 1);
  assert.equal(history[0].group_avg, 7.8);
  const watched = await s.watchedTmdbIds(sql);
  assert.ok(watched.has(603));

  // Reviews: own edit/delete only.
  const review = await s.addReview(sql, night.night.id, molly.id, "Third act dragged.");
  await assert.rejects(s.editReview(sql, review.id, calvin.id, "nope"), /yours/);
  const edited = await s.editReview(sql, review.id, molly.id, "Third act dragged a lot.");
  assert.equal(edited.text, "Third act dragged a lot.");
  await assert.rejects(s.deleteReview(sql, review.id, sam.id));
  await s.deleteReview(sql, review.id, molly.id);

  // Snacks: rate once, re-rate replaces.
  const snack = await s.addSnack(sql, night.night.id, sam.id, "Popcorn", "snack", null);
  await s.rateSnack(sql, snack.id, calvin.id, 4);
  const again = await s.rateSnack(sql, snack.id, calvin.id, 5);
  assert.equal(again.score, 5);
  const detail = await s.loadNightDetail(sql, night.night.id, calvin.id);
  assert.equal(detail.snack_ratings.length, 1);

  const data = await s.loadDataset(sql);
  assert.equal(data.nights.length, 1);
  assert.equal(data.nights[0].snacks.length, 1);
  assert.equal(data.nights[0].predictions.length, 2);
});

test("rejection ends the proposal and keeps the turn", async () => {
  const sql = await db();
  const members = await s.loadMembers(sql);
  const molly = members.find((m) => m.name === "Molly")!;
  const sam = members.find((m) => m.name === "Sam")!;
  let night = await s.proposeMovie(sql, molly.id, MOVIE({ tmdb_id: 999, title: "Bad Movie", runtime_min: 170 }));
  night = await s.decideApproval(sql, night.night.id, sam.id, "reject", "Too long");
  assert.equal(night.night.status, "rejected");
  assert.equal(night.approvals[0].reason, "Too long");
  const home = await s.loadHomeState(sql, molly.id);
  assert.equal(home.current, null);
  assert.equal(home.rotation.current?.id, molly.id);
  // She can go again.
  const second = await s.proposeMovie(sql, molly.id, MOVIE({ tmdb_id: 1000, title: "Better Movie" }));
  assert.equal(second.night.status, "proposed");
  await s.withdrawProposal(sql, second.night.id, molly.id);
  assert.equal((await s.loadHomeState(sql, null)).current, null);
});

test("manual rotation override", async () => {
  const sql = await db();
  const members = await s.loadMembers(sql);
  const jo = members.find((m) => m.name === "Jo")!;
  await s.setRotation(sql, jo.id);
  assert.equal(await s.currentSelectorId(sql), jo.id);
});

test("shortlist vote picks the winner once everyone has voted", async () => {
  const sql = await db();
  const members = await s.loadMembers(sql);
  const jo = members.find((m) => m.name === "Jo")!;
  const calvin = members.find((m) => m.name === "Calvin")!;
  const molly = members.find((m) => m.name === "Molly")!;
  const sam = members.find((m) => m.name === "Sam")!;
  await s.setRotation(sql, jo.id);
  await assert.rejects(s.proposeMovies(sql, jo.id, []), /at least one/);
  await assert.rejects(
    s.proposeMovies(sql, jo.id, Array.from({ length: 7 }, (_, i) => MOVIE({ tmdb_id: 500 + i, title: `X${i}` }))),
    /At most 6/,
  );
  let night = await s.proposeMovies(sql, jo.id, [
    MOVIE({ tmdb_id: 11, title: "A" }),
    MOVIE({ tmdb_id: 12, title: "B" }),
    MOVIE({ tmdb_id: 13, title: "C" }),
  ]);
  assert.equal(night.candidates.length, 3);
  assert.deepEqual(night.candidates.map((c) => c.title), ["A", "B", "C"]);
  const [a, b] = night.candidates;
  // Approve/reject is not how a vote resolves.
  await assert.rejects(s.decideApproval(sql, night.night.id, calvin.id, "approve", null), /vote/);
  await assert.rejects(s.castVote(sql, night.night.id, calvin.id, night.movie.id + "x"), /shortlist|invalid/i);
  night = await s.castVote(sql, night.night.id, calvin.id, a.id);
  night = await s.castVote(sql, night.night.id, molly.id, b.id);
  night = await s.castVote(sql, night.night.id, sam.id, b.id);
  assert.equal(night.night.status, "proposed");
  // Changing a vote replaces it.
  night = await s.castVote(sql, night.night.id, sam.id, a.id);
  assert.equal(night.votes.length, 3);
  // Picker votes last and breaks the 2–2 tie in favour of B.
  night = await s.castVote(sql, night.night.id, jo.id, b.id);
  assert.equal(night.night.status, "approved");
  assert.equal(night.movie.title, "B");
  await s.withdrawProposal(sql, night.night.id, jo.id);
});

test("backfilled movies land in history without touching the rotation", async () => {
  const sql = await db();
  const members = await s.loadMembers(sql);
  const calvin = members.find((m) => m.name === "Calvin")!;
  const molly = members.find((m) => m.name === "Molly")!;
  const before = await s.currentSelectorId(sql);
  const night = await s.backfillNight(sql, molly.id, MOVIE({ tmdb_id: 77, title: "Old One" }), calvin.id, new Date("2024-03-01T20:00:00Z"), [
    { member_id: calvin.id, score: 8 },
    { member_id: molly.id, score: 7 },
  ]);
  assert.equal(night.night.status, "complete");
  assert.equal(night.ratings.length, 2);
  assert.equal(await s.currentSelectorId(sql), before);
  assert.equal((await s.loadHomeState(sql, null)).current, null);
  // A member who wasn't entered can add their own score later, once.
  const sam = members.find((m) => m.name === "Sam")!;
  const after = await s.submitRating(sql, night.night.id, sam.id, 6.5);
  assert.equal(after.ratings.length, 3);
  await assert.rejects(s.submitRating(sql, night.night.id, sam.id, 5), /already/);
  const history = await s.loadHistory(sql);
  assert.ok(history.some((h) => h.movie.title === "Old One" && h.night.completed_at && new Date(h.night.completed_at).getFullYear() === 2024));
});

test("wishlist is shared and clears itself once a film is watched", async () => {
  const sql = await db();
  const members = await s.loadMembers(sql);
  const calvin = members.find((m) => m.name === "Calvin")!;
  const molly = members.find((m) => m.name === "Molly")!;
  let list = await s.addToWishlist(sql, calvin.id, MOVIE({ tmdb_id: 900, title: "Wish A" }), "heard it's great");
  list = await s.addToWishlist(sql, molly.id, MOVIE({ tmdb_id: 901, title: "Wish B" }), null);
  assert.deepEqual(list.map((w) => w.movie.title), ["Wish B", "Wish A"]);
  assert.equal(list[1].added_by, calvin.id);
  assert.equal(list[1].note, "heard it's great");
  // Adding the same film twice is a no-op.
  list = await s.addToWishlist(sql, molly.id, MOVIE({ tmdb_id: 900, title: "Wish A" }), null);
  assert.equal(list.length, 2);
  // Already-watched films are refused.
  await assert.rejects(s.addToWishlist(sql, molly.id, MOVIE({ tmdb_id: 603 }), null), /already watched/);
  // Anyone can remove.
  list = await s.removeFromWishlist(sql, molly.id, list.find((w) => w.movie.title === "Wish B")!.id);
  assert.deepEqual(list.map((w) => w.movie.title), ["Wish A"]);
  // Watching Wish A drops it off the list.
  const current = await s.currentSelectorId(sql);
  const others = members.filter((m) => m.active && m.id !== current);
  let night = await s.proposeMovie(sql, current!, MOVIE({ tmdb_id: 900, title: "Wish A" }));
  for (const o of others) night = await s.decideApproval(sql, night.night.id, o.id, "approve", null);
  await s.startMovie(sql, night.night.id, current!);
  await s.finishMovie(sql, night.night.id, current!);
  for (const m of members.filter((m) => m.active)) await s.submitRating(sql, night.night.id, m.id, 7);
  assert.equal((await s.loadWishlist(sql)).length, 0);
});

test("coins: starting budget, weighted votes, refunds, and per-cycle allowance", async () => {
  const sql = await db();
  const members = await s.loadMembers(sql);
  const [calvin, molly, sam, jo] = ["Calvin", "Molly", "Sam", "Jo"].map((n) => members.find((m) => m.name === n)!);
  const active = members.filter((m) => m.active);
  // Fresh ledger for this test (earlier tests may already have paid a cycle).
  await sql`DELETE FROM coin_ledger`;
  await sql`DELETE FROM settings WHERE key IN ('cycle', 'budget')`;
  // Everyone got the same starting budget exactly once.
  await s.ensureBudgets(sql);
  await s.ensureBudgets(sql);
  let balances = await s.loadBalances(sql);
  for (const m of active) assert.equal(balances[m.id], 100);

  await s.setBudget(sql, { initial: 100, allowance: 30 });
  await assert.rejects(s.setBudget(sql, { initial: -1, allowance: 30 }), /Starting budget/);

  // Put Jo last-but-one so the rotation wraps to the first picker after this night.
  const order = (await s.loadMembers(sql)).filter((m) => m.active).sort((a, b) => a.rotation_position - b.rotation_position);
  const last = order[order.length - 1];
  await s.setRotation(sql, last.id);
  const cycleBefore = (await s.getCycle(sql)).number;

  let night = await s.proposeMovies(sql, last.id, [MOVIE({ tmdb_id: 301, title: "P" }), MOVIE({ tmdb_id: 302, title: "Q" })]);
  const [p, q] = night.candidates;
  const others = active.filter((m) => m.id !== last.id);

  // Can't stake more than you have.
  await assert.rejects(s.castVote(sql, night.night.id, others[0].id, p.id, 101), /only have 100/);
  await assert.rejects(s.castVote(sql, night.night.id, others[0].id, p.id, -1), /whole number/);
  // Stake, then re-stake: the first stake is refunded.
  await s.castVote(sql, night.night.id, others[0].id, p.id, 40);
  assert.equal((await s.loadBalances(sql))[others[0].id], 60);
  await s.castVote(sql, night.night.id, others[0].id, q.id, 10);
  assert.equal((await s.loadBalances(sql))[others[0].id], 90);
  // Can spend down to zero.
  await s.castVote(sql, night.night.id, others[1].id, p.id, 100);
  assert.equal((await s.loadBalances(sql))[others[1].id], 0);
  await s.castVote(sql, night.night.id, others[2].id, q.id, 0);
  night = await s.castVote(sql, night.night.id, last.id, q.id, 5);
  // p has 100 coins, q has 10 + 1 (coinless) + 5 = 16 → p wins.
  assert.equal(night.night.status, "approved");
  assert.equal(night.movie.title, "P");
  assert.equal(night.votes.find((v) => v.member_id === others[1].id)?.amount, 100);

  // Withdrawing an approved night refunds every stake.
  await s.withdrawProposal(sql, night.night.id, last.id);
  balances = await s.loadBalances(sql);
  assert.equal(balances[others[1].id], 100);
  assert.equal(balances[others[0].id], 100);
  assert.equal(balances[last.id], 100);

  // Completing a night whose next picker is first in the order starts a new cycle → allowance.
  night = await s.proposeMovie(sql, last.id, MOVIE({ tmdb_id: 303, title: "R" }));
  for (const o of others) night = await s.decideApproval(sql, night.night.id, o.id, "approve", null);
  await s.startMovie(sql, night.night.id, last.id);
  await s.finishMovie(sql, night.night.id, last.id);
  for (const m of active) await s.submitRating(sql, night.night.id, m.id, 8);
  assert.equal(await s.currentSelectorId(sql), order[0].id);
  assert.equal((await s.getCycle(sql)).number, cycleBefore + 1);
  balances = await s.loadBalances(sql);
  for (const m of active) assert.equal(balances[m.id], 130);
  // A manual new cycle pays again; a repeat of the same cycle number can't (unique index).
  await s.startNewCycle(sql);
  assert.equal((await s.loadBalances(sql))[calvin.id], 160);
  await assert.rejects(
    sql`INSERT INTO coin_ledger (member_id, amount, reason, cycle) VALUES (${calvin.id}, 30, 'allowance', ${(await s.getCycle(sql)).number})`,
  );
  await s.adjustCoins(sql, molly.id, -10);
  assert.equal((await s.loadBalances(sql))[molly.id], 150);
  void sam;
  void jo;
});

test("to-dos: backfill one-off, unrated films, and live actions", async () => {
  const sql = await db();
  const members = await s.loadMembers(sql);
  const calvin = members.find((m) => m.name === "Calvin")!;
  const molly = members.find((m) => m.name === "Molly")!;
  // Backfill a film Molly never rated.
  await s.backfillNight(sql, calvin.id, MOVIE({ tmdb_id: 404, title: "Unrated One" }), calvin.id, new Date("2024-01-01T20:00:00Z"), [{ member_id: calvin.id, score: 7 }]);
  let home = await s.loadHomeState(sql, molly.id);
  assert.ok(home.todos.some((t) => t.kind === "backfill" && t.dismissible));
  const missing = home.todos.filter((t) => t.kind === "rate_missing");
  assert.ok(missing.some((t) => t.title === "Rate Unrated One"));
  assert.equal(typeof home.balances[molly.id], "number");
  assert.equal(typeof home.budget.allowance, "number");

  // Ticking the one-off removes it; un-ticking brings it back.
  await s.completeTask(sql, molly.id, s.BACKFILL_TASK);
  home = await s.loadHomeState(sql, molly.id);
  assert.ok(!home.todos.some((t) => t.kind === "backfill"));
  await assert.rejects(s.completeTask(sql, molly.id, "nope"), /Unknown task/);
  await s.reopenTask(sql, molly.id, s.BACKFILL_TASK);
  assert.ok((await s.loadHomeState(sql, molly.id)).todos.some((t) => t.kind === "backfill"));

  // Rating it clears the rate_missing item.
  const night = (await s.loadHistory(sql)).find((h) => h.movie.title === "Unrated One")!;
  await s.submitRating(sql, night.night.id, molly.id, 6);
  home = await s.loadHomeState(sql, molly.id);
  assert.ok(!home.todos.some((t) => t.title === "Rate Unrated One"));

  // Live: a shortlist vote shows as a to-do for those who haven't voted.
  const current = (await s.currentSelectorId(sql))!;
  const proposal = await s.proposeMovies(sql, current, [MOVIE({ tmdb_id: 405, title: "V1" }), MOVIE({ tmdb_id: 406, title: "V2" })]);
  const other = members.find((m) => m.active && m.id !== current)!;
  home = await s.loadHomeState(sql, other.id);
  assert.ok(home.todos.some((t) => t.kind === "vote"));
  await s.castVote(sql, proposal.night.id, other.id, proposal.candidates[0].id, 0);
  home = await s.loadHomeState(sql, other.id);
  assert.ok(!home.todos.some((t) => t.kind === "vote"));
  await s.withdrawProposal(sql, proposal.night.id, current);
});

test("a finished listing can be corrected or removed", async () => {
  const sql = await db();
  const members = await s.loadMembers(sql);
  const calvin = members.find((m) => m.name === "Calvin")!;
  const molly = members.find((m) => m.name === "Molly")!;
  const sam = members.find((m) => m.name === "Sam")!;
  const rotationBefore = await s.currentSelectorId(sql);

  // A backfill with the wrong date and the wrong picker.
  let night = await s.backfillNight(sql, calvin.id, MOVIE({ tmdb_id: 555, title: "Mistyped" }), calvin.id, new Date("2025-11-02T20:00:00Z"), [
    { member_id: calvin.id, score: 7 },
  ]);
  assert.equal(new Date(night.night.completed_at!).getUTCFullYear(), 2025);

  night = await s.updateNight(sql, molly.id, night.night.id, { selectorId: sam.id, watchedAt: new Date("2024-02-09T20:00:00Z") });
  assert.equal(night.night.selector_id, sam.id);
  assert.equal(night.selector.name, "Sam");
  assert.equal(new Date(night.night.completed_at!).getUTCFullYear(), 2024);
  // A backfilled night keeps every stamp in step, so history sorts correctly.
  assert.equal(night.night.proposed_at, night.night.completed_at);
  assert.equal(night.night.watched_at, night.night.completed_at);
  // Ratings survive the edit and the picker stats follow the new selector.
  assert.equal(night.ratings.length, 1);
  assert.ok(s.loadDataset(sql));
  const picked = (await s.loadHistory(sql)).find((h) => h.movie.title === "Mistyped")!;
  assert.equal(picked.selector_id, sam.id);
  // Editing never touches whose turn it is.
  assert.equal(await s.currentSelectorId(sql), rotationBefore);
  await assert.rejects(
    s.updateNight(sql, molly.id, night.night.id, { selectorId: "00000000-0000-4000-8000-000000000000" }),
    /Unknown member/,
  );

  // A live night can't be edited this way.
  const current = (await s.currentSelectorId(sql))!;
  const live = await s.proposeMovie(sql, current, MOVIE({ tmdb_id: 556, title: "Live" }));
  await assert.rejects(s.updateNight(sql, molly.id, live.night.id, { watchedAt: new Date() }), /finished/);
  await assert.rejects(s.deleteNight(sql, molly.id, live.night.id), /finished/);
  await s.withdrawProposal(sql, live.night.id, current);

  // Removing a listing takes its ratings with it and leaves balances alone.
  const balancesBefore = await s.loadBalances(sql);
  await s.deleteNight(sql, molly.id, night.night.id);
  assert.ok(!(await s.loadHistory(sql)).some((h) => h.movie.title === "Mistyped"));
  assert.deepEqual(await s.loadBalances(sql), balancesBefore);
  assert.equal((await sql`SELECT count(*)::int AS n FROM ratings WHERE night_id = ${night.night.id}`)[0].n, 0);
  assert.equal(await s.currentSelectorId(sql), rotationBefore);
});

test("first impressions are taken during the movie, locked, and hidden until the reveal", async () => {
  const sql = await db();
  const members = await s.loadMembers(sql);
  const active = members.filter((m) => m.active);
  const current = (await s.currentSelectorId(sql))!;
  const others = active.filter((m) => m.id !== current);

  let night = await s.proposeMovie(sql, current, MOVIE({ tmdb_id: 700, title: "Slow Burn" }));
  // Not before the movie starts.
  await assert.rejects(s.submitFirstImpression(sql, night.night.id, current, 7), /hasn't started yet/);
  for (const o of others) night = await s.decideApproval(sql, night.night.id, o.id, "approve", null);
  await assert.rejects(s.submitFirstImpression(sql, night.night.id, current, 7), /hasn't started yet/);

  night = await s.startMovie(sql, night.night.id, current);
  night = await s.submitFirstImpression(sql, night.night.id, current, 4);
  // Hidden from everyone, including the person who gave it, except their own.
  assert.deepEqual(night.first_impressions, []);
  assert.deepEqual(night.impressed_member_ids, [current]);
  assert.equal(night.my_first_impression, 4);
  assert.equal((await s.loadNightDetail(sql, night.night.id, others[0].id)).my_first_impression, null);
  // One shot each, and the half-point rule is enforced by the database itself.
  await assert.rejects(s.submitFirstImpression(sql, night.night.id, current, 9), /already given/);
  await assert.rejects(sql`INSERT INTO first_impressions (night_id, member_id, score) VALUES (${night.night.id}, ${others[0].id}, 7.25)`);
  for (const [i, o] of others.entries()) await s.submitFirstImpression(sql, night.night.id, o.id, 3 + i);

  // It shows up as a to-do only while it is still open.
  const fresh = await s.loadMembers(sql);
  void fresh;
  await s.finishMovie(sql, night.night.id, current);
  await assert.rejects(s.submitFirstImpression(sql, night.night.id, current, 6), /Too late/);

  // The film wins everyone over: finals are far above the ten-minute verdicts.
  for (const m of active) night = await s.submitRating(sql, night.night.id, m.id, 8);
  assert.equal(night.night.status, "complete");
  assert.equal(night.first_impressions.length, active.length);

  const data = await s.loadDataset(sql);
  const stats = firstImpressionStats(data);
  assert.equal(stats.pairs, active.length);
  assert.ok(stats.mean_drift !== null && stats.mean_drift > 0, "a film that grew on the group should drift upward");
  assert.equal(stats.biggest_riser?.title, "Slow Burn");
  assert.ok(stats.per_member.find((p) => p.member_id === current)!.mean_abs_change! > 0);
  const awards = (await s.loadNightDetail(sql, night.night.id, current)).awards;
  assert.ok(awards.some((a) => a.key === "crystal_ball"));
});

test("a snack can be reattributed, renamed, or removed by anyone", async () => {
  const sql = await db();
  const members = await s.loadMembers(sql);
  const calvin = members.find((m) => m.name === "Calvin")!;
  const molly = members.find((m) => m.name === "Molly")!;
  const sam = members.find((m) => m.name === "Sam")!;
  const night = await s.backfillNight(sql, calvin.id, MOVIE({ tmdb_id: 808, title: "Snack Night" }), calvin.id, new Date("2024-06-01T20:00:00Z"), []);

  // Sam types it in, but Molly actually brought it.
  const item = await s.addSnack(sql, night.night.id, sam.id, "Margarita", "snack", null);
  await s.rateSnack(sql, item.id, calvin.id, 5);
  await s.rateSnack(sql, item.id, molly.id, 4);

  // Anyone can fix it — here Calvin, who neither typed it nor brought it.
  const fixed = await s.updateSnack(sql, item.id, calvin.id, { broughtBy: molly.id, kind: "drink", note: "extra salt" });
  assert.equal(fixed.member_id, molly.id);
  assert.equal(fixed.kind, "drink");
  assert.equal(fixed.note, "extra salt");
  assert.equal(fixed.name, "Margarita", "an unspecified field is left alone");

  // Ratings belong to the item, so they survive and the credit follows.
  const detail = await s.loadNightDetail(sql, night.night.id, calvin.id);
  assert.equal(detail.snack_ratings.length, 2);
  const stats = snackStats(await s.loadDataset(sql));
  assert.equal(stats.best_drink?.name, "Margarita");
  assert.equal(stats.best_drink_provider?.member_id, molly.id, "the drink champion is now Molly, not Sam");

  await assert.rejects(s.updateSnack(sql, item.id, calvin.id, { broughtBy: "00000000-0000-4000-8000-000000000000" }), /Unknown member/);
  await assert.rejects(s.updateSnack(sql, "00000000-0000-4000-8000-000000000000", calvin.id, { name: "x" }), /No such snack/);

  // Removal is open to anyone too, and takes its ratings with it.
  await s.deleteSnack(sql, item.id, sam.id);
  assert.equal((await s.loadNightDetail(sql, night.night.id, calvin.id)).snacks.length, 0);
  assert.equal((await sql`SELECT count(*)::int AS n FROM snack_ratings WHERE snack_item_id = ${item.id}`)[0].n, 0);
  await assert.rejects(s.deleteSnack(sql, item.id, sam.id), /No such snack/);
});
