import assert from "node:assert/strict";
import { test } from "node:test";
import { fmtRuntime, runtimeBucket, fmtScore, decadeOf } from "../lib/format";
import { nextAfter, rotationInfo, rotationOrder } from "../lib/rotation";
import { approvalOutcome, ratingsRevealed, summarizeRatings, voteOutcome } from "../lib/scoring";
import { filterCandidates, pickRandom } from "../lib/roulette";
import { normalizeMovie } from "../lib/tmdb";
import {
  awardTotals,
  criticStats,
  leaderboards,
  memberGenreStats,
  nightAwards,
  pearson,
  pickerStats,
  predictionStats,
  similarities,
  snackStats,
  tasteProfile,
  type Dataset,
  type NightData,
} from "../lib/stats";
import type { Member, Movie, MovieNight } from "../lib/types";

const member = (id: string, pos: number, active = true): Member => ({
  id,
  name: id.toUpperCase(),
  color: "#fff",
  emoji: "🎬",
  rotation_position: pos,
  active,
  created_at: "2026-01-01T00:00:00Z",
});
const MEMBERS = [member("a", 0), member("b", 1), member("c", 2), member("d", 3)];

let seq = 0;
function night(
  selector: string,
  scores: Record<string, number>,
  over: Partial<Movie> = {},
  extra: Partial<NightData> = {},
): NightData {
  const id = `n${++seq}`;
  const mn: MovieNight = {
    id,
    movie_id: `m${seq}`,
    selector_id: selector,
    status: "complete",
    proposed_at: "2026-01-01T00:00:00Z",
    approved_at: null,
    started_at: null,
    watched_at: null,
    completed_at: `2026-01-${String(seq).padStart(2, "0")}T00:00:00Z`,
    rotation_advanced: true,
  };
  return {
    night: mn,
    movie: {
      id: `m${seq}`,
      tmdb_id: seq,
      title: `Movie ${seq}`,
      year: 2000,
      release_date: null,
      runtime_min: 100,
      genres: [{ id: 1, name: "Drama" }],
      overview: "",
      poster_path: "/p.jpg",
      backdrop_path: null,
      director: null,
      tmdb_rating: null,
      tmdb_votes: null,
      created_at: "",
      ...over,
    },
    ratings: Object.entries(scores).map(([m, score], i) => ({ id: `${id}r${i}`, night_id: id, member_id: m, score, created_at: "" })),
    predictions: [],
    snacks: [],
    snack_ratings: [],
    ...extra,
  };
}

test("runtime formatting", () => {
  assert.equal(fmtRuntime(107), "1h 47m");
  assert.equal(fmtRuntime(120), "2h");
  assert.equal(fmtRuntime(45), "45m");
  assert.equal(fmtRuntime(null), "—");
  assert.equal(runtimeBucket(89), "lt90");
  assert.equal(runtimeBucket(90), "90-120");
  assert.equal(runtimeBucket(120), "90-120");
  assert.equal(runtimeBucket(121), "120-150");
  assert.equal(runtimeBucket(151), "150+");
  assert.equal(fmtScore(7.5), "7.5");
  assert.equal(fmtScore(8), "8");
  assert.equal(fmtScore(7.75), "7.8");
  assert.equal(decadeOf(1999), "1990s");
});

test("rotation progression wraps and skips inactive", () => {
  assert.deepEqual(rotationOrder(MEMBERS).map((m) => m.id), ["a", "b", "c", "d"]);
  assert.equal(nextAfter(MEMBERS, "a")?.id, "b");
  assert.equal(nextAfter(MEMBERS, "d")?.id, "a");
  assert.equal(nextAfter(MEMBERS, "zzz")?.id, "a");
  const withInactive = MEMBERS.map((m) => (m.id === "c" ? { ...m, active: false } : m));
  assert.equal(nextAfter(withInactive, "b")?.id, "d");
  const info = rotationInfo(MEMBERS, "c");
  assert.equal(info.current?.id, "c");
  assert.deepEqual(info.upcoming.map((m) => m.id), ["d", "a", "b"]);
  assert.equal(rotationInfo([], null).current, null);
});

test("approval outcome requires everyone but the selector", () => {
  const ids = ["a", "b", "c", "d"];
  assert.equal(approvalOutcome([], "a", ids), "pending");
  assert.equal(approvalOutcome([{ member_id: "b", decision: "approve" }, { member_id: "c", decision: "approve" }], "a", ids), "pending");
  assert.equal(
    approvalOutcome(
      [{ member_id: "b", decision: "approve" }, { member_id: "c", decision: "approve" }, { member_id: "d", decision: "approve" }],
      "a",
      ids,
    ),
    "approved",
  );
  assert.equal(approvalOutcome([{ member_id: "b", decision: "reject" }], "a", ids), "rejected");
  // Selector's own vote doesn't count toward the threshold.
  assert.equal(approvalOutcome([{ member_id: "a", decision: "approve" }, { member_id: "b", decision: "approve" }, { member_id: "c", decision: "approve" }], "a", ids), "pending");
});

test("ratings stay hidden until every active member has rated", () => {
  assert.equal(ratingsRevealed(["a", "b", "c"], ["a", "b", "c", "d"]), false);
  assert.equal(ratingsRevealed(["a", "b", "c", "d"], ["a", "b", "c", "d"]), true);
  assert.equal(ratingsRevealed(["a", "b", "c"], ["a", "b", "c"]), true);
  assert.equal(ratingsRevealed([], []), false);
});

test("rating aggregation", () => {
  const s = summarizeRatings(
    [
      { member_id: "a", score: 9 },
      { member_id: "b", score: 6.5 },
      { member_id: "c", score: 8 },
      { member_id: "d", score: 7.5 },
    ],
    "a",
  );
  assert.equal(s.count, 4);
  assert.equal(s.average, 7.8);
  assert.equal(s.highest, 9);
  assert.equal(s.lowest, 6.5);
  assert.equal(s.spread, 2.5);
  assert.equal(s.selector_score, 9);
  assert.equal(s.average_excluding_selector, 7.3);
  assert.equal(s.selector_delta, 1.7);
  assert.equal(summarizeRatings([], "a").average, null);
});

test("picker score is the mean group rating of their picks", () => {
  const data: Dataset = {
    members: MEMBERS,
    nights: [
      night("a", { a: 8, b: 8, c: 8, d: 8 }, { runtime_min: 90 }),
      night("a", { a: 6, b: 6, c: 6, d: 6 }, { runtime_min: 150, genres: [{ id: 2, name: "Horror" }] }),
      night("b", { a: 9, b: 9, c: 9, d: 9 }),
    ],
  };
  const p = pickerStats(data);
  const a = p.find((x) => x.member_id === "a")!;
  assert.equal(a.movies_selected, 2);
  assert.equal(a.picker_score, 7);
  assert.equal(a.highest_pick?.average, 8);
  assert.equal(a.lowest_pick?.average, 6);
  assert.equal(a.average_runtime, 120);
  assert.deepEqual(a.genre_distribution, [{ genre: "Drama", count: 1 }, { genre: "Horror", count: 1 }]);
  const b = p.find((x) => x.member_id === "b")!;
  assert.equal(b.picker_score, 9);
  assert.equal(b.winners, 1);
  assert.equal(p.find((x) => x.member_id === "c")!.picker_score, null);
  const lb = leaderboards(data);
  assert.equal(lb.best_picker[0].member_id, "b");
  assert.equal(lb.runtime_criminal?.member_id, "a");
});

test("critics, contrarian and similarity", () => {
  const data: Dataset = {
    members: MEMBERS,
    nights: [
      night("a", { a: 9, b: 5, c: 7, d: 7 }),
      night("b", { a: 8, b: 4, c: 6, d: 6 }),
      night("c", { a: 6, b: 3, c: 5, d: 5.5 }),
    ],
  };
  const critics = criticStats(data);
  assert.equal(critics.find((c) => c.member_id === "b")!.average_given, 4);
  const lb = leaderboards(data);
  assert.equal(lb.toughest_critic?.member_id, "b");
  assert.equal(lb.easiest_critic?.member_id, "a");
  assert.equal(lb.contrarian?.member_id, "b");
  const sims = similarities(data);
  const cd = sims.find((s) => s.a === "c" && s.b === "d")!;
  assert.equal(cd.shared, 3);
  assert.equal(cd.mean_abs_diff, 0.2);
  assert.equal(lb.movie_twins?.a, "c");
  assert.equal(lb.movie_twins?.b, "d");
  // Too few shared films → no similarity claim.
  const sparse = similarities({ members: MEMBERS, nights: data.nights.slice(0, 2) });
  assert.equal(sparse[0].correlation, null);
  assert.equal(pearson([1, 2, 3], [2, 4, 6]), 1);
  assert.equal(pearson([1, 2, 3], [3, 2, 1]), -1);
  assert.equal(pearson([1, 1, 1], [1, 2, 3]), null);
});

test("genre stats per member and outliers", () => {
  const data: Dataset = {
    members: MEMBERS,
    nights: [
      night("a", { a: 9, b: 5, c: 5, d: 5 }, { genres: [{ id: 2, name: "Horror" }] }),
      night("b", { a: 9, b: 5, c: 5, d: 5 }, { genres: [{ id: 2, name: "Horror" }] }),
      night("c", { a: 6, b: 8, c: 8, d: 8 }, { genres: [{ id: 1, name: "Drama" }] }),
    ],
  };
  const g = memberGenreStats(data).find((m) => m.member_id === "a")!;
  assert.equal(g.favorite?.genre, "Horror");
  assert.equal(g.least_favorite?.genre, "Drama");
  assert.equal(g.outliers[0].genre, "Horror");
  assert.equal(g.outliers[0].delta, 3);
});

test("prediction scoring", () => {
  const n1 = night("a", { a: 8, b: 6 }, {}, {
    predictions: [
      { id: "p1", night_id: "x", member_id: "a", own_score: 8.5, group_score: 7, created_at: "", updated_at: "" },
      { id: "p2", night_id: "x", member_id: "b", own_score: 9, group_score: null, created_at: "", updated_at: "" },
    ],
  });
  const n2 = night("b", { a: 4, b: 4 }, {}, {
    predictions: [{ id: "p3", night_id: "y", member_id: "a", own_score: 4.5, group_score: 4, created_at: "", updated_at: "" }],
  });
  const stats = predictionStats({ members: MEMBERS, nights: [n1, n2] });
  const a = stats.per_member.find((p) => p.member_id === "a")!;
  assert.equal(a.predictions, 2);
  assert.equal(a.mean_own_error, 0.5);
  assert.equal(a.mean_group_error, 0);
  assert.equal(a.streak, 2);
  assert.equal(stats.most_accurate?.member_id, "a");
  assert.equal(stats.biggest_surprise?.member_id, "b");
  assert.equal(stats.biggest_surprise?.predicted, 9);
  assert.equal(stats.most_disappointed?.title, n1.movie.title);
  assert.equal(stats.most_exceeded, null);
});

test("awards derive only from recorded data", () => {
  const solo: Dataset = { members: MEMBERS, nights: [night("a", { a: 8, b: 8, c: 8, d: 8 })] };
  let awards = nightAwards(solo.nights[0], solo);
  // One night: no best/worst pick, but it is a crowd pleaser.
  assert.deepEqual(awards.map((a) => a.key), ["crowd_pleaser"]);

  const n1 = night("a", { a: 8, b: 8, c: 8, d: 8 }, { runtime_min: 160 });
  const n2 = night(
    "b",
    { a: 3, b: 9, c: 5, d: 6 },
    {},
    {
      snacks: [
        { id: "s1", night_id: "n", member_id: "c", name: "Popcorn", kind: "snack", note: null, created_at: "" },
        { id: "s2", night_id: "n", member_id: "d", name: "Margarita", kind: "drink", note: null, created_at: "" },
        { id: "s3", night_id: "n", member_id: "a", name: "Cookies", kind: "snack", note: null, created_at: "" },
      ],
      snack_ratings: [
        { id: "r1", snack_item_id: "s1", member_id: "a", score: 5, created_at: "" },
        { id: "r2", snack_item_id: "s3", member_id: "a", score: 2, created_at: "" },
        { id: "r3", snack_item_id: "s2", member_id: "a", score: 4, created_at: "" },
      ],
      predictions: [
        { id: "p1", night_id: "n", member_id: "a", own_score: 3.5, group_score: null, created_at: "", updated_at: "" },
        { id: "p2", night_id: "n", member_id: "b", own_score: 6, group_score: null, created_at: "", updated_at: "" },
      ],
    },
  );
  const data: Dataset = { members: MEMBERS, nights: [n1, n2] };
  awards = nightAwards(n1, data);
  assert.deepEqual(awards.map((a) => a.key).sort(), ["best_pick", "crowd_pleaser", "longest_commitment"]);
  assert.equal(awards.find((a) => a.key === "best_pick")?.member_id, "a");
  awards = nightAwards(n2, data);
  assert.deepEqual(awards.map((a) => a.key).sort(), ["best_drinks", "best_snacks", "most_accurate_predictor", "most_divisive", "worst_pick"]);
  assert.equal(awards.find((a) => a.key === "best_snacks")?.member_id, "c");
  assert.equal(awards.find((a) => a.key === "best_drinks")?.member_id, "d");
  assert.equal(awards.find((a) => a.key === "most_accurate_predictor")?.member_id, "a");
  const totals = awardTotals(data);
  assert.equal(totals.find((t) => t.member_id === "a" && t.key === "best_pick")?.count, 1);
  assert.equal(snackStats(data).best_snack_provider?.member_id, "c");
  assert.equal(snackStats(data).most_frequent?.count, 1);
});

test("taste profile", () => {
  const data: Dataset = {
    members: MEMBERS,
    nights: [
      night("a", { a: 9, b: 9, c: 8, d: 9 }, { year: 1985, genres: [{ id: 3, name: "Comedy" }], runtime_min: 90 }),
      night("b", { a: 4, b: 9, c: 5, d: 4 }, { year: 1988, genres: [{ id: 2, name: "Horror" }], runtime_min: 110 }),
      night("c", { a: 7, b: 7, c: 7, d: 7 }, { year: 2011, genres: [{ id: 2, name: "Horror" }], runtime_min: 100 }),
      night("d", { a: 8, b: 8, c: 8, d: 8 }, { year: 2015, genres: [{ id: 3, name: "Comedy" }], runtime_min: 100 }),
    ],
  };
  const t = tasteProfile(data);
  assert.equal(t.movies_watched, 4);
  assert.equal(t.favorite_genres[0].genre, "Comedy");
  assert.equal(t.highest_rated[0].average, 8.8);
  assert.equal(t.lowest_rated[0].average, 5.5);
  assert.equal(t.favorite_decades[0].decade, "2010s");
  assert.equal(t.average_runtime, 100);
  assert.equal(t.consensus_score, 1.5);
  assert.equal(t.most_divisive_genre?.genre, "Horror");
  assert.ok(t.most_similar);
  assert.ok(t.least_similar);
});

test("roulette excludes watched movies", () => {
  const mk = (id: number, poster: string | null = "/p.jpg") => ({ ...normalizeMovie({ id, title: `t${id}` }), poster_path: poster });
  const out = filterCandidates([mk(1), mk(2), mk(3), mk(4, null)], new Set([2]));
  assert.deepEqual(out.map((m) => m.tmdb_id), [1, 3]);
  assert.equal(pickRandom(out, () => 0.99)?.tmdb_id, 3);
  assert.equal(pickRandom([], () => 0), null);
});

test("tmdb normalisation", () => {
  const m = normalizeMovie(
    {
      id: 5,
      title: "X",
      release_date: "2001-05-04",
      runtime: 107,
      genres: [{ id: 1, name: "Drama" }],
      vote_average: 7.456,
      vote_count: 100,
      credits: { crew: [{ job: "Producer", name: "P" }, { job: "Director", name: "D" }] },
    },
    undefined,
  );
  assert.equal(m.year, 2001);
  assert.equal(m.director, "D");
  assert.equal(m.tmdb_rating, 7.5);
  const lookup = new Map([[28, "Action"]]);
  assert.deepEqual(normalizeMovie({ id: 6, title: "Y", genre_ids: [28, 99] }, lookup).genres, [{ id: 28, name: "Action" }]);
});

test("vote outcome: majority, picker breaks ties, waits for everyone", () => {
  const ids = ["a", "b", "c", "d"];
  const v = (m: string, movie: string) => ({ member_id: m, movie_id: movie });
  assert.equal(voteOutcome([v("a", "x"), v("b", "x"), v("c", "y")], ["x", "y"], "a", ids), null);
  assert.equal(voteOutcome([v("a", "x"), v("b", "x"), v("c", "y"), v("d", "y")], ["x", "y"], "d", ids), "y");
  assert.equal(voteOutcome([v("a", "x"), v("b", "y"), v("c", "y"), v("d", "z")], ["x", "y", "z"], "a", ids), "y");
  // Full three-way tie with picker on z → z.
  assert.equal(voteOutcome([v("a", "z"), v("b", "y"), v("c", "x")], ["x", "y", "z"], "a", ["a", "b", "c"]), "z");
});

test("vote outcome is weighted by coins, coinless votes still count as one", () => {
  const ids = ["a", "b", "c", "d"];
  const v = (m: string, movie: string, amount: number) => ({ member_id: m, movie_id: movie, amount });
  // Three cheap votes for x lose to one big stake on y.
  assert.equal(voteOutcome([v("a", "x", 1), v("b", "x", 1), v("c", "x", 1), v("d", "y", 10)], ["x", "y"], "a", ids), "y");
  // Coinless votes count as 1 each.
  assert.equal(voteOutcome([v("a", "x", 0), v("b", "x", 0), v("c", "y", 1), v("d", "z", 0)], ["x", "y", "z"], "c", ids), "x");
  // Equal stakes → picker's choice.
  assert.equal(voteOutcome([v("a", "x", 5), v("b", "y", 5), v("c", "x", 5), v("d", "y", 5)], ["x", "y"], "b", ids), "y");
});
