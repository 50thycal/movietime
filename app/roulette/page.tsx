"use client";

import { useState } from "react";
import { MovieExtrasPanel, Synopsis } from "@/components/MovieExtras";
import { useApp } from "@/components/Shell";
import { Avatar, ErrorNote, Poster } from "@/components/ui";
import { fetcher, send, useGenres } from "@/lib/api";
import { fmtRuntime } from "@/lib/format";
import { serviceLabel } from "@/lib/streaming";
import type { NightDetail, SpinResult } from "@/lib/types";
import { useRouter } from "next/navigation";

type Kind = "roulette" | "taste";
type Mode = "genre" | "movie" | "full";

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
  const { state, me, members } = useApp();
  const { data: genres } = useGenres();
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("roulette");
  const [mode, setMode] = useState<Mode>("full");
  const [forWho, setForWho] = useState<string>("group");
  // undefined = not touched yet → all of the group's services.
  const [picked, setPicked] = useState<string[] | null | undefined>(undefined);
  const [genre, setGenre] = useState<number | null>(null);
  const [runtime, setRuntime] = useState<number | null>(null);
  const [era, setEra] = useState(0);
  const [minRating, setMinRating] = useState(6.5);
  const [spin, setSpin] = useState<SpinResult | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [accepting, setAccepting] = useState(false);

  const myTurn = state?.rotation.current?.id === me?.id;
  const canPropose = myTurn && !state?.current;
  const ours = state?.streaming.services ?? [];
  const services = picked === undefined ? ours : (picked ?? []);
  const allOurs = ours.length > 0 && ours.every((k) => services.includes(k));
  const toggleService = (k: string) => {
    const next = services.includes(k) ? services.filter((x) => x !== k) : [...services, k];
    setPicked(next.length ? next : null);
  };
  const effectiveMode = kind === "taste" ? "taste" : mode;
  const showFilters = effectiveMode !== "genre";

  async function doSpin() {
    setSpinning(true);
    setError(null);
    try {
      const p = new URLSearchParams({ mode: effectiveMode });
      if (genre && effectiveMode !== "genre") p.set("genre", String(genre));
      if (services.length) p.set("services", services.join(","));
      if (kind === "taste") p.set("for", forWho);
      if (runtime) p.set("max_runtime", String(runtime));
      if (ERAS[era].from) p.set("year_from", String(ERAS[era].from));
      if (ERAS[era].to) p.set("year_to", String(ERAS[era].to));
      p.set("min_rating", String(minRating));
      // A tiny theatrical pause so the result reads as a spin rather than a page load.
      const [res] = await Promise.all([fetcher<SpinResult>(`/api/roulette?${p}`), new Promise((r) => setTimeout(r, 500))]);
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
      await send<NightDetail>("POST", "/api/nights", { tmdb_id: spin.movie.tmdb_id, source: kind });
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

      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-card p-1">
        {(
          [
            ["roulette", "🎲 Roulette"],
            ["taste", "🎯 Pick like us"],
          ] as [Kind, string][]
        ).map(([k, label]) => (
          <button key={k} className={`btn ${kind === k ? "btn-gold" : "btn-ghost border-transparent"} min-h-12 whitespace-nowrap text-sm`} onClick={() => (setKind(k), setSpin(null), setError(null))}>
            {label}
          </button>
        ))}
      </div>

      {kind === "roulette" ? (
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
      ) : (
        <div className="card flex flex-col gap-2 p-3">
          <div className="label">Pick like…</div>
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
            <button className={`chip ${forWho === "group" ? "chip-on" : ""}`} onClick={() => setForWho("group")}>
              👥 everyone
            </button>
            {members
              .filter((m) => m.active)
              .map((m) => (
                <button key={m.id} className={`chip gap-1.5 ${forWho === m.id ? "chip-on" : ""}`} onClick={() => setForWho(m.id)}>
                  <Avatar member={m} size={18} /> {m.name}
                </button>
              ))}
          </div>
          <p className="text-xs text-muted">
            Scores fresh films against {forWho === "group" ? "the group’s" : `${members.find((m) => m.id === forWho)?.name}’s`} ratings: the genres and eras rated above average, and films that fans of your favourites also love.
          </p>
        </div>
      )}

      {showFilters && (
        <div className="card flex flex-col gap-3 p-3">
          <div>
            <div className="label mb-1">Where to watch</div>
            <div className="flex flex-wrap gap-1.5">
              <button className={`chip ${services.length === 0 ? "chip-on" : ""}`} onClick={() => setPicked(null)}>
                anywhere
              </button>
              {ours.length > 0 && (
                <button className={`chip ${allOurs ? "chip-on" : ""}`} onClick={() => setPicked(allOurs ? null : ours)}>
                  📺 all our services
                </button>
              )}
              {ours.map((k) => (
                <button key={k} className={`chip ${services.includes(k) && !allOurs ? "chip-on" : ""} ${allOurs ? "opacity-60" : ""}`} onClick={() => (allOurs ? setPicked([k]) : toggleService(k))}>
                  {serviceLabel(k)}
                </button>
              ))}
            </div>
            {ours.length === 0 && <div className="mt-1 text-xs text-muted">Add your streaming services in Settings to filter by them.</div>}
          </div>
          <div>
            <div className="label mb-1">
              Genre {effectiveMode === "full" && <span className="normal-case tracking-normal">(leave blank to spin one)</span>}
              {effectiveMode === "taste" && <span className="normal-case tracking-normal">(blank = your favourites)</span>}
            </div>
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
              <button className={`chip ${genre == null ? "chip-on" : ""}`} onClick={() => setGenre(null)}>
                {effectiveMode === "full" ? "🎲 random" : "any"}
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
        {kind === "taste" ? (spinning ? "Reading your taste…" : spin ? "🎯 Another one" : "🎯 Find one we’ll love") : spinning ? "Spinning…" : spin ? "🎲 Spin again" : "🎲 Spin"}
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
          {spin.reasons && spin.reasons.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="label text-center">🎯 Why this one</div>
              <div className="flex flex-wrap justify-center gap-1.5">
                {spin.reasons.map((r) => (
                  <span key={r} className="chip text-xs">
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}
          {spin.movie && (
            <div className="flex gap-4">
              <Poster path={spin.movie.poster_path} title={spin.movie.title} className="w-32 shrink-0" />
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="text-xl font-black leading-tight">
                  {spin.movie.title} {spin.movie.year && <span className="font-bold text-muted">({spin.movie.year})</span>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="chip chip-on">⏱ {fmtRuntime(spin.movie.runtime_min)}</span>
                  {spin.movie.tmdb_rating != null && <span className="chip">TMDB {spin.movie.tmdb_rating}</span>}
                </div>
                <div className="text-xs text-muted">{spin.movie.genres.map((g) => g.name).join(" · ")}</div>
                <Synopsis text={spin.movie.overview} lines={5} />
              </div>
            </div>
          )}
          {spin.movie && (
            <MovieExtrasPanel tmdbId={spin.movie.tmdb_id} initial={spin.extras ? { movie: spin.movie, extras: spin.extras } : undefined} />
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
