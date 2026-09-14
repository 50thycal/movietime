"use client";

import { useState } from "react";
import { send, useSearch, useWishlist } from "@/lib/api";
import { fmtRuntime } from "@/lib/format";
import type { Movie, NightDetail, TmdbSearchResult } from "@/lib/types";
import { useRouter } from "next/navigation";
import { fmtDate } from "@/lib/format";
import { rotationOrder } from "@/lib/rotation";
import { MAX_CANDIDATES } from "@/lib/constants";
import { useApp } from "./Shell";
import { Avatar, ErrorNote, Poster, ScorePicker, Sheet, Spinner, useSheetFocus } from "./ui";

/** Search TMDB and submit one pick, or a shortlist for a vote. Wishlist shows when the search is empty. */
export function PickSheet({ open, onClose, onPicked }: { open: boolean; onClose: () => void; onPicked?: (n: NightDetail) => void }) {
  const [q, setQ] = useState("");
  const [shortlist, setShortlist] = useState<TmdbSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { data, isLoading, error: searchError } = useSearch(q);
  const searchRef = useSheetFocus<HTMLInputElement>(open);
  const { data: wishlist } = useWishlist();
  const { members } = useApp();

  const inList = (m: TmdbSearchResult) => shortlist.some((x) => x.tmdb_id === m.tmdb_id);
  const fromMovie = (m: Movie): TmdbSearchResult => ({ ...m, popularity: null });
  function toggle(m: TmdbSearchResult) {
    setError(null);
    if (inList(m)) return setShortlist(shortlist.filter((x) => x.tmdb_id !== m.tmdb_id));
    if (shortlist.length >= MAX_CANDIDATES) return setError(new Error(`${MAX_CANDIDATES} is the limit. Remove one first.`));
    setShortlist([...shortlist, m]);
  }

  async function propose(list: TmdbSearchResult[]) {
    setBusy(true);
    setError(null);
    try {
      const night = await send<NightDetail>("POST", "/api/nights", { tmdb_ids: list.map((m) => m.tmdb_id) });
      onPicked?.(night);
      onClose();
      setQ("");
      setShortlist([]);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Pick a movie">
      <p className="mb-2 text-xs text-muted">Tap a result to propose it, or use + to build a shortlist (up to six) and let everyone vote.</p>
      <input ref={searchRef} className="input mb-3" placeholder="Search movies…" value={q} onChange={(e) => setQ(e.target.value)} inputMode="search" />
      {shortlist.length > 0 && (
        <div className="card mb-3 flex flex-col gap-2 p-3">
          <div className="label">Shortlist · {shortlist.length}/{MAX_CANDIDATES}</div>
          <div className="flex gap-2">
            {shortlist.map((m) => (
              <button key={m.tmdb_id} className="relative w-16" onClick={() => toggle(m)} aria-label={`Remove ${m.title}`}>
                <Poster path={m.poster_path} title={m.title} size="w185" />
                <span className="absolute -right-1 -top-1 rounded-full bg-bad px-1.5 text-xs font-black text-white">✕</span>
              </button>
            ))}
          </div>
          <button className="btn btn-gold w-full" disabled={busy} onClick={() => propose(shortlist)}>
            {shortlist.length === 1 ? "Propose this one" : `🗳 Put ${shortlist.length} up for a vote`}
          </button>
        </div>
      )}
      <ErrorNote error={error ?? searchError} />
      {isLoading && !data && <Spinner />}
      {q.trim().length < 2 && wishlist && wishlist.length > 0 && (
        <div className="mb-3">
          <div className="label mb-2">💡 From the wishlist</div>
          <div className="flex flex-col gap-2">
            {wishlist.map((w) => {
              const m = fromMovie(w.movie);
              const who = members.find((x) => x.id === w.added_by);
              return (
                <div key={w.id} className={`card flex gap-3 p-2 ${inList(m) ? "border-gold" : ""}`}>
                  <button className="flex min-w-0 flex-1 gap-3 text-left active:scale-[0.99]" disabled={busy} onClick={() => (shortlist.length ? toggle(m) : propose([m]))}>
                    <Poster path={m.poster_path} title={m.title} className="w-12 shrink-0" size="w185" />
                    <div className="min-w-0 flex-1">
                      <div className="font-black leading-tight">
                        {m.title} {m.year && <span className="font-bold text-muted">({m.year})</span>}
                      </div>
                      <div className="text-xs text-gold">⏱ {fmtRuntime(m.runtime_min)}</div>
                      <div className="flex items-center gap-1 text-xs text-muted">
                        <Avatar member={who} size={14} /> {who?.name}
                        {w.note && ` · ${w.note}`}
                      </div>
                    </div>
                  </button>
                  <button className={`chip self-center text-lg ${inList(m) ? "chip-on" : ""}`} onClick={() => toggle(m)} aria-label={inList(m) ? "Remove from shortlist" : "Add to shortlist"}>
                    {inList(m) ? "✓" : "+"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {data?.map((m) => (
          <div key={m.tmdb_id} className={`card flex gap-3 p-2 ${inList(m) ? "border-gold" : ""}`}>
            <button className="flex min-w-0 flex-1 gap-3 text-left active:scale-[0.99]" disabled={busy} onClick={() => (shortlist.length ? toggle(m) : propose([m]))}>
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
            </button>
            <button className={`chip self-center text-lg ${inList(m) ? "chip-on" : ""}`} onClick={() => toggle(m)} aria-label={inList(m) ? "Remove from shortlist" : "Add to shortlist"}>
              {inList(m) ? "✓" : "+"}
            </button>
          </div>
        ))}
        {data && data.length === 0 && <div className="py-6 text-center text-sm text-muted">Nothing found.</div>}
      </div>
    </Sheet>
  );
}

/** Tonight → tap the Up Next card: set whose turn it really is. */
export function ChangePickerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, members } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const order = rotationOrder(members);
  async function pick(id: string) {
    setBusy(true);
    setError(null);
    try {
      await send("POST", "/api/rotation", { member_id: id });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Whose turn is it?">
      <p className="mb-3 text-sm text-muted">Everyone sees this change immediately. The rotation carries on from whoever you choose.</p>
      <div className="grid grid-cols-2 gap-2">
        {order.map((m) => (
          <button key={m.id} className={`btn ${state?.rotation.current?.id === m.id ? "btn-gold" : "btn-ghost"} justify-start gap-2`} disabled={busy} onClick={() => pick(m.id)}>
            <Avatar member={m} size={24} /> {m.name}
          </button>
        ))}
      </div>
      <ErrorNote error={error} />
    </Sheet>
  );
}

/** History → add a movie the group watched before the app existed. */
export function BackfillSheet({ open, onClose, defaultSelector = null }: { open: boolean; onClose: () => void; defaultSelector?: string | null }) {
  const { members, meId } = useApp();
  const [q, setQ] = useState("");
  const [movie, setMovie] = useState<TmdbSearchResult | null>(null);
  const [selector, setSelector] = useState<string | null>(defaultSelector);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [scores, setScores] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { data, isLoading } = useSearch(q);
  const searchRef = useSheetFocus<HTMLInputElement>(open && !movie);
  const active = members.filter((m) => m.active);

  async function submit() {
    if (!movie || !selector) return;
    setBusy(true);
    setError(null);
    try {
      await send("POST", "/api/history/backfill", {
        tmdb_id: movie.tmdb_id,
        selector_id: selector,
        watched_at: new Date(date + "T20:00:00").toISOString(),
        ratings: Object.entries(scores)
          .filter(([, v]) => v != null)
          .map(([member_id, score]) => ({ member_id, score })),
      });
      onClose();
      setMovie(null);
      setQ("");
      setScores({});
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add a past movie">
      {!movie ? (
        <>
          <input ref={searchRef} className="input mb-3" placeholder="Search movies…" value={q} onChange={(e) => setQ(e.target.value)} inputMode="search" />
          {isLoading && !data && <Spinner />}
          <div className="flex flex-col gap-2">
            {data?.map((m) => (
              <button key={m.tmdb_id} className="card flex gap-3 p-2 text-left" onClick={() => setMovie(m)}>
                <Poster path={m.poster_path} title={m.title} className="w-12 shrink-0" size="w185" />
                <div className="min-w-0">
                  <div className="font-black leading-tight">
                    {m.title} {m.year && <span className="font-bold text-muted">({m.year})</span>}
                  </div>
                  <div className="text-xs text-muted">{fmtRuntime(m.runtime_min)} · {m.genres.map((g) => g.name).join(", ")}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-4">
          <button className="card flex items-center gap-3 p-2 text-left" onClick={() => setMovie(null)}>
            <Poster path={movie.poster_path} title={movie.title} className="w-12 shrink-0" size="w185" />
            <div className="min-w-0 flex-1 font-black">
              {movie.title} {movie.year && <span className="font-bold text-muted">({movie.year})</span>}
            </div>
            <span className="chip">change</span>
          </button>
          <div>
            <div className="label mb-1">Who picked it?</div>
            <div className="grid grid-cols-2 gap-2">
              {active.map((m) => (
                <button key={m.id} className={`btn ${selector === m.id ? "btn-gold" : "btn-ghost"} min-h-11 justify-start gap-2 text-sm`} onClick={() => setSelector(m.id)}>
                  <Avatar member={m} size={22} /> {m.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="label mb-1">When did you watch it?</div>
            <input type="date" className="input" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <div className="label mb-1">Ratings (optional — everyone can add their own later)</div>
            <div className="flex flex-col gap-2">
              {active.map((m) => (
                <div key={m.id} className="flex items-center gap-2">
                  <Avatar member={m} size={24} />
                  <span className="w-16 truncate text-sm font-bold">{m.name}</span>
                  <select className="input min-h-10 flex-1" value={scores[m.id] ?? ""} onChange={(e) => setScores({ ...scores, [m.id]: e.target.value === "" ? null : Number(e.target.value) })}>
                    <option value="">{m.id === meId ? "— your score —" : "— skip —"}</option>
                    {Array.from({ length: 19 }, (_, i) => 1 + i * 0.5).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
          <ErrorNote error={error} />
          <button className="btn btn-gold w-full" disabled={!selector || busy} onClick={submit}>
            Add to history
          </button>
        </div>
      )}
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

/** History → Wishlist → add a film the group wants to get to. */
export function WishlistAddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { data, isLoading } = useSearch(q);
  const searchRef = useSheetFocus<HTMLInputElement>(open);
  async function add(m: TmdbSearchResult) {
    setBusy(m.tmdb_id);
    setError(null);
    try {
      await send("POST", "/api/wishlist", { tmdb_id: m.tmdb_id, note: note || null });
      onClose();
      setQ("");
      setNote("");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Add to wishlist">
      <input ref={searchRef} className="input mb-2" placeholder="Search movies…" value={q} onChange={(e) => setQ(e.target.value)} inputMode="search" />
      <input className="input mb-3" placeholder="Why? (optional)" value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} />
      <ErrorNote error={error} />
      {isLoading && !data && <Spinner />}
      <div className="flex flex-col gap-2">
        {data?.map((m) => (
          <button key={m.tmdb_id} className="card flex gap-3 p-2 text-left active:scale-[0.99]" disabled={busy != null} onClick={() => add(m)}>
            <Poster path={m.poster_path} title={m.title} className="w-12 shrink-0" size="w185" />
            <div className="min-w-0 flex-1">
              <div className="font-black leading-tight">
                {m.title} {m.year && <span className="font-bold text-muted">({m.year})</span>}
              </div>
              <div className="text-xs text-muted">{fmtRuntime(m.runtime_min)} · {m.genres.map((g) => g.name).join(", ")}</div>
            </div>
            {busy === m.tmdb_id && <Spinner />}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** Movie page → Edit: correct who picked a finished night, when it was watched, or drop it. */
export function EditNightSheet({ detail, open, onClose }: { detail: NightDetail; open: boolean; onClose: () => void }) {
  const { members } = useApp();
  const router = useRouter();
  const watched = detail.night.watched_at ?? detail.night.completed_at;
  const [selector, setSelector] = useState(detail.night.selector_id);
  const [date, setDate] = useState(() => (watched ? new Date(watched).toISOString().slice(0, 10) : ""));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const active = members.filter((m) => m.active || m.id === detail.night.selector_id);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Keep the evening slot so a date-only edit can't slide a night across
      // a day boundary in someone else's timezone.
      await send("PATCH", `/api/nights/${detail.night.id}`, { selector_id: selector, watched_at: new Date(date + "T20:00:00").toISOString() });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await send("DELETE", `/api/nights/${detail.night.id}`);
      router.replace("/history");
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Edit ${detail.movie.title}`}>
      <div className="flex flex-col gap-4">
        <div>
          <div className="label mb-1">Who picked it?</div>
          <div className="grid grid-cols-2 gap-2">
            {active.map((m) => (
              <button key={m.id} className={`btn ${selector === m.id ? "btn-gold" : "btn-ghost"} min-h-11 justify-start gap-2 text-sm`} onClick={() => setSelector(m.id)}>
                <Avatar member={m} size={22} /> {m.name}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="label mb-1">Date watched</div>
          <input type="date" className="input" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
          <div className="mt-1 text-xs text-muted">Currently {fmtDate(watched)}</div>
        </div>
        <ErrorNote error={error} />
        <button className="btn btn-gold w-full" disabled={busy || !date} onClick={save}>
          Save changes
        </button>
        <div className="border-t border-line pt-3">
          {confirming ? (
            <div className="flex flex-col gap-2">
              <div className="text-sm font-bold text-bad">Remove this movie night for everyone? Its ratings, reviews and snacks go with it.</div>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>
                  Keep it
                </button>
                <button className="btn btn-bad" disabled={busy} onClick={remove}>
                  Yes, remove
                </button>
              </div>
            </div>
          ) : (
            <button className="w-full text-center text-xs font-bold text-muted underline" onClick={() => setConfirming(true)}>
              Remove this listing from history
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/** The ten-minute verdict, taken while the movie is still running. */
export function ImpressionSheet({ night, open, onClose }: { night: NightDetail; open: boolean; onClose: () => void }) {
  const [score, setScore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit() {
    if (score == null) return;
    setBusy(true);
    setError(null);
    try {
      await send("POST", `/api/nights/${night.night.id}/impressions`, { score });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Ten minutes in — what's the verdict?">
      <p className="mb-3 text-sm text-muted">Gut call, no deliberating. It stays hidden until everyone has rated the film at the end, then we see who called it.</p>
      <ScorePicker value={score} onChange={setScore} />
      <ErrorNote error={error} />
      <button className="btn btn-gold mt-4 w-full" disabled={score == null || busy} onClick={submit}>
        {score == null ? "Pick a score" : `Lock in ${score}`}
      </button>
    </Sheet>
  );
}
