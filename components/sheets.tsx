"use client";

import { useState } from "react";
import { send, useSearch } from "@/lib/api";
import { fmtRuntime } from "@/lib/format";
import type { NightDetail, TmdbSearchResult } from "@/lib/types";
import { ErrorNote, Poster, ScorePicker, Sheet, Spinner } from "./ui";

/** Search TMDB and submit a pick. */
export function PickSheet({ open, onClose, onPicked }: { open: boolean; onClose: () => void; onPicked?: (n: NightDetail) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { data, isLoading, error: searchError } = useSearch(q);

  async function propose(m: TmdbSearchResult) {
    setBusy(m.tmdb_id);
    setError(null);
    try {
      const night = await send<NightDetail>("POST", "/api/nights", { tmdb_id: m.tmdb_id });
      onPicked?.(night);
      onClose();
      setQ("");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Pick a movie">
      <input className="input mb-3" placeholder="Search movies…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus inputMode="search" />
      <ErrorNote error={error ?? searchError} />
      {isLoading && !data && <Spinner />}
      <div className="flex flex-col gap-2">
        {data?.map((m) => (
          <button key={m.tmdb_id} className="card flex gap-3 p-2 text-left active:scale-[0.99]" disabled={busy != null} onClick={() => propose(m)}>
            <Poster path={m.poster_path} title={m.title} className="w-16 shrink-0" size="w185" />
            <div className="min-w-0 flex-1">
              <div className="font-black leading-tight">
                {m.title} {m.year && <span className="font-bold text-muted">({m.year})</span>}
              </div>
              <div className="mt-1 text-xs font-bold text-gold">⏱ {fmtRuntime(m.runtime_min)}</div>
              <div className="text-xs text-muted">{m.genres.map((g) => g.name).join(" · ")}</div>
              {m.director && <div className="text-xs text-muted">Dir. {m.director}</div>}
              <div className="mt-1 line-clamp-2 text-xs text-muted">{m.overview}</div>
            </div>
            {busy === m.tmdb_id && <Spinner />}
          </button>
        ))}
        {data && data.length === 0 && <div className="py-6 text-center text-sm text-muted">Nothing found.</div>}
      </div>
    </Sheet>
  );
}

export function RateSheet({ night, open, onClose }: { night: NightDetail; open: boolean; onClose: () => void }) {
  const [score, setScore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit() {
    if (score == null) return;
    setBusy(true);
    setError(null);
    try {
      await send("POST", `/api/nights/${night.night.id}/ratings`, { score });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title={`Rate ${night.movie.title}`}>
      <p className="mb-3 text-sm text-muted">Your score stays hidden until everyone has rated. No take-backs.</p>
      <ScorePicker value={score} onChange={setScore} />
      <ErrorNote error={error} />
      <button className="btn btn-gold mt-4 w-full" disabled={score == null || busy} onClick={submit}>
        {score == null ? "Pick a score" : `Lock in ${score}`}
      </button>
    </Sheet>
  );
}

export function PredictSheet({ night, open, onClose }: { night: NightDetail; open: boolean; onClose: () => void }) {
  const [own, setOwn] = useState<number | null>(night.my_prediction?.own_score ?? null);
  const [group, setGroup] = useState<number | null>(night.my_prediction?.group_score ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit() {
    if (own == null) return;
    setBusy(true);
    setError(null);
    try {
      await send("POST", `/api/nights/${night.night.id}/predictions`, { own_score: own, group_score: group });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Call your shot">
      <div className="label mb-2">What will YOU rate it?</div>
      <ScorePicker value={own} onChange={setOwn} />
      <div className="label mt-5 mb-2">What will the group average be? (optional)</div>
      <ScorePicker value={group} onChange={setGroup} />
      <ErrorNote error={error} />
      <button className="btn btn-gold mt-4 w-full" disabled={own == null || busy} onClick={submit}>
        Save prediction
      </button>
      <p className="mt-2 text-center text-xs text-muted">Locks when the movie starts.</p>
    </Sheet>
  );
}

export function RejectSheet({ night, open, onClose }: { night: NightDetail; open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await send("POST", `/api/nights/${night.night.id}/approval`, { decision: "reject", reason: reason || null });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Veto this one?">
      <p className="mb-3 text-sm text-muted">{night.selector.name} keeps their turn and picks again.</p>
      <input className="input" placeholder="Reason (optional) — e.g. seen it, too long" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
      <ErrorNote error={error} />
      <button className="btn btn-bad mt-4 w-full" disabled={busy} onClick={submit}>
        ✕ Reject
      </button>
    </Sheet>
  );
}
