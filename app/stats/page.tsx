"use client";

import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/Shell";
import { Avatar, Empty, ErrorNote, Poster, Spinner } from "@/components/ui";
import { useStats } from "@/lib/api";
import { fmtRuntime, fmtScore } from "@/lib/format";
import { AWARD_META, type AwardKey } from "@/lib/stats";
import type { Member } from "@/lib/types";

type Tab = "board" | "pickers" | "taste" | "genres" | "extras";

export default function StatsPage() {
  const { data, error } = useStats();
  const { members } = useApp();
  const [tab, setTab] = useState<Tab>("board");
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;
  const m = (id: string | null | undefined) => members.find((x) => x.id === id);

  if (data.nights === 0) {
    return <Empty title="No stats yet" body="Stats appear after the first completed movie night. Then they get weirder every week." />;
  }

  return (
    <div className="flex flex-col gap-3 pt-1">
      <h1 className="text-2xl font-black">
        Stats <span className="text-base text-muted">
          {data.nights} night{data.nights === 1 ? "" : "s"}
        </span>
      </h1>
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
        {(
          [
            ["board", "🏆 Leaderboard"],
            ["pickers", "🎬 Pickers"],
            ["taste", "🧠 Our Taste"],
            ["genres", "🎭 Genres"],
            ["extras", "🍿 Extras"],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} className={`chip ${tab === k ? "chip-on" : ""}`} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === "board" && <Leaderboard data={data} m={m} />}
      {tab === "pickers" && <Pickers data={data} m={m} />}
      {tab === "taste" && <Taste data={data} m={m} />}
      {tab === "genres" && <Genres data={data} m={m} />}
      {tab === "extras" && <Extras data={data} m={m} />}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
type Lookup = (id: string | null | undefined) => Member | undefined;

function Trophy({ emoji, title, member, value, sub }: { emoji: string; title: string; member?: Member; value?: string; sub?: string }) {
  return (
    <div className="card flex items-center gap-3 p-3">
      <span className="text-3xl">{emoji}</span>
      <div className="min-w-0 flex-1">
        <div className="label">{title}</div>
        <div className="flex items-center gap-2 font-black">
          {member ? (
            <>
              <Avatar member={member} size={22} /> {member.name}
            </>
          ) : (
            <span className="text-muted">Not enough data yet</span>
          )}
        </div>
        {sub && <div className="text-xs text-muted">{sub}</div>}
      </div>
      {value && <div className="text-2xl font-black text-gold">{value}</div>}
    </div>
  );
}

function Leaderboard({ data, m }: { data: Any; m: Lookup }) {
  const lb = data.leaderboards;
  const twins = lb.movie_twins;
  return (
    <div className="flex flex-col gap-2">
      <div className="card p-3">
        <div className="label mb-2">Best movie picker</div>
        {lb.best_picker.length === 0 && <div className="text-sm text-muted">No completed picks yet.</div>}
        {lb.best_picker.map((p: Any, i: number) => (
          <div key={p.member_id} className="flex items-center gap-2 py-1.5">
            <span className="w-6 text-center text-lg">{["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`}</span>
            <Avatar member={m(p.member_id)} size={28} />
            <span className="flex-1 font-black">{m(p.member_id)?.name}</span>
            <span className="text-xs text-muted">{p.picks} pick{p.picks === 1 ? "" : "s"}</span>
            <span className="w-12 text-right text-xl font-black text-gold">{fmtScore(p.score)}</span>
          </div>
        ))}
      </div>
      <Trophy emoji="🍿" title="Snack champion" member={m(lb.snack_champion?.member_id)} value={lb.snack_champion ? `${fmtScore(lb.snack_champion.average)}/5` : undefined} />
      <Trophy emoji="🍸" title="Drink champion" member={m(lb.drink_champion?.member_id)} value={lb.drink_champion ? `${fmtScore(lb.drink_champion.average)}/5` : undefined} />
      <Trophy emoji="🧊" title="Toughest critic" member={m(lb.toughest_critic?.member_id)} value={fmtScore(lb.toughest_critic?.average)} sub="Lowest average rating given" />
      <Trophy emoji="🧸" title="Easiest critic" member={m(lb.easiest_critic?.member_id)} value={fmtScore(lb.easiest_critic?.average)} sub="Highest average rating given" />
      <Trophy emoji="🙃" title="Contrarian" member={m(lb.contrarian?.member_id)} value={lb.contrarian ? `±${fmtScore(lb.contrarian.score)}` : undefined} sub="Furthest from the group on average" />
      <div className="card flex items-center gap-3 p-3">
        <span className="text-3xl">👯</span>
        <div className="flex-1">
          <div className="label">Movie twins</div>
          {twins ? (
            <div className="flex items-center gap-2 font-black">
              <Avatar member={m(twins.a)} size={22} /> {m(twins.a)?.name} &amp; <Avatar member={m(twins.b)} size={22} /> {m(twins.b)?.name}
            </div>
          ) : (
            <span className="text-muted">Needs 3 movies both have rated</span>
          )}
          {twins && (
            <div className="text-xs text-muted">
              avg {fmtScore(twins.mean_abs_diff)} apart over {twins.shared} movies{twins.correlation != null && ` · r=${twins.correlation}`}
            </div>
          )}
        </div>
      </div>
      <Trophy emoji="🚔" title="Runtime criminal" member={m(lb.runtime_criminal?.member_id)} value={lb.runtime_criminal ? fmtRuntime(lb.runtime_criminal.average) : undefined} sub="Longest picks on average" />
      <AwardTotals data={data} m={m} />
    </div>
  );
}

function AwardTotals({ data, m }: { data: Any; m: Lookup }) {
  if (!data.awards?.length) return null;
  const byMember = new Map<string, Any[]>();
  for (const a of data.awards) byMember.set(a.member_id, [...(byMember.get(a.member_id) ?? []), a]);
  return (
    <div className="card p-3">
      <div className="label mb-2">Award cabinet</div>
      {[...byMember].map(([id, awards]) => (
        <div key={id} className="flex items-center gap-2 py-1.5">
          <Avatar member={m(id)} size={26} />
          <span className="w-16 truncate font-black">{m(id)?.name}</span>
          <div className="flex flex-wrap gap-1">
            {awards.map((a: Any) => (
              <span key={a.key} className="chip" title={AWARD_META[a.key as AwardKey]?.label}>
                {AWARD_META[a.key as AwardKey]?.emoji} ×{a.count}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Pickers({ data, m }: { data: Any; m: Lookup }) {
  return (
    <div className="flex flex-col gap-2">
      {data.pickers.map((p: Any) => {
        const mem = m(p.member_id);
        return (
          <div key={p.member_id} className="card p-3" style={{ borderColor: mem?.color }}>
            <div className="flex items-center gap-3">
              <Avatar member={mem} size={40} />
              <div className="flex-1">
                <div className="text-lg font-black">{mem?.name}</div>
                <div className="text-xs text-muted">
                  {p.movies_selected} pick{p.movies_selected === 1 ? "" : "s"} · {p.winners} winner{p.winners === 1 ? "" : "s"}
                </div>
              </div>
              <div className="text-right">
                <div className="label">Picker score</div>
                <div className="text-3xl font-black text-gold">{fmtScore(p.picker_score)}</div>
              </div>
            </div>
            {p.movies_selected > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-bg-2 p-2">
                  <div className="text-muted">Best pick</div>
                  {p.highest_pick && (
                    <Link href={`/movie/${p.highest_pick.night_id}`} className="font-bold">
                      {p.highest_pick.title} · {fmtScore(p.highest_pick.average)}
                    </Link>
                  )}
                </div>
                <div className="rounded-lg bg-bg-2 p-2">
                  <div className="text-muted">Worst pick</div>
                  {p.lowest_pick && (
                    <Link href={`/movie/${p.lowest_pick.night_id}`} className="font-bold">
                      {p.lowest_pick.title} · {fmtScore(p.lowest_pick.average)}
                    </Link>
                  )}
                </div>
                <div className="rounded-lg bg-bg-2 p-2">
                  <div className="text-muted">Avg runtime</div>
                  <div className="font-bold">{fmtRuntime(p.average_runtime)}</div>
                </div>
                <div className="rounded-lg bg-bg-2 p-2">
                  <div className="text-muted">Goes for</div>
                  <div className="font-bold">{p.genre_distribution.slice(0, 3).map((g: Any) => g.genre).join(", ") || "—"}</div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Taste({ data, m }: { data: Any; m: Lookup }) {
  const t = data.taste;
  const rt = data.runtime;
  const Pair = ({ s, label }: { s: Any; label: string }) =>
    s ? (
      <div className="rounded-lg bg-bg-2 p-2 text-xs">
        <div className="text-muted">{label}</div>
        <div className="flex items-center gap-1 font-bold">
          <Avatar member={m(s.a)} size={16} /> {m(s.a)?.name} &amp; <Avatar member={m(s.b)} size={16} /> {m(s.b)?.name}
          <span className="ml-auto text-muted">±{fmtScore(s.mean_abs_diff)}</span>
        </div>
      </div>
    ) : null;
  const Row = ({ title, xs }: { title: string; xs: Any[] }) => (
    <div>
      <div className="label mb-1">{title}</div>
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {xs.map((x) => (
          <Link key={x.night_id} href={`/movie/${x.night_id}`} className="w-20 shrink-0">
            <Poster path={x.poster_path} title={x.title} size="w185" />
            <div className="mt-1 truncate text-[11px] font-bold">{x.title}</div>
            <div className="text-[11px] text-gold">{fmtScore(x.average)}</div>
          </Link>
        ))}
      </div>
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="card flex flex-col gap-3 p-3">
        <div className="label">Our taste</div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Consensus" value={t.consensus_score == null ? "—" : `±${fmtScore(t.consensus_score)}`} sub="avg spread" />
          <Stat label="Avg runtime" value={fmtRuntime(t.average_runtime)} />
          <Stat label="Fav decade" value={t.favorite_decades[0]?.decade ?? "—"} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {t.favorite_genres.map((g: Any) => (
            <span key={g.genre} className="chip chip-on">
              {g.genre} {fmtScore(g.average)}
            </span>
          ))}
        </div>
        {t.most_divisive_genre && (
          <div className="text-xs text-muted">
            Most divisive genre: <b className="text-ink">{t.most_divisive_genre.genre}</b> (±{fmtScore(t.most_divisive_genre.spread)})
          </div>
        )}
        <Pair s={t.most_similar} label="Most similar taste" />
        <Pair s={t.least_similar} label="Least similar taste" />
      </div>
      <Row title="Highest rated" xs={t.highest_rated} />
      <Row title="Lowest rated" xs={t.lowest_rated} />
      <div className="card p-3">
        <div className="label mb-1">Runtime</div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Average" value={fmtRuntime(rt.average)} />
          <Stat label="Longest" value={fmtRuntime(rt.longest?.runtime_min)} sub={rt.longest?.title} />
          <Stat label="Shortest" value={fmtRuntime(rt.shortest?.runtime_min)} sub={rt.shortest?.title} />
        </div>
      </div>
      {t.favorite_decades.length > 0 && (
        <div className="card p-3">
          <div className="label mb-1">Decades</div>
          {t.favorite_decades.map((d: Any) => (
            <Bar key={d.decade} label={d.decade} value={d.average} count={d.count} />
          ))}
        </div>
      )}
    </div>
  );
}

function Genres({ data, m }: { data: Any; m: Lookup }) {
  const [who, setWho] = useState<string | null>(null);
  const mine = data.member_genres.find((g: Any) => g.member_id === who);
  const rows: Any[] = who ? mine?.genres ?? [] : data.group_genres;
  return (
    <div className="flex flex-col gap-3">
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
        <button className={`chip ${who == null ? "chip-on" : ""}`} onClick={() => setWho(null)}>
          Group
        </button>
        {data.members.map((mem: Member) => (
          <button key={mem.id} className={`chip ${who === mem.id ? "chip-on" : ""}`} onClick={() => setWho(mem.id)}>
            <Avatar member={mem} size={16} /> {mem.name}
          </button>
        ))}
      </div>
      {mine && (
        <div className="card p-3 text-sm">
          <div>
            Favorite: <b>{mine.favorite?.genre ?? "—"}</b> {mine.favorite && `(${fmtScore(mine.favorite.average)})`} · Least: <b>{mine.least_favorite?.genre ?? "—"}</b>{" "}
            {mine.least_favorite && `(${fmtScore(mine.least_favorite.average)})`}
          </div>
          {mine.outliers.length > 0 && (
            <div className="mt-1 text-xs text-muted">
              {m(who)?.name} vs group:{" "}
              {mine.outliers.map((o: Any) => (
                <span key={o.genre} className="chip mr-1">
                  {o.genre} {o.delta > 0 ? "+" : ""}
                  {fmtScore(o.delta)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="card p-3">
        {rows.length === 0 && <div className="text-sm text-muted">No ratings yet.</div>}
        {rows.map((g: Any) => (
          <Bar key={g.genre} label={g.genre} value={g.average} count={g.count} />
        ))}
      </div>
    </div>
  );
}

function Extras({ data, m }: { data: Any; m: Lookup }) {
  const s = data.snacks;
  const p = data.predictions;
  const fi = data.first_impressions;
  return (
    <div className="flex flex-col gap-2">
      <FirstImpressionBlock fi={fi} m={m} />
      <div className="card p-3">
        <div className="label mb-2">Snacks &amp; drinks</div>
        {s.total_items === 0 && <div className="text-sm text-muted">Nothing logged yet.</div>}
        {s.best_snack && <Line k="Best snack" v={`${s.best_snack.name} (${fmtScore(s.best_snack.average)}/5)`} who={m(s.best_snack.member_id)} />}
        {s.best_drink && <Line k="Best drink" v={`${s.best_drink.name} (${fmtScore(s.best_drink.average)}/5)`} who={m(s.best_drink.member_id)} />}
        {s.best_snack_provider && <Line k="Snack provider" v={`${fmtScore(s.best_snack_provider.average)}/5 over ${s.best_snack_provider.items}`} who={m(s.best_snack_provider.member_id)} />}
        {s.best_drink_provider && <Line k="Drink provider" v={`${fmtScore(s.best_drink_provider.average)}/5 over ${s.best_drink_provider.items}`} who={m(s.best_drink_provider.member_id)} />}
        {s.most_frequent && <Line k="Most brought" v={`${s.most_frequent.name} ×${s.most_frequent.count}`} />}
      </div>
      <div className="card p-3">
        <div className="label mb-2">Predictions</div>
        {p.per_member.every((x: Any) => x.predictions === 0) && <div className="text-sm text-muted">Nobody has called a shot yet.</div>}
        {p.per_member
          .filter((x: Any) => x.predictions > 0)
          .sort((a: Any, b: Any) => a.mean_own_error - b.mean_own_error)
          .map((x: Any) => (
            <div key={x.member_id} className="flex items-center gap-2 py-1 text-sm">
              <Avatar member={m(x.member_id)} size={22} />
              <span className="flex-1 font-bold">{m(x.member_id)?.name}</span>
              <span className="text-xs text-muted">{x.predictions} calls · streak {x.streak}</span>
              <span className="font-black text-gold">±{fmtScore(x.mean_own_error)}</span>
            </div>
          ))}
        {p.biggest_surprise && (
          <Line k="Biggest surprise" v={`${p.biggest_surprise.title}: called ${fmtScore(p.biggest_surprise.predicted)}, gave ${fmtScore(p.biggest_surprise.actual)}`} who={m(p.biggest_surprise.member_id)} />
        )}
        {p.most_exceeded && <Line k="Exceeded expectations" v={`${p.most_exceeded.title}: ${fmtScore(p.most_exceeded.predicted)} → ${fmtScore(p.most_exceeded.actual)}`} />}
        {p.most_disappointed && <Line k="Disappointed" v={`${p.most_disappointed.title}: ${fmtScore(p.most_disappointed.predicted)} → ${fmtScore(p.most_disappointed.actual)}`} />}
      </div>
    </div>
  );
}

/**
 * Does the ten-minute verdict actually predict the final score? The headline
 * is a correlation across every (snap, final) pair the group has produced.
 */
function FirstImpressionBlock({ fi, m }: { fi: Any; m: Lookup }) {
  if (!fi) return null;
  const r = fi.correlation as number | null;
  const verdict =
    r == null
      ? "Not enough ten-minute verdicts yet — give a few and this fills in."
      : r >= 0.8
        ? "Strong. Ten minutes is enough to call it."
        : r >= 0.5
          ? "Real, but loose. The first ten minutes get you most of the way."
          : r >= 0.2
            ? "Weak. The snap verdict is barely better than a guess."
            : r >= -0.2
              ? "None at all. What you think at ten minutes says nothing about the end."
              : "Inverted — whatever the room thinks early, the opposite happens.";
  return (
    <div className="card p-3">
      <div className="label mb-2">⏱ Ten-minute verdict vs final score</div>
      {fi.pairs === 0 ? (
        <div className="text-sm text-muted">Nobody has given a ten-minute verdict yet. They&apos;re taken while the movie plays.</div>
      ) : (
        <>
          <div className="flex items-end gap-3">
            <div className="shrink-0">
              {r == null ? (
                <div className="text-lg font-black text-muted">Not yet</div>
              ) : (
                <div className="text-4xl font-black text-gold">{r.toFixed(2)}</div>
              )}
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                correlation · {fi.pairs} pair{fi.pairs === 1 ? "" : "s"}
              </div>
            </div>
            <p className="flex-1 text-xs text-muted">{verdict}</p>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat label="Typical change" value={fi.mean_abs_change == null ? "—" : `±${fmtScore(fi.mean_abs_change)}`} />
            <Stat
              label="Drift"
              value={fi.mean_drift == null ? "—" : `${fi.mean_drift > 0 ? "+" : ""}${fmtScore(fi.mean_drift)}`}
              sub={fi.mean_drift > 0 ? "films grow on us" : fi.mean_drift < 0 ? "films wear off" : undefined}
            />
            <Stat label="Called it" value={fi.within_half_point == null ? "—" : `${Math.round(fi.within_half_point)}%`} sub="within ½ point" />
          </div>
          {fi.sharpest && <Line k="Sharpest read" v={`changes by only ${fmtScore(fi.sharpest.mean_abs_change)} on average`} who={m(fi.sharpest.member_id)} />}
          {fi.biggest_riser && (
            <Line k="Grew on us most" v={`${fi.biggest_riser.title}: ${fmtScore(fi.biggest_riser.first)} → ${fmtScore(fi.biggest_riser.final)}`} />
          )}
          {fi.biggest_faller && (
            <Line k="Wore off most" v={`${fi.biggest_faller.title}: ${fmtScore(fi.biggest_faller.first)} → ${fmtScore(fi.biggest_faller.final)}`} />
          )}
          <div className="mt-2 flex flex-col gap-1">
            {fi.per_member
              .filter((x: Any) => x.pairs > 0)
              .sort((a: Any, b: Any) => (a.mean_abs_change ?? 99) - (b.mean_abs_change ?? 99))
              .map((x: Any) => (
                <div key={x.member_id} className="flex items-center gap-2 text-sm">
                  <Avatar member={m(x.member_id)} size={20} />
                  <span className="flex-1 font-bold">{m(x.member_id)?.name}</span>
                  <span className="text-xs text-muted">
                    {x.pairs} · drift {x.mean_drift > 0 ? "+" : ""}
                    {fmtScore(x.mean_drift)}
                  </span>
                  <span className="font-black text-gold">±{fmtScore(x.mean_abs_change)}</span>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-bg-2 p-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">{label}</div>
      <div className="text-lg font-black">{value}</div>
      {sub && <div className="truncate text-[10px] text-muted">{sub}</div>}
    </div>
  );
}

function Line({ k, v, who }: { k: string; v: string; who?: Member }) {
  return (
    <div className="flex items-center gap-2 py-1 text-sm">
      <span className="w-28 shrink-0 text-xs text-muted">{k}</span>
      <span className="min-w-0 flex-1 truncate font-bold">{v}</span>
      {who && <Avatar member={who} size={20} />}
    </div>
  );
}

function Bar({ label, value, count }: { label: string; value: number | null; count: number }) {
  const pct = value == null ? 0 : (value / 10) * 100;
  return (
    <div className="flex items-center gap-2 py-1 text-sm">
      <span className="w-28 truncate font-bold">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-2">
        <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right font-black">{fmtScore(value)}</span>
      <span className="w-6 text-right text-xs text-muted">×{count}</span>
    </div>
  );
}
