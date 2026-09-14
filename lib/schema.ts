/**
 * The whole database, no migrations framework — same approach as baby_baby.
 * Every statement is idempotent, so it runs safely on every cold start
 * (see `lib/db.ts`) and via `npm run db:setup`.
 */
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS members (
     id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     name              text        NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
     color             text        NOT NULL,
     emoji             text        NOT NULL DEFAULT '🎬',
     rotation_position integer     NOT NULL,
     active            boolean     NOT NULL DEFAULT true,
     created_at        timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE UNIQUE INDEX IF NOT EXISTS members_name_key ON members (lower(name))`,

  // Small key/value bag: rotation pointer, setup flag. Values are jsonb so a
  // new setting never needs a schema change.
  `CREATE TABLE IF NOT EXISTS settings (
     key        text PRIMARY KEY,
     value      jsonb       NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,

  // One row per TMDB film, ever. Metadata is imported once and reused, so a
  // re-watch (or a roulette repeat) never re-types anything.
  `CREATE TABLE IF NOT EXISTS movies (
     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     tmdb_id       integer     NOT NULL UNIQUE,
     title         text        NOT NULL,
     year          integer,
     release_date  date,
     runtime_min   integer     CHECK (runtime_min IS NULL OR runtime_min >= 0),
     genres        jsonb       NOT NULL DEFAULT '[]'::jsonb,
     overview      text        NOT NULL DEFAULT '',
     poster_path   text,
     backdrop_path text,
     director      text,
     tmdb_rating   real,
     tmdb_votes    integer,
     created_at    timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS movie_nights (
     id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     movie_id          uuid        NOT NULL REFERENCES movies(id),
     selector_id       uuid        NOT NULL REFERENCES members(id),
     status            text        NOT NULL CHECK (status IN ('proposed','rejected','approved','watching','rating','complete')),
     proposed_at       timestamptz NOT NULL DEFAULT now(),
     approved_at       timestamptz,
     started_at        timestamptz,
     watched_at        timestamptz,
     completed_at      timestamptz,
     rotation_advanced boolean     NOT NULL DEFAULT false
   )`,

  // Only one night may be "in flight" at a time. This is what stops two phones
  // proposing simultaneously and what makes "the current movie" unambiguous.
  `CREATE UNIQUE INDEX IF NOT EXISTS movie_nights_one_active
     ON movie_nights ((true))
     WHERE status IN ('proposed','approved','watching','rating')`,
  `CREATE INDEX IF NOT EXISTS movie_nights_selector_idx ON movie_nights (selector_id)`,
  `CREATE INDEX IF NOT EXISTS movie_nights_completed_idx ON movie_nights (completed_at DESC)`,

  `CREATE TABLE IF NOT EXISTS movie_approvals (
     id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     night_id   uuid        NOT NULL REFERENCES movie_nights(id) ON DELETE CASCADE,
     member_id  uuid        NOT NULL REFERENCES members(id),
     decision   text        NOT NULL CHECK (decision IN ('approve','reject')),
     reason     text        CHECK (reason IS NULL OR length(reason) <= 200),
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (night_id, member_id)
   )`,

  // 1–10 in half points. The CHECK is what makes "one rating per person" and
  // "no 7.3" true regardless of what the UI sends.
  `CREATE TABLE IF NOT EXISTS ratings (
     id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     night_id   uuid        NOT NULL REFERENCES movie_nights(id) ON DELETE CASCADE,
     member_id  uuid        NOT NULL REFERENCES members(id),
     score      real        NOT NULL CHECK (score >= 1 AND score <= 10 AND score * 2 = floor(score * 2)),
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (night_id, member_id)
   )`,

  `CREATE TABLE IF NOT EXISTS reviews (
     id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     night_id   uuid        NOT NULL REFERENCES movie_nights(id) ON DELETE CASCADE,
     member_id  uuid        NOT NULL REFERENCES members(id),
     text       text        NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS reviews_night_idx ON reviews (night_id)`,

  `CREATE TABLE IF NOT EXISTS snack_items (
     id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     night_id   uuid        NOT NULL REFERENCES movie_nights(id) ON DELETE CASCADE,
     member_id  uuid        NOT NULL REFERENCES members(id),
     name       text        NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
     kind       text        NOT NULL CHECK (kind IN ('snack','drink')),
     note       text        CHECK (note IS NULL OR length(note) <= 140),
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS snack_items_night_idx ON snack_items (night_id)`,

  `CREATE TABLE IF NOT EXISTS snack_ratings (
     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     snack_item_id uuid        NOT NULL REFERENCES snack_items(id) ON DELETE CASCADE,
     member_id     uuid        NOT NULL REFERENCES members(id),
     score         integer     NOT NULL CHECK (score BETWEEN 1 AND 5),
     created_at    timestamptz NOT NULL DEFAULT now(),
     UNIQUE (snack_item_id, member_id)
   )`,

  `CREATE TABLE IF NOT EXISTS predictions (
     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     night_id    uuid        NOT NULL REFERENCES movie_nights(id) ON DELETE CASCADE,
     member_id   uuid        NOT NULL REFERENCES members(id),
     own_score   real        NOT NULL CHECK (own_score >= 1 AND own_score <= 10 AND own_score * 2 = floor(own_score * 2)),
     group_score real        CHECK (group_score IS NULL OR (group_score >= 1 AND group_score <= 10 AND group_score * 2 = floor(group_score * 2))),
     created_at  timestamptz NOT NULL DEFAULT now(),
     updated_at  timestamptz NOT NULL DEFAULT now(),
     UNIQUE (night_id, member_id)
   )`,

  // A proposal may carry several candidate films (cap in lib/constants.ts). With one candidate the
  // group approves or rejects; with more, everyone votes and the winner
  // becomes movie_nights.movie_id.
  `CREATE TABLE IF NOT EXISTS night_candidates (
     id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     night_id   uuid        NOT NULL REFERENCES movie_nights(id) ON DELETE CASCADE,
     movie_id   uuid        NOT NULL REFERENCES movies(id),
     position   integer     NOT NULL,
     UNIQUE (night_id, movie_id)
   )`,

  `CREATE TABLE IF NOT EXISTS night_votes (
     id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     night_id   uuid        NOT NULL REFERENCES movie_nights(id) ON DELETE CASCADE,
     member_id  uuid        NOT NULL REFERENCES members(id),
     movie_id   uuid        NOT NULL REFERENCES movies(id),
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (night_id, member_id)
   )`,

  // One shared running list of films the group wants to get to. A film drops
  // off automatically once a night with it completes.
  `CREATE TABLE IF NOT EXISTS wishlist (
     id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     movie_id   uuid        NOT NULL UNIQUE REFERENCES movies(id),
     added_by   uuid        NOT NULL REFERENCES members(id),
     note       text        CHECK (note IS NULL OR length(note) <= 140),
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
];
