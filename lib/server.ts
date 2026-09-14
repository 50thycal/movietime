/**
 * Server-only data access. Every API route is a thin wrapper over one of
 * these, so the lifecycle rules live in one place and can be tested against
 * a real Postgres (PGlite in tests, Neon in production).
 */
import type { Sql } from "./db";
import { Conflict, NotFound, BadRequest } from "./http";
import { nextAfter, rotationInfo, rotationOrder } from "./rotation";
import { approvalOutcome, ratingsRevealed, voteOutcome } from "./scoring";
import { nightAwards, type Award, type Dataset, type NightData } from "./stats";
import type {
  Approval,
  HistoryEntry,
  HomeState,
  Member,
  Movie,
  MovieNight,
  NightDetail,
  Prediction,
  Rating,
  Review,
  SnackItem,
  Vote,
  SnackRating,
  TmdbSearchResult,
  WishlistEntry,
  Budget,
  CycleInfo,
  Todo,
} from "./types";
import { ACTIVE_STATUSES } from "./types";
import { mean, round1 } from "./scoring";

// ---------------------------------------------------------------- members & settings

export async function loadMembers(sql: Sql): Promise<Member[]> {
  return (await sql`SELECT * FROM members ORDER BY rotation_position, name`) as Member[];
}

export async function getSetting<T>(sql: Sql, key: string): Promise<T | null> {
  const rows = await sql`SELECT value FROM settings WHERE key = ${key}`;
  return rows.length ? (rows[0].value as T) : null;
}

export async function setSetting(sql: Sql, key: string, value: unknown) {
  await sql`INSERT INTO settings (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}::jsonb, now())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

export async function currentSelectorId(sql: Sql): Promise<string | null> {
  const v = await getSetting<{ member_id: string }>(sql, "rotation");
  return v?.member_id ?? null;
}

export async function requireMember(sql: Sql, memberId: string): Promise<Member> {
  const rows = (await sql`SELECT * FROM members WHERE id = ${memberId}`) as Member[];
  if (!rows.length) throw new NotFound("Unknown member");
  if (!rows[0].active) throw new Conflict("That member is inactive");
  return rows[0];
}

export const MEMBER_COLORS = ["#ff5c8a", "#ffb02e", "#3ddc97", "#5aa9ff", "#c084fc", "#f97316"];
const DEFAULT_EMOJIS = ["🍿", "🎬", "🎟️", "🥤", "🎥", "⭐"];

/** First-run setup: create the members and point the rotation at the first one. */
export async function setupMembers(sql: Sql, names: string[]): Promise<Member[]> {
  const cleaned = names.map((n) => n.trim()).filter(Boolean);
  if (cleaned.length < 2 || cleaned.length > 6) throw new BadRequest("Add between 2 and 6 people");
  if (new Set(cleaned.map((n) => n.toLowerCase())).size !== cleaned.length) throw new BadRequest("Names must be different");
  const existing = await loadMembers(sql);
  if (existing.length) throw new Conflict("MovieTime is already set up");
  const members: Member[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const rows = (await sql`INSERT INTO members (name, color, emoji, rotation_position)
      VALUES (${cleaned[i]}, ${MEMBER_COLORS[i % MEMBER_COLORS.length]}, ${DEFAULT_EMOJIS[i % DEFAULT_EMOJIS.length]}, ${i})
      RETURNING *`) as Member[];
    members.push(rows[0]);
  }
  await setSetting(sql, "rotation", { member_id: members[0].id });
  await setSetting(sql, "setup_complete", true);
  await ensureBudgets(sql, members);
  return members;
}

// ---------------------------------------------------------------- movies

export async function upsertMovie(sql: Sql, m: TmdbSearchResult): Promise<Movie> {
  const rows = (await sql`
    INSERT INTO movies (tmdb_id, title, year, release_date, runtime_min, genres, overview, poster_path, backdrop_path, director, tmdb_rating, tmdb_votes)
    VALUES (${m.tmdb_id}, ${m.title}, ${m.year}, ${m.release_date}, ${m.runtime_min}, ${JSON.stringify(m.genres)}::jsonb,
            ${m.overview}, ${m.poster_path}, ${m.backdrop_path}, ${m.director}, ${m.tmdb_rating}, ${m.tmdb_votes})
    ON CONFLICT (tmdb_id) DO UPDATE SET
      title = EXCLUDED.title, year = EXCLUDED.year, release_date = EXCLUDED.release_date,
      runtime_min = COALESCE(EXCLUDED.runtime_min, movies.runtime_min), genres = EXCLUDED.genres,
      overview = EXCLUDED.overview, poster_path = COALESCE(EXCLUDED.poster_path, movies.poster_path),
      backdrop_path = COALESCE(EXCLUDED.backdrop_path, movies.backdrop_path),
      director = COALESCE(EXCLUDED.director, movies.director),
      tmdb_rating = COALESCE(EXCLUDED.tmdb_rating, movies.tmdb_rating), tmdb_votes = COALESCE(EXCLUDED.tmdb_votes, movies.tmdb_votes)
    RETURNING *`) as Movie[];
  return rows[0];
}

/** TMDB ids of every film with a completed night, for roulette exclusion. */
export async function watchedTmdbIds(sql: Sql): Promise<Set<number>> {
  const rows = await sql`SELECT DISTINCT m.tmdb_id FROM movies m JOIN movie_nights n ON n.movie_id = m.id WHERE n.status = 'complete'`;
  return new Set(rows.map((r) => Number(r.tmdb_id)));
}

// ---------------------------------------------------------------- nights

export async function activeNight(sql: Sql): Promise<MovieNight | null> {
  const rows = (await sql`SELECT * FROM movie_nights WHERE status = ANY(${ACTIVE_STATUSES}) ORDER BY proposed_at DESC LIMIT 1`) as MovieNight[];
  return rows[0] ?? null;
}

export async function requireNight(sql: Sql, nightId: string): Promise<MovieNight> {
  const rows = (await sql`SELECT * FROM movie_nights WHERE id = ${nightId}`) as MovieNight[];
  if (!rows.length) throw new NotFound("No such movie night");
  return rows[0];
}

export async function loadNightDetail(sql: Sql, nightId: string, me: string | null): Promise<NightDetail> {
  const night = await requireNight(sql, nightId);
  const [movies, selectors, approvals, ratings, reviews, snacks, snackRatings, predictions, members, candidates, votes] = await Promise.all([
    sql`SELECT * FROM movies WHERE id = ${night.movie_id}`,
    sql`SELECT * FROM members WHERE id = ${night.selector_id}`,
    sql`SELECT * FROM movie_approvals WHERE night_id = ${nightId} ORDER BY created_at`,
    sql`SELECT * FROM ratings WHERE night_id = ${nightId} ORDER BY created_at`,
    sql`SELECT * FROM reviews WHERE night_id = ${nightId} ORDER BY created_at`,
    sql`SELECT * FROM snack_items WHERE night_id = ${nightId} ORDER BY created_at`,
    sql`SELECT sr.* FROM snack_ratings sr JOIN snack_items si ON si.id = sr.snack_item_id WHERE si.night_id = ${nightId}`,
    sql`SELECT * FROM predictions WHERE night_id = ${nightId} ORDER BY created_at`,
    loadMembers(sql),
    sql`SELECT m.* FROM night_candidates c JOIN movies m ON m.id = c.movie_id WHERE c.night_id = ${nightId} ORDER BY c.position`,
    sql`SELECT * FROM night_votes WHERE night_id = ${nightId} ORDER BY created_at`,
  ]);
  const allRatings = ratings as Rating[];
  const revealed = night.status === "complete" || ratingsRevealed(allRatings.map((r) => r.member_id), members.filter((m) => m.active).map((m) => m.id));
  const allPredictions = predictions as Prediction[];
  let awards: Award[] = [];
  if (night.status === "complete") {
    const data = await loadDataset(sql);
    const mine = data.nights.find((n) => n.night.id === nightId);
    if (mine) awards = nightAwards(mine, data);
  }
  return {
    awards,
    night,
    movie: movies[0] as Movie,
    candidates: candidates.length ? (candidates as Movie[]) : [movies[0] as Movie],
    votes: votes as Vote[],
    selector: selectors[0] as Member,
    approvals: approvals as Approval[],
    ratings: revealed ? allRatings : [],
    rated_member_ids: allRatings.map((r) => r.member_id),
    my_rating: me ? (allRatings.find((r) => r.member_id === me)?.score ?? null) : null,
    reviews: reviews as Review[],
    snacks: snacks as SnackItem[],
    snack_ratings: snackRatings as SnackRating[],
    predictions: revealed ? allPredictions : [],
    my_prediction: me ? (allPredictions.find((p) => p.member_id === me) ?? null) : null,
  };
}

export async function loadHomeState(sql: Sql, me: string | null): Promise<HomeState> {
  const members = await loadMembers(sql);
  const setupComplete = members.length > 0;
  if (setupComplete) await ensureBudgets(sql, members);
  const currentId = await currentSelectorId(sql);
  const [active, last, countRows, balances, budget, cycle] = await Promise.all([
    activeNight(sql),
    sql`SELECT * FROM movie_nights WHERE status = 'complete' ORDER BY completed_at DESC LIMIT 1`,
    sql`SELECT count(*)::int AS n FROM movie_nights WHERE status = 'complete'`,
    loadBalances(sql),
    getBudget(sql),
    getCycle(sql, members),
  ]);
  const current = active ? await loadNightDetail(sql, active.id, me) : null;
  return {
    now: new Date().toISOString(),
    setup_complete: setupComplete,
    members,
    balances,
    budget,
    cycle,
    todos: me ? await loadTodos(sql, me, current) : [],
    rotation: rotationInfo(members, currentId),
    current,
    last_complete: last.length ? await loadNightDetail(sql, (last[0] as MovieNight).id, me) : null,
    watched_count: Number(countRows[0]?.n ?? 0),
  };
}

// ---------------------------------------------------------------- lifecycle

import { MAX_CANDIDATES } from "./constants";
export { MAX_CANDIDATES };

/**
 * Propose one film (group approves/rejects) or a shortlist of up to
 * MAX_CANDIDATES (everyone votes, winner becomes the movie).
 */
export async function proposeMovies(sql: Sql, memberId: string, movies: TmdbSearchResult[]): Promise<NightDetail> {
  const member = await requireMember(sql, memberId);
  const current = await currentSelectorId(sql);
  if (current && current !== member.id) throw new Conflict("It isn't your turn to pick");
  if (await activeNight(sql)) throw new Conflict("There's already a movie in play");
  const unique = movies.filter((m, i) => movies.findIndex((x) => x.tmdb_id === m.tmdb_id) === i);
  if (unique.length < 1) throw new BadRequest("Pick at least one movie");
  if (unique.length > MAX_CANDIDATES) throw new BadRequest(`At most ${MAX_CANDIDATES} movies`);
  const rows_: Movie[] = [];
  for (const m of unique) rows_.push(await upsertMovie(sql, m));
  // The partial unique index is the real guard against two simultaneous proposals.
  const rows = (await sql`INSERT INTO movie_nights (movie_id, selector_id, status) VALUES (${rows_[0].id}, ${member.id}, 'proposed') RETURNING *`) as MovieNight[];
  for (let i = 0; i < rows_.length; i++) {
    await sql`INSERT INTO night_candidates (night_id, movie_id, position) VALUES (${rows[0].id}, ${rows_[i].id}, ${i})`;
  }
  return loadNightDetail(sql, rows[0].id, memberId);
}

export async function proposeMovie(sql: Sql, memberId: string, movie: TmdbSearchResult): Promise<NightDetail> {
  return proposeMovies(sql, memberId, [movie]);
}

/**
 * Vote for one of the shortlisted films, putting `amount` coins behind it.
 * Re-voting refunds the previous stake and charges the new one. When everyone
 * has voted, the winner is set.
 */
export async function castVote(sql: Sql, nightId: string, memberId: string, movieId: string, amount = 0): Promise<NightDetail> {
  const night = await requireNight(sql, nightId);
  await requireMember(sql, memberId);
  if (night.status !== "proposed") throw new Conflict("Voting is closed");
  if (!Number.isInteger(amount) || amount < 0) throw new BadRequest("Coins must be a whole number");
  const candidates = await sql`SELECT movie_id FROM night_candidates WHERE night_id = ${nightId} ORDER BY position`;
  if (candidates.length < 2) throw new Conflict("This proposal isn't a vote");
  if (!candidates.some((c) => c.movie_id === movieId)) throw new BadRequest("That movie isn't on the shortlist");
  await ensureBudgets(sql);
  const previous = (await sql`SELECT amount FROM night_votes WHERE night_id = ${nightId} AND member_id = ${memberId}`) as { amount: number }[];
  const prevAmount = previous[0]?.amount ?? 0;
  const balance = (await loadBalances(sql))[memberId] ?? 0;
  if (amount > balance + prevAmount) throw new Conflict(`You only have ${balance + prevAmount} coins`);
  if (prevAmount > 0) await sql`INSERT INTO coin_ledger (member_id, amount, reason, night_id) VALUES (${memberId}, ${prevAmount}, 'refund', ${nightId})`;
  if (amount > 0) await sql`INSERT INTO coin_ledger (member_id, amount, reason, night_id) VALUES (${memberId}, ${-amount}, 'vote', ${nightId})`;
  await sql`INSERT INTO night_votes (night_id, member_id, movie_id, amount) VALUES (${nightId}, ${memberId}, ${movieId}, ${amount})
            ON CONFLICT (night_id, member_id) DO UPDATE SET movie_id = EXCLUDED.movie_id, amount = EXCLUDED.amount, created_at = now()`;
  const members = await loadMembers(sql);
  const votes = (await sql`SELECT * FROM night_votes WHERE night_id = ${nightId}`) as Vote[];
  const winner = voteOutcome(
    votes,
    candidates.map((c) => c.movie_id as string),
    night.selector_id,
    members.filter((m) => m.active).map((m) => m.id),
  );
  if (winner) {
    await sql`UPDATE movie_nights SET movie_id = ${winner}, status = 'approved', approved_at = now() WHERE id = ${nightId} AND status = 'proposed'`;
  }
  return loadNightDetail(sql, nightId, memberId);
}

/**
 * Record a movie the group watched before MovieTime existed. Lands straight in
 * history, never touches the rotation, and any ratings given are optional —
 * members can add their own later from the movie page.
 */
export async function backfillNight(
  sql: Sql,
  memberId: string,
  movie: TmdbSearchResult,
  selectorId: string,
  watchedAt: Date,
  ratings: { member_id: string; score: number }[],
): Promise<NightDetail> {
  await requireMember(sql, memberId);
  const selector = await requireMember(sql, selectorId);
  const row = await upsertMovie(sql, movie);
  const ts = watchedAt.toISOString();
  const rows = (await sql`INSERT INTO movie_nights (movie_id, selector_id, status, proposed_at, approved_at, started_at, watched_at, completed_at, rotation_advanced)
    VALUES (${row.id}, ${selector.id}, 'complete', ${ts}, ${ts}, ${ts}, ${ts}, ${ts}, true) RETURNING *`) as MovieNight[];
  await sql`INSERT INTO night_candidates (night_id, movie_id, position) VALUES (${rows[0].id}, ${row.id}, 0)`;
  for (const r of ratings) {
    await sql`INSERT INTO ratings (night_id, member_id, score) VALUES (${rows[0].id}, ${r.member_id}, ${r.score}) ON CONFLICT (night_id, member_id) DO NOTHING`;
  }
  return loadNightDetail(sql, rows[0].id, memberId);
}

export async function withdrawProposal(sql: Sql, nightId: string, memberId: string): Promise<void> {
  const night = await requireNight(sql, nightId);
  if (night.selector_id !== memberId) throw new Conflict("Only the picker can withdraw a proposal");
  if (night.status !== "proposed" && night.status !== "approved") throw new Conflict("This movie can't be withdrawn now");
  await sql`UPDATE movie_nights SET status = 'rejected' WHERE id = ${nightId}`;
  await refundVotes(sql, nightId);
}

export async function decideApproval(
  sql: Sql,
  nightId: string,
  memberId: string,
  decision: "approve" | "reject",
  reason: string | null,
): Promise<NightDetail> {
  const night = await requireNight(sql, nightId);
  await requireMember(sql, memberId);
  if (night.status !== "proposed") throw new Conflict("This movie isn't waiting on approval");
  if (night.selector_id === memberId) throw new Conflict("You can't vote on your own pick");
  const candidateCount = await sql`SELECT count(*)::int AS n FROM night_candidates WHERE night_id = ${nightId}`;
  if (Number(candidateCount[0]?.n ?? 1) > 1) throw new Conflict("This is a vote — pick one of the shortlisted movies");
  await sql`INSERT INTO movie_approvals (night_id, member_id, decision, reason) VALUES (${nightId}, ${memberId}, ${decision}, ${reason})
            ON CONFLICT (night_id, member_id) DO UPDATE SET decision = EXCLUDED.decision, reason = EXCLUDED.reason, created_at = now()`;
  const members = await loadMembers(sql);
  const approvals = (await sql`SELECT * FROM movie_approvals WHERE night_id = ${nightId}`) as Approval[];
  const outcome = approvalOutcome(approvals, night.selector_id, members.filter((m) => m.active).map((m) => m.id));
  if (outcome === "approved") {
    await sql`UPDATE movie_nights SET status = 'approved', approved_at = now() WHERE id = ${nightId} AND status = 'proposed'`;
  } else if (outcome === "rejected") {
    await sql`UPDATE movie_nights SET status = 'rejected' WHERE id = ${nightId} AND status = 'proposed'`;
  }
  return loadNightDetail(sql, nightId, memberId);
}

export async function startMovie(sql: Sql, nightId: string, memberId: string): Promise<NightDetail> {
  await requireMember(sql, memberId);
  const rows = await sql`UPDATE movie_nights SET status = 'watching', started_at = now() WHERE id = ${nightId} AND status = 'approved' RETURNING id`;
  if (!rows.length) {
    const night = await requireNight(sql, nightId);
    if (night.status === "watching") return loadNightDetail(sql, nightId, memberId); // double tap
    throw new Conflict("This movie isn't ready to start");
  }
  return loadNightDetail(sql, nightId, memberId);
}

export async function finishMovie(sql: Sql, nightId: string, memberId: string): Promise<NightDetail> {
  await requireMember(sql, memberId);
  const rows = await sql`UPDATE movie_nights SET status = 'rating', watched_at = now() WHERE id = ${nightId} AND status IN ('watching','approved') RETURNING id`;
  if (!rows.length) {
    const night = await requireNight(sql, nightId);
    if (night.status === "rating") return loadNightDetail(sql, nightId, memberId);
    throw new Conflict("This movie isn't being watched");
  }
  return loadNightDetail(sql, nightId, memberId);
}

export async function submitRating(sql: Sql, nightId: string, memberId: string, score: number): Promise<NightDetail> {
  const night = await requireNight(sql, nightId);
  await requireMember(sql, memberId);
  if (night.status !== "rating" && night.status !== "complete") throw new Conflict("Ratings open once the movie is finished");
  // One rating per person per night — the UNIQUE constraint is the backstop.
  const existing = await sql`SELECT id FROM ratings WHERE night_id = ${nightId} AND member_id = ${memberId}`;
  if (existing.length) throw new Conflict("You've already rated this one");
  await sql`INSERT INTO ratings (night_id, member_id, score) VALUES (${nightId}, ${memberId}, ${score})`;
  // A late rating on an already-complete (backfilled) night just fills a gap.
  if (night.status === "rating") await maybeCompleteNight(sql, nightId);
  return loadNightDetail(sql, nightId, memberId);
}

/** When every active member has rated, seal the night and hand the turn on. */
export async function maybeCompleteNight(sql: Sql, nightId: string): Promise<boolean> {
  const members = await loadMembers(sql);
  const rated = (await sql`SELECT member_id FROM ratings WHERE night_id = ${nightId}`).map((r) => r.member_id as string);
  if (!ratingsRevealed(rated, members.filter((m) => m.active).map((m) => m.id))) return false;
  return completeNight(sql, nightId, members);
}

/**
 * Completing is idempotent: the guarded UPDATE only succeeds once, and only
 * that one caller advances the rotation. Two phones sending the final rating
 * at the same instant can't move the turn twice.
 */
export async function completeNight(sql: Sql, nightId: string, members?: Member[]): Promise<boolean> {
  const rows = (await sql`UPDATE movie_nights SET status = 'complete', completed_at = now(), rotation_advanced = true
                          WHERE id = ${nightId} AND status = 'rating' AND rotation_advanced = false RETURNING *`) as MovieNight[];
  if (!rows.length) return false;
  const all = members ?? (await loadMembers(sql));
  const next = nextAfter(all, rows[0].selector_id);
  if (next) await setSetting(sql, "rotation", { member_id: next.id });
  await sql`DELETE FROM wishlist WHERE movie_id = ${rows[0].movie_id}`;
  // The turn coming back round to the first picker starts a new cycle, and a
  // new cycle pays everyone their allowance.
  const order = rotationOrder(all);
  if (next && order.length > 1 && next.id === order[0].id) await startNewCycle(sql, all);
  return true;
}

// ---------------------------------------------------------------- coins

export const DEFAULT_BUDGET: Budget = { initial: 100, allowance: 50 };

export async function getBudget(sql: Sql): Promise<Budget> {
  const v = await getSetting<Partial<Budget>>(sql, "budget");
  return { initial: v?.initial ?? DEFAULT_BUDGET.initial, allowance: v?.allowance ?? DEFAULT_BUDGET.allowance };
}

export async function setBudget(sql: Sql, budget: Budget) {
  if (!Number.isInteger(budget.initial) || budget.initial < 0 || budget.initial > 100000) throw new BadRequest("Starting budget must be 0–100000");
  if (!Number.isInteger(budget.allowance) || budget.allowance < 0 || budget.allowance > 100000) throw new BadRequest("Allowance must be 0–100000");
  await setSetting(sql, "budget", budget);
}

export async function getCycle(sql: Sql, members?: Member[]): Promise<CycleInfo> {
  const v = await getSetting<{ number: number }>(sql, "cycle");
  const order = rotationOrder(members ?? (await loadMembers(sql)));
  return { number: v?.number ?? 1, first_member_id: order[0]?.id ?? null };
}

/** Every member gets the starting budget exactly once (the partial unique index makes this idempotent). */
export async function ensureBudgets(sql: Sql, members?: Member[]) {
  const all = members ?? (await loadMembers(sql));
  const budget = await getBudget(sql);
  for (const m of all) {
    await sql`INSERT INTO coin_ledger (member_id, amount, reason) VALUES (${m.id}, ${budget.initial}, 'initial')
              ON CONFLICT (member_id) WHERE reason = 'initial' DO NOTHING`;
  }
}

export async function loadBalances(sql: Sql): Promise<Record<string, number>> {
  const rows = await sql`SELECT member_id, coalesce(sum(amount), 0)::int AS balance FROM coin_ledger GROUP BY member_id`;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.member_id as string] = Number(r.balance);
  return out;
}

/** Bump the cycle counter and pay every active member their allowance (once per cycle). */
export async function startNewCycle(sql: Sql, members?: Member[]): Promise<CycleInfo> {
  const all = members ?? (await loadMembers(sql));
  const current = await getSetting<{ number: number }>(sql, "cycle");
  const number = (current?.number ?? 1) + 1;
  await setSetting(sql, "cycle", { number });
  const budget = await getBudget(sql);
  if (budget.allowance > 0) {
    for (const m of all.filter((x) => x.active)) {
      await sql`INSERT INTO coin_ledger (member_id, amount, reason, cycle) VALUES (${m.id}, ${budget.allowance}, 'allowance', ${number})
                ON CONFLICT (member_id, cycle) WHERE reason = 'allowance' DO NOTHING`;
    }
  }
  return getCycle(sql, all);
}

/** Settings: hand-correct someone's balance. */
export async function adjustCoins(sql: Sql, memberId: string, delta: number) {
  await requireMember(sql, memberId);
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000) throw new BadRequest("Amount must be a non-zero whole number");
  await sql`INSERT INTO coin_ledger (member_id, amount, reason) VALUES (${memberId}, ${delta}, 'adjust')`;
}

async function refundVotes(sql: Sql, nightId: string) {
  const votes = (await sql`SELECT member_id, amount FROM night_votes WHERE night_id = ${nightId} AND amount > 0`) as { member_id: string; amount: number }[];
  for (const v of votes) {
    await sql`INSERT INTO coin_ledger (member_id, amount, reason, night_id) VALUES (${v.member_id}, ${v.amount}, 'refund', ${nightId})`;
  }
  await sql`UPDATE night_votes SET amount = 0 WHERE night_id = ${nightId}`;
}

// ---------------------------------------------------------------- to-dos

export const BACKFILL_TASK = "backfill_old_picks";

/** What this member still owes the group, derived from live data plus ticked one-offs. */
export async function loadTodos(sql: Sql, memberId: string, current: NightDetail | null): Promise<Todo[]> {
  const todos: Todo[] = [];
  const done = new Set((await sql`SELECT task_key FROM member_tasks WHERE member_id = ${memberId}`).map((r) => r.task_key as string));

  if (current) {
    const n = current.night;
    const isSelector = n.selector_id === memberId;
    if (n.status === "proposed" && current.candidates.length > 1 && !current.votes.some((v) => v.member_id === memberId)) {
      todos.push({ key: `vote:${n.id}`, kind: "vote", title: `Vote on ${current.selector.name}'s shortlist`, href: "/", night_id: n.id });
    } else if (n.status === "proposed" && current.candidates.length <= 1 && !isSelector && !current.approvals.some((a) => a.member_id === memberId)) {
      todos.push({ key: `approve:${n.id}`, kind: "approve", title: `Approve or reject ${current.movie.title}`, href: "/", night_id: n.id });
    } else if (n.status === "rating" && !current.rated_member_ids.includes(memberId)) {
      todos.push({ key: `rate:${n.id}`, kind: "rate_now", title: `Rate ${current.movie.title}`, href: "/", night_id: n.id });
    }
  }

  if (!done.has(BACKFILL_TASK)) {
    todos.push({
      key: BACKFILL_TASK,
      kind: "backfill",
      title: "Add the movies you picked before MovieTime",
      detail: "So your picker score and history are complete.",
      href: `/history?backfill=1`,
      dismissible: true,
    });
  }

  const unrated = (await sql`
    SELECT n.id, m.title FROM movie_nights n JOIN movies m ON m.id = n.movie_id
    WHERE n.status = 'complete' AND NOT EXISTS (SELECT 1 FROM ratings r WHERE r.night_id = n.id AND r.member_id = ${memberId})
    ORDER BY n.completed_at DESC`) as { id: string; title: string }[];
  for (const u of unrated) {
    todos.push({ key: `rate_missing:${u.id}`, kind: "rate_missing", title: `Rate ${u.title}`, detail: "You never scored this one.", href: `/movie/${u.id}`, night_id: u.id });
  }
  return todos;
}

export async function completeTask(sql: Sql, memberId: string, key: string) {
  await requireMember(sql, memberId);
  if (key !== BACKFILL_TASK) throw new BadRequest("Unknown task");
  await sql`INSERT INTO member_tasks (member_id, task_key) VALUES (${memberId}, ${key}) ON CONFLICT DO NOTHING`;
}

export async function reopenTask(sql: Sql, memberId: string, key: string) {
  await sql`DELETE FROM member_tasks WHERE member_id = ${memberId} AND task_key = ${key}`;
}

// ---------------------------------------------------------------- wishlist

/** Films the group wants to get to, minus anything already watched. */
export async function loadWishlist(sql: Sql): Promise<WishlistEntry[]> {
  const rows = await sql`
    SELECT w.id, w.added_by, w.note, w.created_at, row_to_json(m.*) AS movie
    FROM wishlist w JOIN movies m ON m.id = w.movie_id
    WHERE NOT EXISTS (SELECT 1 FROM movie_nights n WHERE n.movie_id = w.movie_id AND n.status = 'complete')
    ORDER BY w.created_at DESC`;
  return rows.map((r) => ({ id: r.id, added_by: r.added_by, note: r.note, created_at: r.created_at, movie: r.movie as Movie }));
}

export async function addToWishlist(sql: Sql, memberId: string, movie: TmdbSearchResult, note: string | null): Promise<WishlistEntry[]> {
  await requireMember(sql, memberId);
  const row = await upsertMovie(sql, movie);
  const watched = await sql`SELECT 1 FROM movie_nights WHERE movie_id = ${row.id} AND status = 'complete' LIMIT 1`;
  if (watched.length) throw new Conflict("You've already watched that one");
  await sql`INSERT INTO wishlist (movie_id, added_by, note) VALUES (${row.id}, ${memberId}, ${note}) ON CONFLICT (movie_id) DO NOTHING`;
  return loadWishlist(sql);
}

/** Anyone in the group can take a film off the shared list. */
export async function removeFromWishlist(sql: Sql, memberId: string, id: string): Promise<WishlistEntry[]> {
  await requireMember(sql, memberId);
  await sql`DELETE FROM wishlist WHERE id = ${id}`;
  return loadWishlist(sql);
}

/** Settings → skip / fix the rotation by hand. */
export async function setRotation(sql: Sql, memberId: string) {
  await requireMember(sql, memberId);
  await setSetting(sql, "rotation", { member_id: memberId });
}

// ---------------------------------------------------------------- reviews, snacks, predictions

export async function addReview(sql: Sql, nightId: string, memberId: string, text: string): Promise<Review> {
  await requireNight(sql, nightId);
  await requireMember(sql, memberId);
  const rows = (await sql`INSERT INTO reviews (night_id, member_id, text) VALUES (${nightId}, ${memberId}, ${text}) RETURNING *`) as Review[];
  return rows[0];
}

export async function editReview(sql: Sql, reviewId: string, memberId: string, text: string): Promise<Review> {
  const rows = (await sql`UPDATE reviews SET text = ${text}, updated_at = now() WHERE id = ${reviewId} AND member_id = ${memberId} RETURNING *`) as Review[];
  if (!rows.length) throw new NotFound("That review isn't yours to edit");
  return rows[0];
}

export async function deleteReview(sql: Sql, reviewId: string, memberId: string) {
  const rows = await sql`DELETE FROM reviews WHERE id = ${reviewId} AND member_id = ${memberId} RETURNING id`;
  if (!rows.length) throw new NotFound("That review isn't yours to delete");
}

export async function addSnack(sql: Sql, nightId: string, memberId: string, name: string, kind: "snack" | "drink", note: string | null): Promise<SnackItem> {
  const night = await requireNight(sql, nightId);
  if (night.status === "rejected") throw new Conflict("This movie night was called off");
  await requireMember(sql, memberId);
  const rows = (await sql`INSERT INTO snack_items (night_id, member_id, name, kind, note) VALUES (${nightId}, ${memberId}, ${name}, ${kind}, ${note}) RETURNING *`) as SnackItem[];
  return rows[0];
}

export async function deleteSnack(sql: Sql, snackId: string, memberId: string) {
  const rows = await sql`DELETE FROM snack_items WHERE id = ${snackId} AND member_id = ${memberId} RETURNING id`;
  if (!rows.length) throw new NotFound("Only whoever added it can remove it");
}

/** One rating per person per item; re-rating replaces, which is what a mis-tap needs. */
export async function rateSnack(sql: Sql, snackId: string, memberId: string, score: number): Promise<SnackRating> {
  await requireMember(sql, memberId);
  const items = await sql`SELECT id FROM snack_items WHERE id = ${snackId}`;
  if (!items.length) throw new NotFound("No such snack");
  const rows = (await sql`INSERT INTO snack_ratings (snack_item_id, member_id, score) VALUES (${snackId}, ${memberId}, ${score})
    ON CONFLICT (snack_item_id, member_id) DO UPDATE SET score = EXCLUDED.score, created_at = now() RETURNING *`) as SnackRating[];
  return rows[0];
}

export async function submitPrediction(sql: Sql, nightId: string, memberId: string, own: number, group: number | null): Promise<Prediction> {
  const night = await requireNight(sql, nightId);
  await requireMember(sql, memberId);
  if (night.status !== "proposed" && night.status !== "approved") throw new Conflict("Predictions lock once the movie starts");
  const rows = (await sql`INSERT INTO predictions (night_id, member_id, own_score, group_score) VALUES (${nightId}, ${memberId}, ${own}, ${group})
    ON CONFLICT (night_id, member_id) DO UPDATE SET own_score = EXCLUDED.own_score, group_score = EXCLUDED.group_score, updated_at = now() RETURNING *`) as Prediction[];
  return rows[0];
}

// ---------------------------------------------------------------- history & stats

export async function loadHistory(sql: Sql): Promise<HistoryEntry[]> {
  const nights = (await sql`SELECT * FROM movie_nights WHERE status = 'complete' ORDER BY completed_at DESC`) as MovieNight[];
  if (!nights.length) return [];
  const [movies, ratings] = await Promise.all([
    sql`SELECT m.* FROM movies m WHERE m.id IN (SELECT movie_id FROM movie_nights WHERE status = 'complete')`,
    sql`SELECT r.* FROM ratings r JOIN movie_nights n ON n.id = r.night_id WHERE n.status = 'complete'`,
  ]);
  const movieById = new Map((movies as Movie[]).map((m) => [m.id, m]));
  return nights.map((night) => {
    const rs = (ratings as Rating[]).filter((r) => r.night_id === night.id);
    return {
      night,
      movie: movieById.get(night.movie_id)!,
      selector_id: night.selector_id,
      ratings: rs,
      group_avg: round1(mean(rs.map((r) => r.score))),
    };
  });
}

/** Everything the stats engine wants, in one round of queries. */
export async function loadDataset(sql: Sql): Promise<Dataset> {
  const members = await loadMembers(sql);
  const nights = (await sql`SELECT * FROM movie_nights WHERE status = 'complete' ORDER BY completed_at`) as MovieNight[];
  if (!nights.length) return { members, nights: [] };
  const [movies, ratings, predictions, snacks, snackRatings] = await Promise.all([
    sql`SELECT * FROM movies WHERE id IN (SELECT movie_id FROM movie_nights WHERE status = 'complete')`,
    sql`SELECT r.* FROM ratings r JOIN movie_nights n ON n.id = r.night_id WHERE n.status = 'complete'`,
    sql`SELECT p.* FROM predictions p JOIN movie_nights n ON n.id = p.night_id WHERE n.status = 'complete'`,
    sql`SELECT s.* FROM snack_items s JOIN movie_nights n ON n.id = s.night_id WHERE n.status = 'complete'`,
    sql`SELECT sr.* FROM snack_ratings sr JOIN snack_items s ON s.id = sr.snack_item_id JOIN movie_nights n ON n.id = s.night_id WHERE n.status = 'complete'`,
  ]);
  const movieById = new Map((movies as Movie[]).map((m) => [m.id, m]));
  const data: NightData[] = nights.map((night) => {
    const mySnacks = (snacks as SnackItem[]).filter((s) => s.night_id === night.id);
    const snackIds = new Set(mySnacks.map((s) => s.id));
    return {
      night,
      movie: movieById.get(night.movie_id)!,
      ratings: (ratings as Rating[]).filter((r) => r.night_id === night.id),
      predictions: (predictions as Prediction[]).filter((p) => p.night_id === night.id),
      snacks: mySnacks,
      snack_ratings: (snackRatings as SnackRating[]).filter((r) => snackIds.has(r.snack_item_id)),
    };
  });
  return { members, nights: data };
}
