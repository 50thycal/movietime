"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useApp } from "@/components/Shell";
import { Avatar, Empty, ErrorNote, Poster, Spinner } from "@/components/ui";
import { useHistory } from "@/lib/api";
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
  const { data, error } = useHistory();
  const { members } = useApp();
  const [selector, setSelector] = useState<string | null>(null);
  const [genre, setGenre] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [minRating, setMinRating] = useState<number | null>(null);
  const [runtime, setRuntime] = useState<string | null>(null);
  const [decade, setDecade] = useState<string | null>(null);
  const [sort, setSort] = useState<(typeof SORTS)[number]["key"]>("newest");
  const [showFilters, setShowFilters] = useState(false);

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

  return (
    <div className="flex flex-col gap-3 pt-1">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">
          History <span className="text-base text-muted">{entries.length}</span>
        </h1>
        <button className={`chip ${active ? "chip-on" : ""}`} onClick={() => setShowFilters((s) => !s)}>
          ⚙︎ Filters{active ? ` · ${active}` : ""}
        </button>
      </div>

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
        <Empty title="Nothing watched yet" body="Finish your first movie night and it lands here." />
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label mb-1">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
