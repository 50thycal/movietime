/**
 * Server-only data access. Every API route is a thin wrapper over one of
 * these, so the lifecycle rules live in one place and can be tested against
 * a real Postgres (PGlite in tests, Neon in production).
 */
import type { Sql } from "./db";
import { Conflict, NotFound, BadRequest } from "./http";
import { nextAfter, rotationInfo } from "./rotation";
import { approvalOutcome, ratingsRevealed } from "./scoring";
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
  SnackRating,
  TmdbSearchResult,
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
  const [movies, selectors, approvals, ratings, reviews, snacks, snackRatings, predictions, members] = await Promise.all([
    sql`SELECT * FROM movies WHERE id = ${night.movie_id}`,
    sql`SELECT * FROM members WHERE id = ${night.selector_id}`,
    sql`SELECT * FROM movie_approvals WHERE night_id = ${nightId} ORDER BY created_at`,
    sql`SELECT * FROM ratings WHERE night_id = ${nightId} ORDER BY created_at`,
    sql`SELECT * FROM reviews WHERE night_id = ${nightId} ORDER BY created_at`,
    sql`SELECT * FROM snack_items WHERE night_id = ${nightId} ORDER BY created_at`,
    sql`SELECT sr.* FROM snack_ratings sr JOIN snack_items si ON si.id = sr.snack_item_id WHERE si.night_id = ${nightId}`,
    sql`SELECT * FROM predictions WHERE night_id = ${nightId} ORDER BY created_at`,
    loadMembers(sql),
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
  const currentId = await currentSelectorId(sql);
  const [active, last, countRows] = await Promise.all([
    activeNight(sql),
    sql`SELECT * FROM movie_nights WHERE status = 'complete' ORDER BY completed_at DESC LIMIT 1`,
    sql`SELECT count(*)::int AS n FROM movie_nights WHERE status = 'complete'`,
  ]);
  return {
    now: new Date().toISOString(),
    setup_complete: setupComplete,
    members,
    rotation: rotationInfo(members, currentId),
    current: active ? await loadNightDetail(sql, active.id, me) : null,
    last_complete: last.length ? await loadNightDetail(sql, (last[0] as MovieNight).id, me) : null,
    watched_count: Number(countRows[0]?.n ?? 0),
  };
}

// ---------------------------------------------------------------- lifecycle

export async function proposeMovie(sql: Sql, memberId: string, movie: TmdbSearchResult): Promise<NightDetail> {
  const member = await requireMember(sql, memberId);
  const current = await currentSelectorId(sql);
  if (current && current !== member.id) throw new Conflict("It isn't your turn to pick");
  if (await activeNight(sql)) throw new Conflict("There's already a movie in play");
  const row = await upsertMovie(sql, movie);
  // The partial unique index is the real guard against two simultaneous proposals.
  const rows = (await sql`INSERT INTO movie_nights (movie_id, selector_id, status) VALUES (${row.id}, ${member.id}, 'proposed') RETURNING *`) as MovieNight[];
  return loadNightDetail(sql, rows[0].id, memberId);
}

export async function withdrawProposal(sql: Sql, nightId: string, memberId: string): Promise<void> {
  const night = await requireNight(sql, nightId);
  if (night.selector_id !== memberId) throw new Conflict("Only the picker can withdraw a proposal");
  if (night.status !== "proposed" && night.status !== "approved") throw new Conflict("This movie can't be withdrawn now");
  await sql`UPDATE movie_nights SET status = 'rejected' WHERE id = ${nightId}`;
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
  if (night.status !== "rating") throw new Conflict(night.status === "complete" ? "Ratings are already in" : "Ratings open once the movie is finished");
  // One rating per person per night — the UNIQUE constraint is the backstop.
  const existing = await sql`SELECT id FROM ratings WHERE night_id = ${nightId} AND member_id = ${memberId}`;
  if (existing.length) throw new Conflict("You've already rated this one");
  await sql`INSERT INTO ratings (night_id, member_id, score) VALUES (${nightId}, ${memberId}, ${score})`;
  await maybeCompleteNight(sql, nightId);
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
  return true;
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
