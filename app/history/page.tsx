"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useApp } from "@/components/Shell";
import { Avatar, Empty, ErrorNote, Poster, Spinner } from "@/components/ui";
import { send, useHistory, useWishlist } from "@/lib/api";
import { BackfillSheet, WishlistAddSheet } from "@/components/sheets";
import { useSearchParams } from "next/navigation";
import { decadeOf, fmtDate, fmtRuntime, fmtScore, RUNTIME_BUCKETS, runtimeBucket } from "@/lib/format";

const SORTS = [
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "highest", label: "Highest rated" },
  { key: "lowest", label: "Lowest rated" },
  { key: "longest", label: "Longest" },
  { key: "shortest", label: "Shortest" },
] as const;

export default function HistoryPage() {
  return (
    <Suspense>
      <HistoryInner />
    </Suspense>
  );
}

function HistoryInner() {
  const params = useSearchParams();
  const [tab, setTab] = useState<"watched" | "wishlist">(params.get("tab") === "wishlist" ? "wishlist" : "watched");
  const { data, error } = useHistory();
  const { data: wishlist } = useWishlist();
  const { members } = useApp();
  const [selector, setSelector] = useState<string | null>(null);
  const [genre, setGenre] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [minRating, setMinRating] = useState<number | null>(null);
  const [runtime, setRuntime] = useState<string | null>(null);
  const [decade, setDecade] = useState<string | null>(null);
  const [sort, setSort] = useState<(typeof SORTS)[number]["key"]>("newest");
  const [showFilters, setShowFilters] = useState(false);
  const [adding, setAdding] = useState(false);

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const genres = useMemo(() => [...new Set(entries.flatMap((e) => e.movie.genres.map((g) => g.name)))].sort(), [entries]);
  const years = useMemo(() => [...new Set(entries.map((e) => new Date(e.night.completed_at!).getFullYear()))].sort((a, b) => b - a), [entries]);
  const decades = useMemo(() => [...new Set(entries.map((e) => decadeOf(e.movie.year)).filter(Boolean) as string[])].sort(), [entries]);

  const shown = useMemo(() => {
    let xs = entries.filter(
      (e) =>
        (!selector || e.selector_id === selector) &&
        (!genre || e.movie.genres.some((g) => g.name === genre)) &&
        (!year || new Date(e.night.completed_at!).getFullYear() === year) &&
        (minRating == null || (e.group_avg ?? 0) >= minRating) &&
        (!runtime || runtimeBucket(e.movie.runtime_min) === runtime) &&
        (!decade || decadeOf(e.movie.year) === decade),
    );
    const t = (e: (typeof xs)[number]) => new Date(e.night.completed_at!).getTime();
    xs = xs.slice().sort((a, b) => {
      switch (sort) {
        case "oldest":
          return t(a) - t(b);
        case "highest":
          return (b.group_avg ?? -1) - (a.group_avg ?? -1);
        case "lowest":
          return (a.group_avg ?? 99) - (b.group_avg ?? 99);
        case "longest":
          return (b.movie.runtime_min ?? 0) - (a.movie.runtime_min ?? 0);
        case "shortest":
          return (a.movie.runtime_min ?? 9999) - (b.movie.runtime_min ?? 9999);
        default:
          return t(b) - t(a);
      }
    });
    return xs;
  }, [entries, selector, genre, year, minRating, runtime, decade, sort]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;
  const active = [selector, genre, year, minRating, runtime, decade].filter((x) => x != null).length;

  if (tab === "wishlist") {
    return (
      <div className="flex flex-col gap-3 pt-1">
        <Tabs tab={tab} setTab={setTab} watched={entries.length} wished={wishlist?.length ?? 0} />
        <Wishlist />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 pt-1">
      <Tabs tab={tab} setTab={setTab} watched={entries.length} wished={wishlist?.length ?? 0} />
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted">{entries.length} watched</div>
        <div className="flex gap-2">
          <button className="chip" onClick={() => setAdding(true)}>
            + Past movie
          </button>
          <button className={`chip ${active ? "chip-on" : ""}`} onClick={() => setShowFilters((s) => !s)}>
            ⚙︎ Filters{active ? ` · ${active}` : ""}
          </button>
        </div>
      </div>
      <BackfillSheet open={adding} onClose={() => setAdding(false)} />

      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
        {SORTS.map((s) => (
          <button key={s.key} className={`chip ${sort === s.key ? "chip-on" : ""}`} onClick={() => setSort(s.key)}>
            {s.label}
          </button>
        ))}
      </div>

      {showFilters && (
        <div className="card flex flex-col gap-3 p-3">
          <Row label="Picker">
            {members.map((m) => (
              <button key={m.id} className={`chip ${selector === m.id ? "chip-on" : ""}`} onClick={() => setSelector(selector === m.id ? null : m.id)}>
                <Avatar member={m} size={16} /> {m.name}
              </button>
            ))}
          </Row>
          <Row label="Genre">
            {genres.map((g) => (
              <button key={g} className={`chip ${genre === g ? "chip-on" : ""}`} onClick={() => setGenre(genre === g ? null : g)}>
                {g}
              </button>
            ))}
          </Row>
          <Row label="Runtime">
            {RUNTIME_BUCKETS.map((b) => (
              <button key={b.key} className={`chip ${runtime === b.key ? "chip-on" : ""}`} onClick={() => setRuntime(runtime === b.key ? null : b.key)}>
                {b.label}
              </button>
            ))}
          </Row>
          <Row label="Rating">
            {[9, 8, 7, 6, 5].map((r) => (
              <button key={r} className={`chip ${minRating === r ? "chip-on" : ""}`} onClick={() => setMinRating(minRating === r ? null : r)}>
                {r}+
              </button>
            ))}
          </Row>
          <Row label="Watched in">
            {years.map((y) => (
              <button key={y} className={`chip ${year === y ? "chip-on" : ""}`} onClick={() => setYear(year === y ? null : y)}>
                {y}
              </button>
            ))}
          </Row>
          <Row label="Released">
            {decades.map((d) => (
              <button key={d} className={`chip ${decade === d ? "chip-on" : ""}`} onClick={() => setDecade(decade === d ? null : d)}>
                {d}
              </button>
            ))}
          </Row>
        </div>
      )}

      {entries.length === 0 ? (
        <Empty title="Nothing watched yet" body="Finish your first movie night and it lands here. Or add the ones you've already watched.">
          <button className="btn btn-gold mt-2" onClick={() => setAdding(true)}>
            + Add a past movie
          </button>
        </Empty>
      ) : shown.length === 0 ? (
        <Empty title="No matches" body="Loosen the filters." />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {shown.map((e) => {
            const sel = members.find((m) => m.id === e.selector_id);
            return (
              <Link key={e.night.id} href={`/movie/${e.night.id}`} className="card flex flex-col overflow-hidden">
                <div className="relative">
                  <Poster path={e.movie.poster_path} title={e.movie.title} className="rounded-none" />
                  <div className="absolute right-2 top-2 rounded-lg bg-black/70 px-2 py-0.5 text-lg font-black text-gold backdrop-blur">{fmtScore(e.group_avg)}</div>
                  <div className="absolute left-2 top-2">
                    <Avatar member={sel} size={26} />
                  </div>
                </div>
                <div className="flex flex-col gap-0.5 p-2.5">
                  <div className="truncate text-sm font-black">{e.movie.title}</div>
                  <div className="text-[11px] text-muted">
                    {fmtRuntime(e.movie.runtime_min)} · {e.movie.year ?? "—"}
                  </div>
                  <div className="truncate text-[11px] text-muted">{e.movie.genres.map((g) => g.name).join(", ")}</div>
                  <div className="text-[11px] text-muted">{fmtDate(e.night.completed_at)}</div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Tabs({ tab, setTab, watched, wished }: { tab: "watched" | "wishlist"; setTab: (t: "watched" | "wishlist") => void; watched: number; wished: number }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button className={`btn ${tab === "watched" ? "btn-gold" : "btn-ghost"} min-h-12`} onClick={() => setTab("watched")}>
        🎞️ Watched · {watched}
      </button>
      <button className={`btn ${tab === "wishlist" ? "btn-gold" : "btn-ghost"} min-h-12`} onClick={() => setTab("wishlist")}>
        💡 Wishlist · {wished}
      </button>
    </div>
  );
}

function Wishlist() {
  const { data, error } = useWishlist();
  const { members, state, me } = useApp();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const myTurn = state?.rotation.current?.id === me?.id && !state?.current;
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted">Anyone can add. Films drop off once watched.</div>
        <button className="chip chip-on" onClick={() => setAdding(true)}>
          + Add
        </button>
      </div>
      <WishlistAddSheet open={adding} onClose={() => setAdding(false)} />
      {data.length === 0 ? (
        <Empty title="Wishlist is empty" body="Add the movies you keep meaning to watch. The picker sees this list when it's their turn.">
          <button className="btn btn-gold mt-2" onClick={() => setAdding(true)}>
            + Add a movie
          </button>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((w) => {
            const who = members.find((m) => m.id === w.added_by);
            return (
              <div key={w.id} className="card flex gap-3 p-2">
                <Poster path={w.movie.poster_path} title={w.movie.title} className="w-16 shrink-0" size="w185" />
                <div className="min-w-0 flex-1">
                  <div className="font-black leading-tight">
                    {w.movie.title} {w.movie.year && <span className="font-bold text-muted">({w.movie.year})</span>}
                  </div>
                  <div className="text-xs font-bold text-gold">⏱ {fmtRuntime(w.movie.runtime_min)}</div>
                  <div className="truncate text-xs text-muted">{w.movie.genres.map((g) => g.name).join(" · ")}</div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-muted">
                    <Avatar member={who} size={14} /> {who?.name}
                    {w.note && <span className="truncate"> · {w.note}</span>}
                  </div>
                </div>
                <div className="flex flex-col items-end justify-between">
                  <button
                    className="text-xs text-muted underline"
                    disabled={busy === w.id}
                    onClick={async () => {
                      setBusy(w.id);
                      try {
                        await send("DELETE", `/api/wishlist/${w.id}`);
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    remove
                  </button>
                  {myTurn && (
                    <Link href="/?pick=1" className="chip chip-on">
                      Pick →
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label mb-1">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
