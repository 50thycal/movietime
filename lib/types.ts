/** Shared shapes for rows and API payloads. Timestamps arrive as ISO strings after JSON. */

export const NIGHT_STATUSES = [
  "proposed",
  "rejected",
  "approved",
  "watching",
  "rating",
  "complete",
] as const;
export type NightStatus = (typeof NIGHT_STATUSES)[number];

/** Statuses that occupy "the current movie night" slot. Only one may exist at a time. */
export const ACTIVE_STATUSES: NightStatus[] = ["proposed", "approved", "watching", "rating"];

export const SNACK_KINDS = ["snack", "drink"] as const;
export type SnackKind = (typeof SNACK_KINDS)[number];

export interface Member {
  id: string;
  name: string;
  color: string;
  emoji: string;
  rotation_position: number;
  active: boolean;
  created_at: string;
}

export interface Genre {
  id: number;
  name: string;
}

export interface Movie {
  id: string;
  tmdb_id: number;
  title: string;
  year: number | null;
  release_date: string | null;
  runtime_min: number | null;
  genres: Genre[];
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  director: string | null;
  tmdb_rating: number | null;
  tmdb_votes: number | null;
  created_at: string;
}

export interface MovieNight {
  id: string;
  movie_id: string;
  selector_id: string;
  status: NightStatus;
  proposed_at: string;
  approved_at: string | null;
  started_at: string | null;
  watched_at: string | null;
  completed_at: string | null;
  rotation_advanced: boolean;
}

export interface Approval {
  id: string;
  night_id: string;
  member_id: string;
  decision: "approve" | "reject";
  reason: string | null;
  created_at: string;
}

export interface Rating {
  id: string;
  night_id: string;
  member_id: string;
  score: number;
  created_at: string;
}

export interface Review {
  id: string;
  night_id: string;
  member_id: string;
  text: string;
  created_at: string;
  updated_at: string;
}

export interface SnackItem {
  id: string;
  night_id: string;
  member_id: string;
  name: string;
  kind: SnackKind;
  note: string | null;
  created_at: string;
}

export interface SnackRating {
  id: string;
  snack_item_id: string;
  member_id: string;
  score: number;
  created_at: string;
}

export interface Prediction {
  id: string;
  night_id: string;
  member_id: string;
  own_score: number;
  group_score: number | null;
  created_at: string;
  updated_at: string;
}

/** A movie night with everything hanging off it. Ratings are only present once revealed. */
export interface Vote {
  id: string;
  night_id: string;
  member_id: string;
  movie_id: string;
  created_at: string;
}

export interface NightDetail {
  night: MovieNight;
  movie: Movie;
  /** All films the picker put forward, in order. One entry for a plain proposal. */
  candidates: Movie[];
  votes: Vote[];
  selector: Member;
  approvals: Approval[];
  /** Full scores — only when the night is complete (all ratings in). */
  ratings: Rating[];
  /** Who has rated so far, visible while scores are still hidden. */
  rated_member_ids: string[];
  /** The requesting member's own score while hidden, so they can see what they sent. */
  my_rating: number | null;
  reviews: Review[];
  snacks: SnackItem[];
  snack_ratings: SnackRating[];
  predictions: Prediction[];
  /** The requester's own prediction — predictions of others are hidden until reveal. */
  my_prediction: Prediction | null;
  /** Awards earned, computed from recorded data. Empty until complete. */
  awards: { key: string; night_id: string; member_id: string | null; detail: string }[];
}

export interface RotationInfo {
  current: Member | null;
  upcoming: Member[];
}

export interface HomeState {
  now: string;
  setup_complete: boolean;
  members: Member[];
  rotation: RotationInfo;
  current: NightDetail | null;
  last_complete: NightDetail | null;
  watched_count: number;
}

/** A completed (or any) night flattened for the history grid. */
export interface HistoryEntry {
  night: MovieNight;
  movie: Movie;
  selector_id: string;
  ratings: Rating[];
  group_avg: number | null;
}

export interface TmdbSearchResult {
  tmdb_id: number;
  title: string;
  year: number | null;
  release_date: string | null;
  runtime_min: number | null;
  genres: Genre[];
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  director: string | null;
  tmdb_rating: number | null;
  tmdb_votes: number | null;
  popularity: number | null;
}

export interface WishlistEntry {
  id: string;
  movie: Movie;
  added_by: string;
  note: string | null;
  created_at: string;
}
