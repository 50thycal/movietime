"use client";

import { useState } from "react";
import { useApp } from "@/components/Shell";
import { ErrorNote, Poster } from "@/components/ui";
import { fetcher, send, useGenres } from "@/lib/api";
import { fmtRuntime } from "@/lib/format";
import type { Genre, NightDetail, TmdbSearchResult } from "@/lib/types";
import { useRouter } from "next/navigation";

type Mode = "genre" | "movie" | "full";
interface Spin {
  genre: Genre | null;
  movie: TmdbSearchResult | null;
}

const RUNTIMES = [
  { label: "any length", value: null },
  { label: "< 90m", value: 90 },
  { label: "< 2h", value: 120 },
  { label: "< 2h 30", value: 150 },
];
const ERAS = [
  { label: "any era", from: null, to: null },
  { label: "2020s", from: 2020, to: null },
  { label: "2010s", from: 2010, to: 2019 },
  { label: "2000s", from: 2000, to: 2009 },
  { label: "90s", from: 1990, to: 1999 },
  { label: "80s & older", from: null, to: 1989 },
];

export default function RoulettePage() {
  const { state, me } = useApp();
  const { data: genres } = useGenres();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("full");
  const [genre, setGenre] = useState<number | null>(null);
  const [runtime, setRuntime] = useState<number | null>(null);
  const [era, setEra] = useState(0);
  const [minRating, setMinRating] = useState(6.5);
  const [spin, setSpin] = useState<Spin | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [accepting, setAccepting] = useState(false);

  const myTurn = state?.rotation.current?.id === me?.id;
  const canPropose = myTurn && !state?.current;

  async function doSpin() {
    setSpinning(true);
    setError(null);
    try {
      const p = new URLSearchParams({ mode });
      if (genre && mode !== "genre") p.set("genre", String(genre));
      if (runtime) p.set("max_runtime", String(runtime));
      if (ERAS[era].from) p.set("year_from", String(ERAS[era].from));
      if (ERAS[era].to) p.set("year_to", String(ERAS[era].to));
      p.set("min_rating", String(minRating));
      // A tiny theatrical pause so the result reads as a spin rather than a page load.
      const [res] = await Promise.all([fetcher<Spin>(`/api/roulette?${p}`), new Promise((r) => setTimeout(r, 500))]);
      setSpin(res);
    } catch (e) {
      setError(e);
    } finally {
      setSpinning(false);
    }
  }

  async function accept() {
    if (!spin?.movie) return;
    setAccepting(true);
    setError(null);
    try {
      await send<NightDetail>("POST", "/api/nights", { tmdb_id: spin.movie.tmdb_id });
      router.push("/");
    } catch (e) {
      setError(e);
      setAccepting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 pt-1">
      <div>
        <h1 className="text-2xl font-black">🎲 What should we watch?</h1>
        <p className="text-sm text-muted">Nothing is added until someone hits Accept.</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["genre", "Random genre"],
            ["movie", "Random movie"],
            ["full", "Full roulette"],
          ] as [Mode, string][]
        ).map(([m, label]) => (
          <button key={m} className={`btn ${mode === m ? "btn-gold" : "btn-ghost"} min-h-14 text-sm`} onClick={() => (setMode(m), setSpin(null))}>
            {label}
          </button>
        ))}
      </div>

      {mode !== "genre" && (
        <div className="card flex flex-col gap-3 p-3">
          <div>
            <div className="label mb-1">Genre {mode === "full" && <span className="normal-case tracking-normal">(leave blank to spin one)</span>}</div>
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
              <button className={`chip ${genre == null ? "chip-on" : ""}`} onClick={() => setGenre(null)}>
                {mode === "full" ? "🎲 random" : "any"}
              </button>
              {genres?.map((g) => (
                <button key={g.id} className={`chip ${genre === g.id ? "chip-on" : ""}`} onClick={() => setGenre(g.id)}>
                  {g.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="label mb-1">Runtime</div>
            <div className="flex flex-wrap gap-1.5">
              {RUNTIMES.map((r) => (
                <button key={r.label} className={`chip ${runtime === r.value ? "chip-on" : ""}`} onClick={() => setRuntime(r.value)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="label mb-1">Era</div>
            <div className="flex flex-wrap gap-1.5">
              {ERAS.map((e, i) => (
                <button key={e.label} className={`chip ${era === i ? "chip-on" : ""}`} onClick={() => setEra(i)}>
                  {e.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="label mb-1">Minimum TMDB rating</div>
            <div className="flex flex-wrap gap-1.5">
              {[5, 6, 6.5, 7, 7.5, 8].map((r) => (
                <button key={r} className={`chip ${minRating === r ? "chip-on" : ""}`} onClick={() => setMinRating(r)}>
                  {r}+
                </button>
              ))}
            </div>
          </div>
          <div className="text-xs text-muted">Already-watched movies are always excluded.</div>
        </div>
      )}

      <button className="btn btn-gold min-h-16 w-full text-xl" disabled={spinning} onClick={doSpin}>
        {spinning ? "Spinning…" : spin ? "🎲 Spin again" : "🎲 Spin"}
      </button>
      <ErrorNote error={error} />

      {spin && !spinning && (
        <div className="spin-in card flex flex-col gap-4 p-4">
          {spin.genre && (
            <div className="text-center">
              <div className="label">Tonight&apos;s genre</div>
              <div className="text-4xl font-black uppercase tracking-tight text-gold">{spin.genre.name}</div>
            </div>
          )}
          {spin.movie && (
            <div className="flex gap-4">
              <Poster path={spin.movie.poster_path} title={spin.movie.title} className="w-32 shrink-0" />
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="text-xl font-black leading-tight">
                  {spin.movie.title} <span className="font-bold text-muted">({spin.movie.year})</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="chip chip-on">⏱ {fmtRuntime(spin.movie.runtime_min)}</span>
                  {spin.movie.tmdb_rating != null && <span className="chip">TMDB {spin.movie.tmdb_rating}</span>}
                </div>
                <div className="text-xs text-muted">{spin.movie.genres.map((g) => g.name).join(" · ")}</div>
                <p className="line-clamp-4 text-xs text-muted">{spin.movie.overview}</p>
              </div>
            </div>
          )}
          {spin.movie &&
            (canPropose ? (
              <button className="btn btn-good w-full" disabled={accepting} onClick={accept}>
                ✓ Accept — propose it to the group
              </button>
            ) : (
              <div className="text-center text-xs text-muted">
                {state?.current ? "There's already a movie in play tonight." : `Only ${state?.rotation.current?.name} (whose turn it is) can propose this.`}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
