/**
 * "Pick like us": turn the group's (or one member's) ratings into a taste
 * model, then score TMDB candidates against it. Pure functions — the roulette
 * route does the fetching.
 *
 * Everything is measured as deviation from the rater's own mean, so a tough
 * critic's 6 and an easy grader's 8 can mean the same thing. Per-genre and
 * per-decade averages are shrunk toward zero (Bayesian-style, SHRINK phantom
 * zero-deviation films) so one lucky horror night doesn't make "Horror" a
 * favourite.
 */
import { decadeOf } from "./format";
import { mean, round1 } from "./scoring";
import type { Dataset } from "./stats";
import type { TmdbSearchResult } from "./types";

export const MIN_RATED = 3;
const SHRINK = 2;

export interface RatedFilm {
  tmdb_id: number;
  title: string;
  score: number;
  genre_ids: number[];
  decade: string | null;
}

export interface TasteModel {
  /** null = the whole group. */
  member_id: string | null;
  /** "Zoe" or "the group", for the reasons shown on the card. */
  who: string;
  rated: RatedFilm[];
  mean: number;
  /** Shrunk mean deviation per genre id / decade label. */
  genres: Map<number, number>;
  genre_names: Map<number, string>;
  decades: Map<string, number>;
}

export function buildTasteModel(data: Dataset, memberId: string | null): TasteModel {
  const rated: RatedFilm[] = [];
  const genreNames = new Map<number, string>();
  for (const n of data.nights) {
    const scores = memberId ? n.ratings.filter((r) => r.member_id === memberId).map((r) => r.score) : n.ratings.map((r) => r.score);
    const score = mean(scores);
    if (score == null) continue;
    for (const g of n.movie.genres) genreNames.set(g.id, g.name);
    rated.push({
      tmdb_id: n.movie.tmdb_id,
      title: n.movie.title,
      score,
      genre_ids: n.movie.genres.map((g) => g.id),
      decade: decadeOf(n.movie.year),
    });
  }
  const mu = mean(rated.map((r) => r.score)) ?? 0;
  const shrunk = <K>(pairs: [K, number][]) => {
    const acc = new Map<K, { sum: number; n: number }>();
    for (const [k, d] of pairs) {
      const a = acc.get(k) ?? { sum: 0, n: 0 };
      acc.set(k, { sum: a.sum + d, n: a.n + 1 });
    }
    return new Map([...acc].map(([k, a]) => [k, a.sum / (a.n + SHRINK)]));
  };
  const name = memberId ? data.members.find((m) => m.id === memberId)?.name : null;
  return {
    member_id: memberId,
    who: name ?? "the group",
    rated,
    mean: mu,
    genres: shrunk(rated.flatMap((r) => r.genre_ids.map((g) => [g, r.score - mu] as [number, number]))),
    genre_names: genreNames,
    decades: shrunk(rated.filter((r) => r.decade).map((r) => [r.decade!, r.score - mu] as [string, number])),
  };
}

/** Films to pull recommendations from: rated above the rater's average, best first. */
export function seedFilms(model: TasteModel, count = 3, rand: () => number = Math.random): RatedFilm[] {
  const liked = model.rated
    .filter((r) => r.score > model.mean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  return weightedSample(liked, (r) => Math.exp(r.score - model.mean), count, rand);
}

/** A genre worth steering discovery toward, weighted by how much it's liked. */
export function favouriteGenre(model: TasteModel, rand: () => number = Math.random): number | null {
  const liked = [...model.genres].filter(([, v]) => v > 0);
  return weightedSample(liked, ([, v]) => Math.exp(2 * v), 1, rand)[0]?.[0] ?? null;
}

export interface Candidate {
  movie: TmdbSearchResult;
  /** Seeds whose TMDB recommendations included this film. */
  recommended_by: RatedFilm[];
}

export interface ScoredCandidate extends Candidate {
  score: number;
  reasons: string[];
}

export function scoreCandidate(model: TasteModel, c: Candidate): ScoredCandidate {
  const who = model.who;
  const parts: { value: number; reason: string | null }[] = [];

  const gs = c.movie.genres.map((g) => ({ g, v: model.genres.get(g.id) ?? 0 }));
  const genreTerm = gs.length ? mean(gs.map((x) => x.v))! : 0;
  const bestGenre = gs.slice().sort((a, b) => b.v - a.v)[0];
  parts.push({
    value: genreTerm,
    reason: bestGenre && bestGenre.v >= 0.3 ? `${model.genre_names.get(bestGenre.g.id) ?? bestGenre.g.name} rates +${round1(bestGenre.v)} for ${who}` : null,
  });

  const decade = decadeOf(c.movie.year);
  const decadeTerm = decade ? (model.decades.get(decade) ?? 0) : 0;
  parts.push({ value: 0.5 * decadeTerm, reason: decade && decadeTerm >= 0.3 ? `${who[0].toUpperCase()}${who.slice(1)} likes ${decade} films` : null });

  const seed = c.recommended_by.slice().sort((a, b) => b.score - a.score)[0];
  parts.push({
    value: c.recommended_by.reduce((s, r) => s + 0.5 + 0.25 * (r.score - model.mean), 0),
    reason: seed ? `Fans of ${seed.title} love it (${model.member_id ? `${who} gave it` : "group avg"} ${round1(seed.score)})` : null,
  });

  const quality = c.movie.tmdb_rating != null ? (c.movie.tmdb_rating - 7) * 0.5 : 0;
  parts.push({ value: quality, reason: c.movie.tmdb_rating != null && c.movie.tmdb_rating >= 7.8 ? `Critically loved (TMDB ${c.movie.tmdb_rating})` : null });

  const ranked = parts.filter((p) => p.reason).sort((a, b) => b.value - a.value);
  return { ...c, score: parts.reduce((s, p) => s + p.value, 0), reasons: ranked.slice(0, 3).map((p) => p.reason!) };
}

/**
 * Best-first order with some luck, so "Pick like us" isn't the same film
 * every spin: sample without replacement, weight = exp(score / temperature).
 */
export function rankForSpin(scored: ScoredCandidate[], temperature = 0.6, rand: () => number = Math.random): ScoredCandidate[] {
  const top = scored.slice().sort((a, b) => b.score - a.score).slice(0, 15);
  return weightedSample(top, (c) => Math.exp(c.score / temperature), top.length, rand);
}

export function weightedSample<T>(xs: T[], weight: (x: T) => number, k: number, rand: () => number = Math.random): T[] {
  const pool = xs.map((x) => ({ x, w: Math.max(weight(x), 1e-9) }));
  const out: T[] = [];
  while (out.length < k && pool.length) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let r = rand() * total;
    let i = 0;
    while (i < pool.length - 1 && r >= pool[i].w) r -= pool[i++].w;
    out.push(pool.splice(i, 1)[0].x);
  }
  return out;
}
