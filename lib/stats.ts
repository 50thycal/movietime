import { decadeOf } from "./format";
import { mean, round1, summarizeRatings } from "./scoring";
import type { FirstImpression, Member, Movie, MovieNight, Prediction, Rating, SnackItem, SnackRating } from "./types";

/** Everything the stats engine needs for one completed night. */
export interface NightData {
  night: MovieNight;
  movie: Movie;
  ratings: Rating[];
  predictions: Prediction[];
  first_impressions: FirstImpression[];
  snacks: SnackItem[];
  snack_ratings: SnackRating[];
}

export interface Dataset {
  members: Member[];
  nights: NightData[];
}

const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));

export function groupAverage(n: NightData): number | null {
  return round1(mean(n.ratings.map((r) => r.score)));
}

// ---------------------------------------------------------------- pickers

export interface PickerStats {
  member_id: string;
  movies_selected: number;
  picker_score: number | null;
  highest_pick: { night_id: string; title: string; average: number } | null;
  lowest_pick: { night_id: string; title: string; average: number } | null;
  average_runtime: number | null;
  genre_distribution: { genre: string; count: number }[];
  winners: number;
}

/**
 * Picker Score = mean group rating of the films someone chose. "Winners" are
 * picks that ended up in the top third of all group averages (min 3 nights).
 */
export function pickerStats(data: Dataset): PickerStats[] {
  const scored = data.nights
    .map((n) => ({ n, avg: groupAverage(n) }))
    .filter((x): x is { n: NightData; avg: number } => x.avg != null);
  const sortedAvgs = scored.map((x) => x.avg).sort((a, b) => b - a);
  const winnerCut = sortedAvgs.length >= 3 ? sortedAvgs[Math.ceil(sortedAvgs.length / 3) - 1] : Infinity;

  return data.members.map((m) => {
    const picks = scored.filter((x) => x.n.night.selector_id === m.id);
    const runtimes = data.nights
      .filter((x) => x.night.selector_id === m.id && x.movie.runtime_min != null)
      .map((x) => x.movie.runtime_min as number);
    const genreCounts = new Map<string, number>();
    for (const x of data.nights.filter((x) => x.night.selector_id === m.id)) {
      for (const g of x.movie.genres) genreCounts.set(g.name, (genreCounts.get(g.name) ?? 0) + 1);
    }
    const best = picks.length ? picks.reduce((a, b) => (b.avg > a.avg ? b : a)) : null;
    const worst = picks.length ? picks.reduce((a, b) => (b.avg < a.avg ? b : a)) : null;
    return {
      member_id: m.id,
      movies_selected: data.nights.filter((x) => x.night.selector_id === m.id).length,
      picker_score: round1(mean(picks.map((p) => p.avg))),
      highest_pick: best ? { night_id: best.n.night.id, title: best.n.movie.title, average: best.avg } : null,
      lowest_pick: worst ? { night_id: worst.n.night.id, title: worst.n.movie.title, average: worst.avg } : null,
      average_runtime: runtimes.length ? Math.round(mean(runtimes)!) : null,
      genre_distribution: [...genreCounts].map(([genre, count]) => ({ genre, count })).sort((a, b) => b.count - a.count),
      winners: picks.filter((p) => p.avg >= winnerCut).length,
    };
  });
}

// ---------------------------------------------------------------- critics

export interface CriticStats {
  member_id: string;
  ratings_given: number;
  average_given: number | null;
  /** Mean absolute distance from the group average on the nights they rated. */
  contrarian_score: number | null;
}

export function criticStats(data: Dataset): CriticStats[] {
  return data.members.map((m) => {
    const mine: number[] = [];
    const diffs: number[] = [];
    for (const n of data.nights) {
      const r = n.ratings.find((x) => x.member_id === m.id);
      if (!r) continue;
      mine.push(r.score);
      const others = n.ratings.filter((x) => x.member_id !== m.id).map((x) => x.score);
      const oa = mean(others);
      if (oa != null) diffs.push(Math.abs(r.score - oa));
    }
    return {
      member_id: m.id,
      ratings_given: mine.length,
      average_given: round1(mean(mine)),
      contrarian_score: diffs.length ? round1(mean(diffs)) : null,
    };
  });
}

// ---------------------------------------------------------------- similarity

export interface Similarity {
  a: string;
  b: string;
  shared: number;
  /** Pearson correlation on shared nights, or null with too few. */
  correlation: number | null;
  /** Mean absolute difference on shared nights. */
  mean_abs_diff: number | null;
}

export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/** Pairwise taste similarity, comparing only films both people rated. */
export function similarities(data: Dataset, minShared = 3): Similarity[] {
  const out: Similarity[] = [];
  const ms = data.members;
  for (let i = 0; i < ms.length; i++) {
    for (let j = i + 1; j < ms.length; j++) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const n of data.nights) {
        const a = n.ratings.find((r) => r.member_id === ms[i].id);
        const b = n.ratings.find((r) => r.member_id === ms[j].id);
        if (a && b) {
          xs.push(a.score);
          ys.push(b.score);
        }
      }
      const diffs = xs.map((x, k) => Math.abs(x - ys[k]));
      out.push({
        a: ms[i].id,
        b: ms[j].id,
        shared: xs.length,
        correlation: xs.length >= minShared ? round1(pearson(xs, ys) ?? NaN) : null,
        mean_abs_diff: xs.length >= minShared ? round1(mean(diffs)) : null,
      });
    }
  }
  return out.map((s) => ({ ...s, correlation: Number.isNaN(s.correlation) ? null : s.correlation }));
}

/**
 * Closest pair. Correlation says "do they move together"; mean difference
 * says "do they land in the same place". With small samples correlation is
 * noisy, so rank on mean difference and use correlation as a tiebreak.
 */
export function closestPair(sims: Similarity[]): Similarity | null {
  const eligible = sims.filter((s) => s.mean_abs_diff != null);
  if (!eligible.length) return null;
  return eligible.slice().sort((a, b) => a.mean_abs_diff! - b.mean_abs_diff! || (b.correlation ?? 0) - (a.correlation ?? 0))[0];
}
export function farthestPair(sims: Similarity[]): Similarity | null {
  const eligible = sims.filter((s) => s.mean_abs_diff != null);
  if (!eligible.length) return null;
  return eligible.slice().sort((a, b) => b.mean_abs_diff! - a.mean_abs_diff! || (a.correlation ?? 0) - (b.correlation ?? 0))[0];
}

// ---------------------------------------------------------------- genres

export interface GenreStat {
  genre: string;
  count: number;
  average: number | null;
}

export function groupGenreStats(data: Dataset): GenreStat[] {
  const acc = new Map<string, number[]>();
  const counts = new Map<string, number>();
  for (const n of data.nights) {
    const avg = groupAverage(n);
    for (const g of n.movie.genres) {
      counts.set(g.name, (counts.get(g.name) ?? 0) + 1);
      if (avg != null) acc.set(g.name, [...(acc.get(g.name) ?? []), avg]);
    }
  }
  return [...counts]
    .map(([genre, count]) => ({ genre, count, average: round1(mean(acc.get(genre) ?? [])) }))
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre));
}

export interface MemberGenreStats {
  member_id: string;
  genres: GenreStat[];
  favorite: GenreStat | null;
  least_favorite: GenreStat | null;
  /** Genres where this member's average differs from the group's by ≥ 1 point (min 2 films). */
  outliers: { genre: string; member_average: number; group_average: number; delta: number }[];
}

export function memberGenreStats(data: Dataset): MemberGenreStats[] {
  const group = new Map(groupGenreStats(data).map((g) => [g.genre, g]));
  return data.members.map((m) => {
    const acc = new Map<string, number[]>();
    for (const n of data.nights) {
      const r = n.ratings.find((x) => x.member_id === m.id);
      if (!r) continue;
      for (const g of n.movie.genres) acc.set(g.name, [...(acc.get(g.name) ?? []), r.score]);
    }
    const genres: GenreStat[] = [...acc]
      .map(([genre, scores]) => ({ genre, count: scores.length, average: round1(mean(scores)) }))
      .sort((a, b) => (b.average ?? 0) - (a.average ?? 0) || b.count - a.count);
    const rated = genres.filter((g) => g.average != null);
    const outliers = genres
      .filter((g) => g.count >= 2 && g.average != null && group.get(g.genre)?.average != null)
      .map((g) => ({
        genre: g.genre,
        member_average: g.average!,
        group_average: group.get(g.genre)!.average!,
        delta: round1(g.average! - group.get(g.genre)!.average!)!,
      }))
      .filter((o) => Math.abs(o.delta) >= 1)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return {
      member_id: m.id,
      genres,
      favorite: rated[0] ?? null,
      least_favorite: rated.length > 1 ? rated[rated.length - 1] : null,
      outliers,
    };
  });
}

// ---------------------------------------------------------------- runtime

export interface RuntimeStats {
  average: number | null;
  longest: { night_id: string; title: string; runtime_min: number } | null;
  shortest: { night_id: string; title: string; runtime_min: number } | null;
  /** Member whose picks run longest on average (min 1 pick). */
  longest_picker: { member_id: string; average: number } | null;
}

export function runtimeStats(data: Dataset): RuntimeStats {
  const withRt = data.nights.filter((n) => n.movie.runtime_min != null);
  const rts = withRt.map((n) => n.movie.runtime_min as number);
  const longest = withRt.length ? withRt.reduce((a, b) => (b.movie.runtime_min! > a.movie.runtime_min! ? b : a)) : null;
  const shortest = withRt.length ? withRt.reduce((a, b) => (b.movie.runtime_min! < a.movie.runtime_min! ? b : a)) : null;
  const perMember = data.members
    .map((m) => {
      const mine = withRt.filter((n) => n.night.selector_id === m.id).map((n) => n.movie.runtime_min as number);
      return { member_id: m.id, average: mine.length ? Math.round(mean(mine)!) : null };
    })
    .filter((x): x is { member_id: string; average: number } => x.average != null)
    .sort((a, b) => b.average - a.average);
  return {
    average: rts.length ? Math.round(mean(rts)!) : null,
    longest: longest ? { night_id: longest.night.id, title: longest.movie.title, runtime_min: longest.movie.runtime_min! } : null,
    shortest: shortest ? { night_id: shortest.night.id, title: shortest.movie.title, runtime_min: shortest.movie.runtime_min! } : null,
    longest_picker: perMember[0] ?? null,
  };
}

// ---------------------------------------------------------------- snacks

export interface SnackStats {
  best_snack: { name: string; average: number; night_id: string; member_id: string } | null;
  best_drink: { name: string; average: number; night_id: string; member_id: string } | null;
  best_snack_provider: { member_id: string; average: number; items: number } | null;
  best_drink_provider: { member_id: string; average: number; items: number } | null;
  most_frequent: { name: string; count: number } | null;
  total_items: number;
}

function itemAverage(item: SnackItem, ratings: SnackRating[]): number | null {
  return round1(mean(ratings.filter((r) => r.snack_item_id === item.id).map((r) => r.score)));
}

export function snackStats(data: Dataset): SnackStats {
  const items = data.nights.flatMap((n) => n.snacks.map((s) => ({ item: s, avg: itemAverage(s, n.snack_ratings) })));
  const best = (kind: "snack" | "drink") => {
    const rated = items.filter((x) => x.item.kind === kind && x.avg != null);
    if (!rated.length) return null;
    const top = rated.reduce((a, b) => (b.avg! > a.avg! ? b : a));
    return { name: top.item.name, average: top.avg!, night_id: top.item.night_id, member_id: top.item.member_id };
  };
  const provider = (kind: "snack" | "drink") => {
    const perMember = data.members
      .map((m) => {
        const mine = items.filter((x) => x.item.kind === kind && x.item.member_id === m.id && x.avg != null);
        return { member_id: m.id, average: round1(mean(mine.map((x) => x.avg!))), items: mine.length };
      })
      .filter((x): x is { member_id: string; average: number; items: number } => x.average != null)
      .sort((a, b) => b.average - a.average || b.items - a.items);
    return perMember[0] ?? null;
  };
  const freq = new Map<string, number>();
  for (const x of items) {
    const key = x.item.name.trim().toLowerCase();
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  const mostFreq = [...freq].sort((a, b) => b[1] - a[1])[0];
  return {
    best_snack: best("snack"),
    best_drink: best("drink"),
    best_snack_provider: provider("snack"),
    best_drink_provider: provider("drink"),
    most_frequent: mostFreq ? { name: mostFreq[0], count: mostFreq[1] } : null,
    total_items: items.length,
  };
}

// ---------------------------------------------------------------- predictions

export interface PredictionResult {
  night_id: string;
  member_id: string;
  predicted_own: number;
  actual_own: number | null;
  own_error: number | null;
  predicted_group: number | null;
  actual_group: number | null;
  group_error: number | null;
}

export function predictionResults(n: NightData): PredictionResult[] {
  const groupAvg = groupAverage(n);
  return n.predictions.map((p) => {
    const actual = n.ratings.find((r) => r.member_id === p.member_id)?.score ?? null;
    return {
      night_id: n.night.id,
      member_id: p.member_id,
      predicted_own: p.own_score,
      actual_own: actual,
      own_error: actual == null ? null : round1(Math.abs(actual - p.own_score)),
      predicted_group: p.group_score,
      actual_group: groupAvg,
      group_error: p.group_score == null || groupAvg == null ? null : round1(Math.abs(groupAvg - p.group_score)),
    };
  });
}

export interface PredictionStats {
  per_member: { member_id: string; predictions: number; mean_own_error: number | null; mean_group_error: number | null; streak: number }[];
  most_accurate: { member_id: string; mean_own_error: number } | null;
  biggest_surprise: { night_id: string; member_id: string; title: string; predicted: number; actual: number } | null;
  most_exceeded: { night_id: string; title: string; predicted: number; actual: number } | null;
  most_disappointed: { night_id: string; title: string; predicted: number; actual: number } | null;
}

/** A "hit" for streak purposes: own prediction within 1 point of the real score. */
export function predictionStats(data: Dataset, hitTolerance = 1): PredictionStats {
  const ordered = data.nights.slice().sort((a, b) => (a.night.completed_at ?? "").localeCompare(b.night.completed_at ?? ""));
  const all = ordered.flatMap((n) => predictionResults(n).map((r) => ({ r, n })));
  const per_member = data.members.map((m) => {
    const mine = all.filter((x) => x.r.member_id === m.id && x.r.own_error != null);
    let streak = 0;
    for (let i = mine.length - 1; i >= 0; i--) {
      if (mine[i].r.own_error! <= hitTolerance) streak++;
      else break;
    }
    const groupErrs = mine.filter((x) => x.r.group_error != null).map((x) => x.r.group_error!);
    return {
      member_id: m.id,
      predictions: mine.length,
      mean_own_error: round1(mean(mine.map((x) => x.r.own_error!))),
      mean_group_error: round1(mean(groupErrs)),
      streak,
    };
  });
  const accurate = per_member
    .filter((p) => p.mean_own_error != null && p.predictions >= 1)
    .sort((a, b) => a.mean_own_error! - b.mean_own_error! || b.predictions - a.predictions)[0];
  const surprise = all
    .filter((x) => x.r.own_error != null)
    .sort((a, b) => b.r.own_error! - a.r.own_error!)[0];

  // Expectations vs. outcome per film: mean predicted own score vs. group average.
  const expectations = ordered
    .map((n) => {
      const preds = n.predictions.map((p) => p.own_score);
      const predicted = mean(preds);
      const actual = groupAverage(n);
      return predicted == null || actual == null ? null : { night_id: n.night.id, title: n.movie.title, predicted: round1(predicted)!, actual, delta: actual - predicted };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  const exceeded = expectations.slice().sort((a, b) => b.delta - a.delta)[0];
  const disappointed = expectations.slice().sort((a, b) => a.delta - b.delta)[0];

  return {
    per_member,
    most_accurate: accurate ? { member_id: accurate.member_id, mean_own_error: accurate.mean_own_error! } : null,
    biggest_surprise: surprise
      ? { night_id: surprise.n.night.id, member_id: surprise.r.member_id, title: surprise.n.movie.title, predicted: surprise.r.predicted_own, actual: surprise.r.actual_own! }
      : null,
    most_exceeded: exceeded && exceeded.delta > 0 ? exceeded : null,
    most_disappointed: disappointed && disappointed.delta < 0 ? disappointed : null,
  };
}

// ------------------------------------------------- first impressions

export interface ImpressionPair {
  night_id: string;
  title: string;
  member_id: string;
  first: number;
  final: number;
  /** final − first: positive means the film grew on them. */
  delta: number;
}

export interface FirstImpressionStats {
  /** How many (ten-minute verdict, final score) pairs exist at all. */
  pairs: number;
  nights: number;
  /**
   * Pearson correlation between the ten-minute verdict and the final score,
   * across every pair. This is the answer to "does the snap judgement mean
   * anything": 1 is perfect agreement, 0 is noise, below 0 is contrarian.
   * Null until there are enough pairs to say anything at all.
   */
  correlation: number | null;
  /** Average size of the change, ignoring direction. */
  mean_abs_change: number | null;
  /** Average signed change. Positive means films tend to win the group over. */
  mean_drift: number | null;
  /** Share of pairs that landed within half a point of the final score. */
  within_half_point: number | null;
  per_member: {
    member_id: string;
    pairs: number;
    correlation: number | null;
    mean_abs_change: number | null;
    mean_drift: number | null;
  }[];
  /** The member whose ten-minute verdict tracks their final score most closely. */
  sharpest: { member_id: string; mean_abs_change: number } | null;
  /** Group-level movers: first-impression average vs final average. */
  biggest_riser: { night_id: string; title: string; first: number; final: number; delta: number } | null;
  biggest_faller: { night_id: string; title: string; first: number; final: number; delta: number } | null;
}

/** Every (ten-minute verdict, final score) pair the group has produced. */
export function impressionPairs(data: Dataset): ImpressionPair[] {
  const out: ImpressionPair[] = [];
  for (const n of data.nights) {
    for (const f of n.first_impressions) {
      const final = n.ratings.find((r) => r.member_id === f.member_id)?.score;
      if (final == null) continue;
      out.push({
        night_id: n.night.id,
        title: n.movie.title,
        member_id: f.member_id,
        first: f.score,
        final,
        delta: round1(final - f.score)!,
      });
    }
  }
  return out;
}

const MIN_PAIRS_FOR_CORRELATION = 4;

export function firstImpressionStats(data: Dataset): FirstImpressionStats {
  const pairs = impressionPairs(data);
  const deltas = pairs.map((p) => p.delta);
  const correlation = pairs.length >= MIN_PAIRS_FOR_CORRELATION ? pearson(pairs.map((p) => p.first), pairs.map((p) => p.final)) : null;

  const per_member = data.members.map((m) => {
    const mine = pairs.filter((p) => p.member_id === m.id);
    return {
      member_id: m.id,
      pairs: mine.length,
      correlation: mine.length >= MIN_PAIRS_FOR_CORRELATION ? round1(pearson(mine.map((p) => p.first), mine.map((p) => p.final)) ?? NaN) : null,
      mean_abs_change: round1(mean(mine.map((p) => Math.abs(p.delta)))),
      mean_drift: round1(mean(mine.map((p) => p.delta))),
    };
  }).map((p) => ({ ...p, correlation: Number.isNaN(p.correlation as number) ? null : p.correlation }));

  const ranked = per_member
    .filter((p) => p.mean_abs_change != null && p.pairs >= 2)
    .sort((a, b) => a.mean_abs_change! - b.mean_abs_change! || b.pairs - a.pairs);

  // Per film: what the room thought ten minutes in vs where it ended up.
  const perNight = data.nights
    .map((n) => {
      const first = mean(n.first_impressions.map((f) => f.score));
      const final = groupAverage(n);
      return first == null || final == null
        ? null
        : { night_id: n.night.id, title: n.movie.title, first: round1(first)!, final, delta: round1(final - first)! };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  const riser = perNight.slice().sort((a, b) => b.delta - a.delta)[0];
  const faller = perNight.slice().sort((a, b) => a.delta - b.delta)[0];

  return {
    pairs: pairs.length,
    nights: perNight.length,
    correlation: correlation == null || Number.isNaN(correlation) ? null : round1(correlation),
    mean_abs_change: round1(mean(deltas.map(Math.abs))),
    mean_drift: round1(mean(deltas)),
    within_half_point: pairs.length ? round1((pairs.filter((p) => Math.abs(p.delta) <= 0.5).length / pairs.length) * 100) : null,
    per_member,
    sharpest: ranked[0] ? { member_id: ranked[0].member_id, mean_abs_change: ranked[0].mean_abs_change! } : null,
    biggest_riser: riser && riser.delta > 0 ? riser : null,
    biggest_faller: faller && faller.delta < 0 ? faller : null,
  };
}

// ---------------------------------------------------------------- awards

export type AwardKey =
  | "best_pick"
  | "worst_pick"
  | "best_snacks"
  | "best_drinks"
  | "crowd_pleaser"
  | "most_divisive"
  | "most_accurate_predictor"
  | "longest_commitment"
  | "crystal_ball";

export const AWARD_META: Record<AwardKey, { emoji: string; label: string; blurb: string }> = {
  best_pick: { emoji: "🏆", label: "Best Pick", blurb: "Highest group rating so far" },
  worst_pick: { emoji: "💀", label: "Worst Pick", blurb: "Lowest group rating so far" },
  best_snacks: { emoji: "🍿", label: "Best Snacks", blurb: "Top-rated snack of the night" },
  best_drinks: { emoji: "🍸", label: "Best Drinks", blurb: "Top-rated drink of the night" },
  crowd_pleaser: { emoji: "🤝", label: "Crowd Pleaser", blurb: "Everyone agreed, and liked it" },
  most_divisive: { emoji: "⚔️", label: "Most Divisive", blurb: "Scores three or more points apart" },
  most_accurate_predictor: { emoji: "🎯", label: "Most Accurate Predictor", blurb: "Called their own score" },
  longest_commitment: { emoji: "🕐", label: "Longest Commitment", blurb: "Two and a half hours or more" },
  crystal_ball: { emoji: "🔮", label: "Crystal Ball", blurb: "Ten minutes in, they already knew" },
};

export interface Award {
  key: AwardKey;
  night_id: string;
  /** Who gets it. Null for movie-level awards with no obvious owner. */
  member_id: string | null;
  detail: string;
}

/**
 * Per-night awards, computed from what was actually recorded. Nothing is
 * awarded when the data isn't there: no snack ratings → no snack award, no
 * predictions → no predictor award, fewer than two nights → no best/worst pick.
 */
export function nightAwards(n: NightData, data: Dataset): Award[] {
  const out: Award[] = [];
  const s = summarizeRatings(n.ratings, n.night.selector_id);
  const id = n.night.id;
  if (s.count === 0) return out;

  // Best/worst pick are relative to the whole season, so they need company.
  const scored = data.nights.map((x) => ({ id: x.night.id, avg: groupAverage(x) })).filter((x) => x.avg != null);
  if (scored.length >= 2) {
    const max = Math.max(...scored.map((x) => x.avg!));
    const min = Math.min(...scored.map((x) => x.avg!));
    if (max !== min) {
      if (s.average === max) out.push({ key: "best_pick", night_id: id, member_id: n.night.selector_id, detail: `Group rated it ${s.average}` });
      if (s.average === min) out.push({ key: "worst_pick", night_id: id, member_id: n.night.selector_id, detail: `Group rated it ${s.average}` });
    }
  }

  if (s.count >= 3 && s.spread != null) {
    if (s.spread <= 1 && s.average! >= 7) out.push({ key: "crowd_pleaser", night_id: id, member_id: n.night.selector_id, detail: `Everyone within ${s.spread} of each other` });
    if (s.spread >= 3) {
      out.push({ key: "most_divisive", night_id: id, member_id: null, detail: `${s.lowest} to ${s.highest}` });
    }
  }

  const bestOf = (kind: "snack" | "drink") => {
    const rated = n.snacks
      .filter((x) => x.kind === kind)
      .map((item) => ({ item, avg: itemAverage(item, n.snack_ratings) }))
      .filter((x) => x.avg != null);
    if (!rated.length) return null;
    return rated.reduce((a, b) => (b.avg! > a.avg! ? b : a));
  };
  const bs = bestOf("snack");
  if (bs) out.push({ key: "best_snacks", night_id: id, member_id: bs.item.member_id, detail: `${bs.item.name} · ${bs.avg}/5` });
  const bd = bestOf("drink");
  if (bd) out.push({ key: "best_drinks", night_id: id, member_id: bd.item.member_id, detail: `${bd.item.name} · ${bd.avg}/5` });

  const preds = predictionResults(n).filter((p) => p.own_error != null).sort((a, b) => a.own_error! - b.own_error!);
  if (preds.length) {
    const best = preds[0];
    const tie = preds.filter((p) => p.own_error === best.own_error);
    if (tie.length === 1) {
      out.push({ key: "most_accurate_predictor", night_id: id, member_id: best.member_id, detail: `Predicted ${best.predicted_own}, gave ${best.actual_own}` });
    }
  }

  // Whose ten-minute verdict landed closest to their own final score.
  const impressions = n.first_impressions
    .map((f) => ({ f, final: n.ratings.find((r) => r.member_id === f.member_id)?.score }))
    .filter((x): x is { f: FirstImpression; final: number } => x.final != null)
    .map((x) => ({ member_id: x.f.member_id, gap: Math.abs(x.final - x.f.score), first: x.f.score, final: x.final }))
    .sort((a, b) => a.gap - b.gap);
  if (impressions.length >= 2) {
    const best = impressions[0];
    const tied = impressions.filter((x) => x.gap === best.gap);
    if (tied.length === 1) {
      out.push({
        key: "crystal_ball",
        night_id: id,
        member_id: best.member_id,
        detail: best.gap === 0 ? `Called ${best.first} at ten minutes and never moved` : `Said ${best.first} early, finished on ${best.final}`,
      });
    }
  }

  if ((n.movie.runtime_min ?? 0) >= 150) {
    out.push({ key: "longest_commitment", night_id: id, member_id: n.night.selector_id, detail: `${n.movie.runtime_min} minutes` });
  }
  return out;
}

export function awardTotals(data: Dataset): { member_id: string; key: AwardKey; count: number }[] {
  const counts = new Map<string, number>();
  for (const n of data.nights) {
    for (const a of nightAwards(n, data)) {
      if (!a.member_id) continue;
      const k = `${a.member_id}|${a.key}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts].map(([k, count]) => {
    const [member_id, key] = k.split("|");
    return { member_id, key: key as AwardKey, count };
  });
}

// ---------------------------------------------------------------- taste

export interface TasteProfile {
  movies_watched: number;
  favorite_genres: GenreStat[];
  highest_rated: { night_id: string; title: string; average: number; poster_path: string | null }[];
  lowest_rated: { night_id: string; title: string; average: number; poster_path: string | null }[];
  favorite_decades: { decade: string; count: number; average: number | null }[];
  average_runtime: number | null;
  /** Mean spread across nights — lower means the group agrees more. */
  consensus_score: number | null;
  most_divisive_genre: { genre: string; spread: number } | null;
  most_similar: Similarity | null;
  least_similar: Similarity | null;
}

export function tasteProfile(data: Dataset): TasteProfile {
  const scored = data.nights
    .map((n) => ({ n, avg: groupAverage(n), summary: summarizeRatings(n.ratings, n.night.selector_id) }))
    .filter((x): x is { n: NightData; avg: number; summary: ReturnType<typeof summarizeRatings> } => x.avg != null);
  const ranked = scored.slice().sort((a, b) => b.avg - a.avg);
  const top = (xs: typeof ranked) =>
    xs.map((x) => ({ night_id: x.n.night.id, title: x.n.movie.title, average: x.avg, poster_path: x.n.movie.poster_path }));

  const decades = new Map<string, number[]>();
  const decadeCounts = new Map<string, number>();
  for (const n of data.nights) {
    const d = decadeOf(n.movie.year);
    if (!d) continue;
    decadeCounts.set(d, (decadeCounts.get(d) ?? 0) + 1);
    const avg = groupAverage(n);
    if (avg != null) decades.set(d, [...(decades.get(d) ?? []), avg]);
  }

  const genreSpread = new Map<string, number[]>();
  for (const x of scored) {
    if (x.summary.spread == null || x.summary.count < 2) continue;
    for (const g of x.n.movie.genres) genreSpread.set(g.name, [...(genreSpread.get(g.name) ?? []), x.summary.spread]);
  }
  const divisive = [...genreSpread]
    .filter(([, xs]) => xs.length >= 2)
    .map(([genre, xs]) => ({ genre, spread: round1(mean(xs))! }))
    .sort((a, b) => b.spread - a.spread)[0];

  const sims = similarities(data);
  const genres = groupGenreStats(data).filter((g) => g.average != null && g.count >= 2);
  return {
    movies_watched: data.nights.length,
    favorite_genres: genres.slice().sort((a, b) => b.average! - a.average! || b.count - a.count).slice(0, 5),
    highest_rated: top(ranked.slice(0, 5)),
    lowest_rated: top(ranked.slice().reverse().slice(0, 5)),
    favorite_decades: [...decadeCounts]
      .map(([decade, count]) => ({ decade, count, average: round1(mean(decades.get(decade) ?? [])) }))
      .sort((a, b) => (b.average ?? 0) - (a.average ?? 0) || b.count - a.count),
    average_runtime: runtimeStats(data).average,
    consensus_score: round1(mean(scored.filter((x) => x.summary.count >= 2).map((x) => x.summary.spread!))),
    most_divisive_genre: divisive ?? null,
    most_similar: closestPair(sims),
    least_similar: farthestPair(sims),
  };
}

// ---------------------------------------------------------------- leaderboards

export interface Leaderboards {
  best_picker: { member_id: string; score: number; picks: number }[];
  snack_champion: { member_id: string; average: number; items: number } | null;
  drink_champion: { member_id: string; average: number; items: number } | null;
  toughest_critic: { member_id: string; average: number } | null;
  easiest_critic: { member_id: string; average: number } | null;
  contrarian: { member_id: string; score: number } | null;
  movie_twins: Similarity | null;
  runtime_criminal: { member_id: string; average: number } | null;
}

export function leaderboards(data: Dataset): Leaderboards {
  const pickers = pickerStats(data)
    .filter((p) => p.picker_score != null)
    .map((p) => ({ member_id: p.member_id, score: p.picker_score!, picks: p.movies_selected }))
    .sort((a, b) => b.score - a.score || b.picks - a.picks);
  const critics = criticStats(data).filter((c) => c.average_given != null);
  const byAvg = critics.slice().sort((a, b) => a.average_given! - b.average_given!);
  const contrarian = critics.filter((c) => c.contrarian_score != null).sort((a, b) => b.contrarian_score! - a.contrarian_score!)[0];
  const snacks = snackStats(data);
  const rt = runtimeStats(data);
  return {
    best_picker: pickers,
    snack_champion: snacks.best_snack_provider,
    drink_champion: snacks.best_drink_provider,
    toughest_critic: byAvg.length >= 2 ? { member_id: byAvg[0].member_id, average: byAvg[0].average_given! } : null,
    easiest_critic: byAvg.length >= 2 ? { member_id: byAvg[byAvg.length - 1].member_id, average: byAvg[byAvg.length - 1].average_given! } : null,
    contrarian: contrarian ? { member_id: contrarian.member_id, score: contrarian.contrarian_score! } : null,
    movie_twins: closestPair(similarities(data)),
    runtime_criminal: rt.longest_picker,
  };
}

export { byId };
