# 🎬 MovieTime

A private, mobile-first app for a group of friends who take turns picking
movies. It answers the questions that come up every movie night:

whose turn is it · what did they pick · has everyone approved it · what did
we all rate it · who picks the best movies · who brings the best snacks ·
what have we watched · what should we watch when nobody has an idea.

The central loop needs very few taps:

> Person's turn → pick a movie → group approves → watch → everyone rates
> (hidden) → reveal → next person's turn.

Everything else (snacks, reviews, predictions, awards, stats) hangs off that
loop and never blocks it.

## Stack

| Layer     | Choice                                    | Why |
|-----------|-------------------------------------------|-----|
| Framework | Next.js 15 (App Router) + React 19 + TS   | One deployable: API routes and UI in the same repo |
| Styling   | Tailwind CSS v4                           | No config file; design tokens live in `app/globals.css` |
| Data      | Postgres via `@neondatabase/serverless`   | Real SQL over HTTP, no connection pool to babysit in serverless |
| Fetching  | SWR, 8s polling + revalidate on focus     | Four phones on a couch stay in sync without websockets |
| Metadata  | TMDB v3 API (server-side only)            | Search, details (runtime, director, genres), discovery for roulette |
| Host      | Vercel                                    | — |

This mirrors the architecture of `baby_baby`: a lazily-created idempotent
schema, thin API routes over a shared server module, and SWR on the client.

There is no login. Each phone answers "Who are you?" once and remembers the
answer in `localStorage`; that is the **only** thing stored locally. All
shared state lives in Postgres. It's private-by-URL, exactly as specced.

## Deploying to Vercel

1. **Import the repo** at vercel.com → Add New → Project. Framework is
   auto-detected as Next.js; no `vercel.json` settings are needed beyond the
   one included.
2. **Add a database**: in the project, Storage → Create Database → **Neon**
   → Connect. This injects `DATABASE_URL` (and the `_UNPOOLED` variant)
   automatically. The app creates its own tables on the first request; there
   is no migration step.
3. **Add the TMDB key**: Settings → Environment Variables →
   `TMDB_API_KEY`. Get a free key at
   <https://www.themoviedb.org/settings/api>. Either the v3 "API Key" or the
   v4 "API Read Access Token" works.
4. **Deploy** (or redeploy after adding the variables so they reach the
   build).
5. Open the URL on a phone, enter the four names in picking order, and
   you're in normal operation. Add it to the home screen — it ships a
   manifest and is designed for standalone iPhone Safari.

### Environment variables

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | yes | Postgres connection string. `POSTGRES_URL`, `DATABASE_URL_UNPOOLED` and `POSTGRES_URL_NON_POOLING` are accepted as fallbacks, so any way Vercel attaches Neon works. |
| `TMDB_API_KEY` | yes | Server-side only; never reaches the browser. |
| `MOVIETIME_LOCAL_DB` | dev only | Set to `pglite` to run an embedded Postgres in `.pglite/` when no database URL is set. |
| `TMDB_API_BASE` | test only | Points the TMDB client at a stub. |

See `.env.example`. Never commit `.env.local`.

## Local development

```bash
cp .env.example .env.local     # fill in DATABASE_URL and TMDB_API_KEY
npm install
npm run dev
```

No Neon account handy? Run with an embedded database instead:

```bash
MOVIETIME_LOCAL_DB=pglite TMDB_API_KEY=... npm run dev
```

Other scripts: `npm run build`, `npm run typecheck`, `npm run lint`,
`npm test`, `npm run db:setup` (applies the schema to `DATABASE_URL`; optional).

## How it works

### Lifecycle

```
proposed ──(everyone else approves)──▶ approved ──(Start)──▶ watching ──(Movie's over)──▶ rating ──(last rating in)──▶ complete
    │
    └──(any rejection / withdraw)──▶ rejected   (selector keeps the turn, picks again)
```

- Only the member the rotation points at can propose. Rejections carry an
  optional reason. Roulette results are only proposed when someone taps
  **Accept**.
- Ratings are 1–10 in half points. Each person sees only their own score
  until every active member has rated; then all scores reveal at once with
  group average, high, low, spread, the picker's score, the average without
  the picker, and the picker-vs-group delta.
- The last rating completes the night and advances the rotation. This
  happens through one guarded `UPDATE … WHERE status = 'rating' AND
  rotation_advanced = false`, so two phones submitting simultaneously cannot
  move the turn twice.
- Predictions (own score, optional group average) are open while a movie is
  proposed or approved and lock when it starts.
- Reviews, snacks and snack ratings can be added any time after the night
  exists, including well after it completes.

### Shared state

Every write goes to Postgres, returns the canonical updated record, and the
client then revalidates every `/api/*` key (`refreshAll` in `lib/api.ts`).
Other phones pick the change up on the next 8-second poll or on refocus.

### Data integrity

Database constraints enforce the important rules, not just the UI:

- One rating / approval / prediction per member per night (`UNIQUE`).
- One snack rating per member per item.
- Scores must be whole or half points (`CHECK (score * 2 = floor(score * 2))`).
- Only one night may be in flight at a time (partial unique index on active
  statuses), so a movie can never reach history without a night.
- Completing and advancing is idempotent (see above).
- Only the author can edit or delete their review/snack (`WHERE member_id = me`).

### Database schema

Defined in `lib/schema.ts`; every statement is `IF NOT EXISTS` and runs on
cold start.

| Table | Purpose |
|-------|---------|
| `members` | name, colour, emoji, rotation position, active flag |
| `settings` | key/value jsonb: `rotation` → current member, `setup_complete` |
| `movies` | one row per TMDB film: title, year, runtime, genres (jsonb), overview, poster, director, TMDB rating |
| `movie_nights` | movie + selector + status + lifecycle timestamps |
| `movie_approvals` | approve/reject per member per night, optional reason |
| `ratings` | 1–10 half-point score per member per night |
| `reviews` | short text per member per night (editable/deletable by author) |
| `snack_items` | item, kind (snack/drink), who brought it, note |
| `snack_ratings` | 1–5 per member per item |
| `predictions` | own score + optional group average per member per night |

Awards are derived from this data on read rather than stored, so a season
summary is always consistent with the underlying ratings.

### Statistics (`lib/stats.ts`, pure functions)

Picker score (mean group rating of picks), critic averages, contrarian
(mean distance from others), pairwise similarity (mean abs difference and
Pearson on films both rated, min 3), genre stats for group and per member
with outliers, runtime stats, snack stats, prediction accuracy/streaks,
taste profile, and per-night awards (best/worst pick, crowd pleaser, most
divisive, best snacks/drinks, most accurate predictor, longest commitment).
Awards are only given when the data supports them.

### Screens

- **Tonight** — big "Up Next" card, current movie with runtime/genres and
  approval status, one context-sensitive action (Pick / Approve / Start /
  Rate / waiting), rotation strip, last movie with group score, roulette.
- **History** — poster grid with selector, runtime, genres, group rating;
  filters by picker, genre, runtime bucket, rating, year watched, release
  decade; sort newest/oldest/highest/lowest/longest/shortest.
- **Movie** — full record: metadata, revealed scores and breakdown, awards,
  prediction results, review thread, snacks with 1–5 stars.
- **Roulette** — random genre, random movie, or both, with runtime/era/rating
  filters; already-watched films are always excluded; only the person whose
  turn it is can Accept.
- **Stats** — leaderboard (best picker, snack/drink champion, toughest and
  easiest critic, contrarian, movie twins, runtime criminal, award cabinet),
  picker profiles, "Our Taste", genres, extras.
- **Settings** — switch person on this phone, override whose turn it is,
  rename/recolour/reorder/bench members.

## Tests

```bash
npm test
```

- `tests/domain.test.ts` — rotation, approvals, hidden-until-complete,
  aggregation, picker score, critics/similarity, genre stats, prediction
  scoring, awards, taste profile, roulette exclusion, runtime formatting,
  TMDB normalisation.
- `tests/lifecycle.test.ts` — the full night lifecycle against a real
  Postgres (PGlite in-process): setup, turn enforcement, single-active-night
  index, approval threshold, prediction locking, duplicate-rating and
  half-point constraints, reveal, rotation advancing exactly once, history,
  reviews, snacks, rejection keeping the turn, manual rotation override.

## Known limitations

- No authentication: anyone with the URL can act as anyone. Fine for a
  private group link; add Vercel password protection if that's a concern.
- TMDB is required for search and roulette. If it's down, existing nights
  still work.
- Poll-based sync (8s). Good enough for a couch; not instant.
- Similarity/twins need at least three films both people rated.
