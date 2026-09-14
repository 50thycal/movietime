"use client";

import { useState } from "react";
import { send } from "@/lib/api";
import { fmtRelative, fmtScore } from "@/lib/format";
import { summarizeRatings } from "@/lib/scoring";
import { AWARD_META, predictionResults, type AwardKey } from "@/lib/stats";
import { mean, round1 } from "@/lib/scoring";
import type { Member, NightDetail, SnackKind } from "@/lib/types";
import { useApp } from "./Shell";
import { Avatar, ErrorNote, ScorePicker, Stars } from "./ui";

export function Results({ detail }: { detail: NightDetail }) {
  const { members } = useApp();
  const s = summarizeRatings(detail.ratings, detail.night.selector_id);
  if (detail.night.status !== "complete") return null;
  const sorted = detail.ratings.slice().sort((a, b) => b.score - a.score);
  const stat = (label: string, value: string | number | null | undefined, accent = false) => (
    <div className="rounded-xl bg-bg-2 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-lg font-black ${accent ? "text-gold" : ""}`}>{value ?? "—"}</div>
    </div>
  );
  return (
    <section className="card flex flex-col gap-4 p-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="label">Group rating</div>
          <div className="text-5xl font-black text-gold">{fmtScore(s.average)}</div>
        </div>
        <div className="text-right text-xs text-muted">
          {s.lowest} → {s.highest} · spread {fmtScore(s.spread)}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {sorted.map((r, i) => {
          const m = members.find((x) => x.id === r.member_id);
          const isSel = r.member_id === detail.night.selector_id;
          return (
            <div key={r.id} className="pop flex items-center gap-2 rounded-xl bg-bg-2 px-3 py-2" style={{ animationDelay: `${i * 80}ms` }}>
              <Avatar member={m} size={30} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">
                  {m?.name} {isSel && <span className="text-[10px] text-gold">PICKER</span>}
                </div>
              </div>
              <div className="text-2xl font-black">{fmtScore(r.score)}</div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {stat("Picker gave", fmtScore(s.selector_score))}
        {stat("Others avg", fmtScore(s.average_excluding_selector))}
        {stat("Picker vs group", s.selector_delta == null ? "—" : `${s.selector_delta > 0 ? "+" : ""}${fmtScore(s.selector_delta)}`, true)}
      </div>
    </section>
  );
}

export function Awards({ detail }: { detail: NightDetail }) {
  const { members } = useApp();
  if (!detail.awards?.length) return null;
  return (
    <section className="card p-4">
      <div className="label mb-2">Awards</div>
      <div className="flex flex-col gap-2">
        {detail.awards.map((a) => {
          const meta = AWARD_META[a.key as AwardKey];
          const m = members.find((x) => x.id === a.member_id);
          return (
            <div key={a.key} className="flex items-center gap-3 rounded-xl bg-bg-2 px-3 py-2">
              <span className="text-2xl">{meta?.emoji}</span>
              <div className="min-w-0 flex-1">
                <div className="font-black">{meta?.label}</div>
                <div className="text-xs text-muted">{a.detail}</div>
              </div>
              {m && (
                <div className="flex items-center gap-1 text-xs font-bold">
                  <Avatar member={m} size={20} /> {m.name}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function Predictions({ detail }: { detail: NightDetail }) {
  const { members } = useApp();
  if (detail.night.status !== "complete" || !detail.predictions.length) return null;
  const results = predictionResults({ night: detail.night, movie: detail.movie, ratings: detail.ratings, predictions: detail.predictions, first_impressions: detail.first_impressions, snacks: [], snack_ratings: [] });
  const groupAvg = summarizeRatings(detail.ratings, detail.night.selector_id).average;
  return (
    <section className="card p-4">
      <div className="label mb-2">Predictions</div>
      <div className="flex flex-col gap-1.5">
        {results
          .slice()
          .sort((a, b) => (a.own_error ?? 99) - (b.own_error ?? 99))
          .map((r) => {
            const m = members.find((x) => x.id === r.member_id);
            return (
              <div key={r.member_id} className="flex items-center gap-2 text-sm">
                <Avatar member={m} size={22} />
                <span className="w-16 truncate font-bold">{m?.name}</span>
                <span className="text-muted">
                  called <b className="text-ink">{fmtScore(r.predicted_own)}</b>, gave <b className="text-ink">{fmtScore(r.actual_own)}</b>
                </span>
                <span className="ml-auto font-black text-gold">±{fmtScore(r.own_error)}</span>
                {r.predicted_group != null && (
                  <span className="text-xs text-muted" title="group prediction">
                    · grp {fmtScore(r.predicted_group)}/{fmtScore(groupAvg)}
                  </span>
                )}
              </div>
            );
          })}
      </div>
    </section>
  );
}

/** Ten minutes in versus the final word, once the scores are out. */
export function FirstImpressions({ detail }: { detail: NightDetail }) {
  const { members } = useApp();
  if (detail.night.status !== "complete" || !detail.first_impressions.length) return null;
  const rows = detail.first_impressions
    .map((f) => ({ f, final: detail.ratings.find((r) => r.member_id === f.member_id)?.score ?? null }))
    .filter((x) => x.final != null)
    .map((x) => ({ member_id: x.f.member_id, first: x.f.score, final: x.final as number, delta: round1((x.final as number) - x.f.score)! }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  if (!rows.length) return null;
  const groupFirst = round1(mean(rows.map((r) => r.first)));
  const groupFinal = round1(mean(rows.map((r) => r.final)));
  const drift = groupFirst != null && groupFinal != null ? round1(groupFinal - groupFirst) : null;
  return (
    <section className="card flex flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between">
        <div className="label">Ten minutes in → final</div>
        {drift != null && (
          <div className="text-xs font-bold">
            <span className="text-muted">{fmtScore(groupFirst)}</span> → <span className="text-gold">{fmtScore(groupFinal)}</span>{" "}
            <span className={drift > 0 ? "text-good" : drift < 0 ? "text-bad" : "text-muted"}>
              {drift > 0 ? "+" : ""}
              {fmtScore(drift)}
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => {
          const m = members.find((x) => x.id === r.member_id);
          return (
            <div key={r.member_id} className="flex items-center gap-2 text-sm">
              <Avatar member={m} size={22} />
              <span className="w-16 truncate font-bold">{m?.name}</span>
              <span className="text-muted">{fmtScore(r.first)}</span>
              <span className="text-muted">→</span>
              <span className="font-black">{fmtScore(r.final)}</span>
              <span className={`ml-auto font-black ${r.delta > 0 ? "text-good" : r.delta < 0 ? "text-bad" : "text-muted"}`}>
                {r.delta > 0 ? "+" : ""}
                {fmtScore(r.delta)}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted">
        {drift != null && drift > 0.5
          ? "It won the room over."
          : drift != null && drift < -0.5
            ? "It lost the room."
            : "The room had it pegged from the start."}
      </p>
    </section>
  );
}

export function Reviews({ detail }: { detail: NightDetail }) {
  const { members, meId } = useApp();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const id = detail.night.id;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card flex flex-col gap-3 p-4">
      <div className="label">Reviews</div>
      {detail.reviews.length === 0 && <div className="text-sm text-muted">No hot takes yet.</div>}
      {detail.reviews.map((r) => {
        const m = members.find((x) => x.id === r.member_id);
        const mine = r.member_id === meId;
        return (
          <div key={r.id} className="flex gap-2">
            <Avatar member={m} size={28} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 text-xs text-muted">
                <b className="text-ink">{m?.name}</b> {fmtRelative(r.created_at)}
                {r.updated_at !== r.created_at && " · edited"}
                {mine && editing !== r.id && (
                  <>
                    <button className="ml-auto underline" onClick={() => (setEditing(r.id), setDraft(r.text))}>
                      edit
                    </button>
                    <button className="underline" onClick={() => run(() => send("DELETE", `/api/reviews/${r.id}`))}>
                      delete
                    </button>
                  </>
                )}
              </div>
              {editing === r.id ? (
                <div className="mt-1 flex gap-2">
                  <input className="input" value={draft} maxLength={500} onChange={(e) => setDraft(e.target.value)} />
                  <button className="btn btn-gold px-3" disabled={busy || !draft.trim()} onClick={() => run(async () => (await send("PATCH", `/api/reviews/${r.id}`, { text: draft }), setEditing(null)))}>
                    Save
                  </button>
                </div>
              ) : (
                <div className="text-sm">{r.text}</div>
              )}
            </div>
          </div>
        );
      })}
      <div className="flex gap-2">
        <input className="input" placeholder="Short review…" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-ghost px-4" disabled={busy || !text.trim()} onClick={() => run(async () => (await send("POST", `/api/nights/${id}/reviews`, { text }), setText("")))}>
          Post
        </button>
      </div>
      <ErrorNote error={error} />
    </section>
  );
}

export function Snacks({ detail }: { detail: NightDetail }) {
  const { members, meId } = useApp();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SnackKind>("snack");
  const [note, setNote] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const id = detail.night.id;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const avg = (itemId: string) => {
    const rs = detail.snack_ratings.filter((r) => r.snack_item_id === itemId);
    return rs.length ? rs.reduce((a, b) => a + b.score, 0) / rs.length : null;
  };
  return (
    <section className="card flex flex-col gap-3 p-4">
      <div className="label">Snacks &amp; drinks</div>
      {detail.snacks.length === 0 && <div className="text-sm text-muted">Nothing logged. Popcorn doesn&apos;t count itself.</div>}
      {detail.snacks.map((s) => {
        const m = members.find((x) => x.id === s.member_id) as Member | undefined;
        const mine = detail.snack_ratings.find((r) => r.snack_item_id === s.id && r.member_id === meId)?.score ?? null;
        const a = avg(s.id);
        return (
          <div key={s.id} className="flex flex-col gap-1 rounded-xl bg-bg-2 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xl">{s.kind === "drink" ? "🍸" : "🍿"}</span>
              <div className="min-w-0 flex-1">
                <div className="font-black">{s.name}</div>
                <div className="flex items-center gap-1 text-xs text-muted">
                  <Avatar member={m} size={14} /> {m?.name}
                  {s.note && ` · ${s.note}`}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-black text-gold">{a == null ? "—" : fmtScore(a)}</div>
                <div className="text-[10px] text-muted">{detail.snack_ratings.filter((r) => r.snack_item_id === s.id).length} votes</div>
              </div>
              {s.member_id === meId && (
                <button className="text-xs text-muted underline" onClick={() => run(() => send("DELETE", `/api/snacks/${s.id}`))}>
                  remove
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase text-muted">Your rating</span>
              <Stars value={mine} onChange={(n) => run(() => send("POST", `/api/snacks/${s.id}/rating`, { score: n }))} size={28} />
            </div>
          </div>
        );
      })}
      <div className="flex flex-col gap-2 rounded-xl border border-dashed border-line p-3">
        <div className="flex gap-2">
          <button className={`chip ${kind === "snack" ? "chip-on" : ""}`} onClick={() => setKind("snack")}>
            🍿 Snack
          </button>
          <button className={`chip ${kind === "drink" ? "chip-on" : ""}`} onClick={() => setKind("drink")}>
            🍸 Drink
          </button>
        </div>
        <input className="input" placeholder={kind === "drink" ? "Margarita" : "Popcorn"} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <div className="flex gap-2">
          <input className="input" placeholder="Note (optional)" value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} />
          <button
            className="btn btn-ghost px-4"
            disabled={busy || !name.trim()}
            onClick={() => run(async () => (await send("POST", `/api/nights/${id}/snacks`, { name, kind, note: note || null }), setName(""), setNote("")))}
          >
            Add
          </button>
        </div>
      </div>
      <ErrorNote error={error} />
    </section>
  );
}

/** A completed night you never rated (backfilled, or you were away): add your score once. */
export function LateRating({ detail }: { detail: NightDetail }) {
  const { meId } = useApp();
  const [score, setScore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (detail.night.status !== "complete" || !meId || detail.rated_member_ids.includes(meId)) return null;
  async function submit() {
    if (score == null) return;
    setBusy(true);
    setError(null);
    try {
      await send("POST", `/api/nights/${detail.night.id}/ratings`, { score });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card flex flex-col gap-3 p-4">
      <div className="label">You haven&apos;t rated this one</div>
      <ScorePicker value={score} onChange={setScore} />
      <ErrorNote error={error} />
      <button className="btn btn-gold w-full" disabled={score == null || busy} onClick={submit}>
        {score == null ? "Pick a score" : `Add my ${score}`}
      </button>
    </section>
  );
}
