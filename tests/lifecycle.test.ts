import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { db } from "../lib/db";
import * as s from "../lib/server";
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
