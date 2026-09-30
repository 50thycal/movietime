/**
 * Streaming filters, the pick card's extras and "Pick like us", run through the
 * real /api/roulette handler against PGlite and a local TMDB stub.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { db } from "../lib/db";
import * as s from "../lib/server";
import { sourceStats } from "../lib/stats";
import { cleanServiceKeys, DEFAULT_SERVICE_KEYS, serviceKeyFor } from "../lib/streaming";
import { buildTasteModel, rankForSpin, scoreCandidate, seedFilms, weightedSample } from "../lib/taste";
import type { SpinResult } from "../lib/types";
import { makeTestDb, MOVIE } from "./helpers/pglite";

// ---------------------------------------------------------------- TMDB stub

const GENRES = [
  { id: 18, name: "Drama" },
  { id: 27, name: "Horror" },
  { id: 53, name: "Thriller" },
  { id: 35, name: "Comedy" },
];
const PROVIDERS = [
  { provider_id: 8, provider_name: "Netflix", logo_path: "/nf.png", display_priority: 1 },
  { provider_id: 1796, provider_name: "Netflix Standard with Ads", logo_path: "/nfa.png", display_priority: 2 },
  { provider_id: 15, provider_name: "Hulu", logo_path: "/hulu.png", display_priority: 3 },
  { provider_id: 2, provider_name: "Apple TV", logo_path: "/atv.png", display_priority: 4 },
  { provider_id: 1853, provider_name: "Paramount Plus Apple TV Channel ", logo_path: "/pc.png", display_priority: 5 },
  { provider_id: 350, provider_name: "Apple TV Plus", logo_path: "/atvp.png", display_priority: 6 },
];
const prov = (id: number) => PROVIDERS.find((p) => p.provider_id === id)!;

interface Film {
  id: number;
  title: string;
  year: number;
  genres: number[];
  runtime: number;
  rating: number;
  stream: number[];
  rent?: number[];
}
const FILMS: Film[] = [
  { id: 2001, title: "Slow Burn", year: 2015, genres: [53, 18], runtime: 105, rating: 7.9, stream: [15] },
  { id: 2002, title: "Rent Only", year: 2016, genres: [53], runtime: 100, rating: 8.1, stream: [], rent: [2] },
  { id: 2003, title: "Epic Thriller", year: 2014, genres: [53], runtime: 170, rating: 8.0, stream: [8] },
  { id: 2004, title: "Laugh Track", year: 2012, genres: [35], runtime: 88, rating: 6.8, stream: [350] },
  { id: 2005, title: "Night Terror", year: 2011, genres: [27], runtime: 92, rating: 7.0, stream: [8] },
];
const raw = (f: Film) => ({
  id: f.id,
  title: f.title,
  release_date: `${f.year}-06-01`,
  genre_ids: f.genres,
  overview: `${f.title} overview that is long enough to need a more button in the card.`,
  poster_path: `/${f.id}.jpg`,
  vote_average: f.rating,
  vote_count: 5000,
  popularity: 50,
});

const discoverCalls: URLSearchParams[] = [];
let server: Server;

function handle(url: URL): unknown {
  const p = url.pathname;
  if (p === "/genre/movie/list") return { genres: GENRES };
  if (p === "/watch/providers/movie") return { results: PROVIDERS };
  if (p === "/discover/movie") {
    discoverCalls.push(url.searchParams);
    const ids = (url.searchParams.get("with_watch_providers") ?? "").split("|").filter(Boolean).map(Number);
    const genre = Number(url.searchParams.get("with_genres")) || null;
    const maxRt = Number(url.searchParams.get("with_runtime.lte")) || Infinity;
    const hits = FILMS.filter((f) => (!ids.length || f.stream.some((x) => ids.includes(x))) && (!genre || f.genres.includes(genre)) && f.runtime <= maxRt);
    return { results: hits.map(raw), total_pages: hits.length ? 1 : 0 };
  }
  const rec = p.match(/^\/movie\/(\d+)\/recommendations$/);
  if (rec) return { results: FILMS.filter((f) => f.genres.includes(53)).map(raw) };
  const det = p.match(/^\/movie\/(\d+)$/);
  if (det) {
    const f = FILMS.find((x) => x.id === Number(det[1]));
    if (!f) return null;
    return {
      ...raw(f),
      runtime: f.runtime,
      genres: GENRES.filter((g) => f.genres.includes(g.id)),
      tagline: "  A tagline.  ",
      imdb_id: `tt${f.id}`,
      credits: {
        crew: [{ job: "Director", name: "Dee Rector" }],
        cast: [
          { name: "Second Billed", character: "B", profile_path: null, order: 1 },
          { name: "Top Billed", character: "A", profile_path: "/a.jpg", order: 0 },
        ],
      },
      videos: {
        results: [
          { key: "teaser", site: "YouTube", type: "Teaser", official: true, published_at: "2020-01-01" },
          { key: "fan", site: "YouTube", type: "Trailer", official: false, published_at: "2021-01-01" },
          { key: "official", site: "YouTube", type: "Trailer", official: true, published_at: "2019-01-01" },
          { key: "vimeo", site: "Vimeo", type: "Trailer", official: true },
        ],
      },
      release_dates: {
        results: [
          { iso_3166_1: "GB", release_dates: [{ certification: "15", type: 3 }] },
          { iso_3166_1: "US", release_dates: [{ certification: "", type: 1 }, { certification: "R", type: 3 }] },
        ],
      },
      "watch/providers": {
        results: {
          US: { link: `https://tmdb.test/${f.id}/watch`, flatrate: f.stream.map(prov), rent: (f.rent ?? []).map(prov) },
        },
      },
    };
  }
  return null;
}

let tmdb: typeof import("../lib/tmdb");
let roulette: typeof import("../app/api/roulette/route");

before(async () => {
  server = createServer((req, res) => {
    const body = handle(new URL(req.url!, "http://stub"));
    res.writeHead(body ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify(body ?? { status_message: "not found" }));
  });
  await new Promise<void>((r) => server.listen(0, r));
  process.env.TMDB_API_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.TMDB_API_KEY = "0123456789abcdef0123456789abcdef";
  // Imported late: the client reads TMDB_API_BASE at module load.
  tmdb = await import("../lib/tmdb");
  roulette = await import("../app/api/roulette/route");
  await makeTestDb();
});
after(async () => {
  server.close();
});

async function spin(query: string): Promise<{ status: number; body: SpinResult & { error?: string } }> {
  const res = await roulette.GET(new Request(`http://app/api/roulette?${query}`));
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------- pure pieces

test("streaming catalog: plan variants match, resold channels don't", () => {
  assert.equal(serviceKeyFor("Netflix Standard with Ads"), "netflix");
  assert.equal(serviceKeyFor("Peacock Premium Plus"), "peacock");
  assert.equal(serviceKeyFor("Paramount Plus Apple TV Channel "), null);
  assert.equal(serviceKeyFor("Amazon Video"), null, "the rental store is not Prime Video");
  assert.equal(serviceKeyFor("Amazon Prime Video with Ads"), "prime");
  assert.deepEqual(cleanServiceKeys(["hulu", "nope", "hulu", 3]), ["hulu"]);
});

test("extras: best trailer, US certification, billed cast, providers tagged", async () => {
  const { movie, extras } = await tmdb.movieWithExtras(2001);
  assert.equal(movie.runtime_min, 105);
  assert.equal(movie.director, "Dee Rector");
  assert.equal(extras.trailer_key, "official");
  assert.equal(extras.certification, "R");
  assert.equal(extras.tagline, "A tagline.");
  assert.deepEqual(extras.cast.map((c) => c.name), ["Top Billed", "Second Billed"]);
  assert.equal(extras.imdb_id, "tt2001");
  assert.deepEqual(extras.providers.stream.map((p) => [p.provider_name, p.service]), [["Hulu", "hulu"]]);
  assert.equal(extras.providers.link, "https://tmdb.test/2001/watch");
});

test("provider ids resolve by name, including ad tiers, excluding channels", async () => {
  assert.deepEqual((await tmdb.resolveProviderIds(["netflix"])).sort((x, y) => x - y), [8, 1796]);
  assert.deepEqual(await tmdb.resolveProviderIds([]), []);
});

test("taste model: shrunk genre affinity, liked seeds, reasons", () => {
  const mk = (tmdb_id: number, title: string, genres: number[], score: number, year = 2010) => ({
    night: { id: `n${tmdb_id}`, selector_id: "a" },
    movie: { tmdb_id, title, year, genres: GENRES.filter((g) => genres.includes(g.id)) },
    ratings: [{ member_id: "a", score }, { member_id: "b", score: score - 1 }],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {
    members: [{ id: "a", name: "Zoe" }, { id: "b", name: "Sam" }],
    nights: [mk(1, "Tense", [53], 9), mk(2, "Tenser", [53, 18], 8.5), mk(3, "Scary", [27], 4), mk(4, "Meh", [35], 6)],
  };
  const group = buildTasteModel(data, null);
  assert.equal(group.who, "the group");
  assert.ok(group.genres.get(53)! > 0.5, "thrillers are loved");
  assert.ok(group.genres.get(27)! < 0, "horror is not");
  // Shrinkage: one film can't produce a deviation as big as its own.
  assert.ok(Math.abs(group.genres.get(27)!) < Math.abs(3.5 - group.mean));

  const zoe = buildTasteModel(data, "a");
  assert.equal(zoe.who, "Zoe");
  assert.deepEqual(new Set(seedFilms(zoe, 3, () => 0.5).map((r) => r.title)), new Set(["Tense", "Tenser"]));

  const thriller = scoreCandidate(zoe, {
    movie: MOVIE({ tmdb_id: 9, title: "T", genres: [GENRES[2]], year: 2012, tmdb_rating: 8 }),
    recommended_by: [zoe.rated[0]],
  });
  const horror = scoreCandidate(zoe, { movie: MOVIE({ tmdb_id: 10, title: "H", genres: [GENRES[1]], year: 2012, tmdb_rating: 8 }), recommended_by: [] });
  assert.ok(thriller.score > horror.score);
  assert.ok(thriller.reasons.some((r) => r.includes("Fans of Tense") && r.includes("Zoe gave it 9")));
  assert.ok(thriller.reasons.some((r) => r.startsWith("Thriller rates +")));
  assert.equal(rankForSpin([horror, thriller], 0.6, () => 0)[0].movie.title, "T", "rand=0 takes the heaviest weight first");
});

test("weightedSample draws without replacement and respects weights", () => {
  const xs = ["a", "b", "c"];
  assert.deepEqual(weightedSample(xs, () => 1, 5, () => 0).sort(), ["a", "b", "c"]);
  assert.equal(weightedSample(xs, (x) => (x === "c" ? 100 : 0), 1, () => 0.5)[0], "c");
});

// ---------------------------------------------------------------- through the route

test("streaming settings default to the group's services and can be changed", async () => {
  const sql = await db();
  assert.deepEqual((await s.getStreaming(sql)).services, DEFAULT_SERVICE_KEYS);
  assert.deepEqual((await s.setStreaming(sql, ["hulu", "bogus"])).services, ["hulu"]);
  assert.deepEqual((await s.setStreaming(sql, [])).services, [], "an explicit empty list sticks");
  await assert.rejects(s.setStreaming(sql, "hulu"), /list/);
});

test("roulette: spin is hydrated with runtime + extras, and service filter reaches TMDB", async () => {
  discoverCalls.length = 0;
  const { status, body } = await spin("mode=movie&services=netflix&min_rating=5");
  assert.equal(status, 200, body.error);
  assert.ok(body.movie!.runtime_min, "runtime is filled in (discover doesn't carry it)");
  assert.ok(body.extras!.providers.stream.some((p) => p.service === "netflix"));
  const q = discoverCalls[0];
  assert.equal(q.get("watch_region"), "US");
  assert.equal(q.get("with_watch_providers")!.split("|").sort().join("|"), "1796|8");
  assert.equal(q.get("with_watch_monetization_types"), "flatrate|free|ads");
});

test("pick like us: needs history, then respects runtime, services and watched", async () => {
  const sql = await db();
  const [a, b] = await s.setupMembers(sql, ["Zoe", "Sam", "Jo"]);
  const early = await spin("mode=taste&for=group");
  assert.equal(early.status, 400);
  assert.match(early.body.error!, /at least 3 rated/);

  const watch = (tmdb_id: number, title: string, genres: typeof GENRES, sa: number, sb: number) =>
    s.backfillNight(sql, a.id, MOVIE({ tmdb_id, title, genres, year: 2015 }), a.id, new Date("2025-01-01T20:00:00Z"), [
      { member_id: a.id, score: sa },
      { member_id: b.id, score: sb },
    ]);
  await watch(1, "Loved Thriller", [GENRES[2]], 9.5, 9);
  await watch(2, "Good Drama", [GENRES[0]], 8, 8);
  await watch(3, "Bad Horror", [GENRES[1]], 3, 4);
  await watch(2005, "Night Terror", [GENRES[1]], 5, 5); // already seen → never suggested

  for (let i = 0; i < 8; i++) {
    const { status, body } = await spin("mode=taste&for=group&services=hulu,netflix&max_runtime=150&min_rating=6");
    assert.equal(status, 200, body.error);
    assert.notEqual(body.movie!.tmdb_id, 2005, "watched films are excluded");
    assert.notEqual(body.movie!.tmdb_id, 2002, "rent-only fails the services filter");
    assert.notEqual(body.movie!.tmdb_id, 2003, "170 minutes fails the runtime filter");
    assert.ok(body.extras!.providers.stream.some((p) => ["hulu", "netflix"].includes(p.service!)));
    assert.ok(body.reasons!.length > 0);
  }

  const forZoe = await spin(`mode=taste&for=${a.id}&min_rating=6`);
  assert.equal(forZoe.status, 200, forZoe.body.error);
  assert.equal(forZoe.body.for_member, a.id);
});

test("a proposal remembers where it came from, and stats split by it", async () => {
  const sql = await db();
  const current = (await s.loadHomeState(sql, null)).rotation.current!;
  await assert.rejects(s.proposeMovies(sql, current.id, [MOVIE({ tmdb_id: 7777 })], "bogus" as never), /Unknown source/);
  const night = await s.proposeMovies(sql, current.id, [MOVIE({ tmdb_id: 7777, title: "Tasteful" })], "taste");
  assert.equal(night.night.source, "taste");
  const stats = sourceStats(await s.loadDataset(sql));
  assert.deepEqual(
    stats.map((x) => x.source),
    ["taste", "roulette", "search"],
  );
  assert.equal(stats.find((x) => x.source === "search")!.count, 4, "older nights count as searched");
});
