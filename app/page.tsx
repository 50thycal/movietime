"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useWishlist } from "@/lib/api";
import { ApprovalRow, MovieHeader, STATUS_LABEL } from "@/components/NightCard";
import { useApp } from "@/components/Shell";
import { ChangePickerSheet, PickSheet, PredictSheet, RateSheet, RejectSheet } from "@/components/sheets";
import { Avatar, ErrorNote, Poster } from "@/components/ui";
import { send } from "@/lib/api";
import { fmtRuntime, fmtScore } from "@/lib/format";
import { summarizeRatings } from "@/lib/scoring";
import type { NightDetail, Todo } from "@/lib/types";

type Open = "pick" | "rate" | "predict" | "reject" | "picker" | null;

export default function Tonight() {
  return (
    <Suspense>
      <TonightInner />
    </Suspense>
  );
}

function TonightInner() {
  const { state, me, members } = useApp();
  const [open, setOpen] = useState<Open>(null);
  const params = useSearchParams();
  const { data: wishlist } = useWishlist();
  // /?pick=1 (from the wishlist's "Pick →") opens the pick sheet straight away.
  useEffect(() => {
    if (params.get("pick") === "1") setOpen("pick");
  }, [params]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!state || !me) return null;

  const current = state.current;
  const turn = state.rotation.current;
  const myTurn = turn?.id === me.id;

  async function act(fn: () => Promise<unknown>) {
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
    <div className="flex flex-col gap-4 pt-1">
      {/* 1. Whose turn */}
      <section
        className="card relative overflow-hidden p-5 text-left"
        style={{ borderColor: turn?.color }}
        role={current ? undefined : "button"}
        onClick={() => !current && setOpen("picker")}
      >
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full opacity-25 blur-2xl" style={{ background: turn?.color }} />
        <div className="flex items-center justify-between">
          <div className="label">{current ? "Tonight's picker" : "Up next"}</div>
          <div className="flex items-center gap-2">
            <span className="chip" title="Your voting coins">🪙 {state.balances[me.id] ?? 0}</span>
            {!current && <span className="chip">change</span>}
          </div>
        </div>
        <div className="mt-1 flex items-center gap-4">
          <Avatar member={turn} size={64} ring />
          <div>
            <div className="text-3xl font-black leading-none">{turn?.name ?? "Nobody"}</div>
            <div className="mt-1 text-sm text-muted">
              {current
                ? current.night.status === "proposed" && current.candidates.length > 1
                  ? "Vote in progress"
                  : STATUS_LABEL[current.night.status]
                : myTurn
                  ? "It's your pick!"
                  : `${turn?.name} is choosing`}
            </div>
          </div>
        </div>
      </section>

      {state.todos.length > 0 && <TodoCard todos={state.todos} />}

      {/* 2. Current movie + 3. primary action */}
      {current ? (
        <section className="card flex flex-col gap-4 p-4">
          {current.night.status === "proposed" && current.candidates.length > 1 ? (
            <VoteBoard detail={current} meId={me.id} busy={busy} act={act} />
          ) : (
            <>
              <MovieHeader detail={current} members={members} />
              {current.night.status === "proposed" && <ApprovalRow detail={current} members={members} />}
            </>
          )}
          <PrimaryAction detail={current} meId={me.id} busy={busy} setOpen={setOpen} act={act} />
          <ErrorNote error={error} />
        </section>
      ) : (
        <section className="card flex flex-col gap-3 p-5">
          {state.watched_count === 0 && (
            <div>
              <div className="text-lg font-black">MovieTime is ready.</div>
              <div className="text-sm text-muted">{turn?.name} has the first pick.</div>
            </div>
          )}
          {myTurn ? (
            <button className="btn btn-gold w-full text-lg" onClick={() => setOpen("pick")}>
              🎬 Pick a Movie
            </button>
          ) : (
            <div className="text-center text-sm text-muted">
              Waiting for <b className="text-ink">{turn?.name}</b> to pick. Nudge them.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Link href="/history?tab=wishlist" className="btn btn-ghost">
              💡 Wishlist{wishlist?.length ? ` · ${wishlist.length}` : ""}
            </Link>
            <Link href="/roulette" className="btn btn-ghost">
              🎲 Roulette
            </Link>
          </div>
        </section>
      )}

      {/* 4. Rotation */}
      <section className="card p-4">
        <div className="label mb-2">Rotation</div>
        <div className="flex items-center justify-between">
          {[turn, ...state.rotation.upcoming].map((m, i) =>
            m ? (
              <div key={m.id} className={`flex flex-col items-center gap-1 ${i === 0 ? "" : "opacity-70"}`}>
                <Avatar member={m} size={i === 0 ? 44 : 36} ring={i === 0} />
                <span className="text-xs font-bold">{m.name}</span>
                <span className="text-[10px] text-muted">{i === 0 ? "now" : `+${i}`}</span>
              </div>
            ) : null,
          )}
        </div>
      </section>

      {/* 5. Recent movie */}
      {state.last_complete && <RecentCard detail={state.last_complete} />}

      {/* 6. Roulette */}
      {current && (
        <Link href="/roulette" className="btn btn-ghost w-full">
          🎲 What should we watch next?
        </Link>
      )}

      <PickSheet open={open === "pick"} onClose={() => setOpen(null)} />
      <ChangePickerSheet open={open === "picker"} onClose={() => setOpen(null)} />
      {current && <RateSheet night={current} open={open === "rate"} onClose={() => setOpen(null)} />}
      {current && <PredictSheet key={current.my_prediction?.updated_at ?? "p"} night={current} open={open === "predict"} onClose={() => setOpen(null)} />}
      {current && <RejectSheet night={current} open={open === "reject"} onClose={() => setOpen(null)} />}
    </div>
  );
}

function PrimaryAction({
  detail,
  meId,
  busy,
  setOpen,
  act,
}: {
  detail: NightDetail;
  meId: string;
  busy: boolean;
  setOpen: (o: Open) => void;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const { members } = useApp();
  const { night } = detail;
  const id = night.id;
  const isSelector = night.selector_id === meId;
  const activeIds = members.filter((m) => m.active).map((m) => m.id);

  if (night.status === "proposed" && detail.candidates.length > 1) {
    const voted = detail.votes.some((v) => v.member_id === meId);
    const left = activeIds.filter((x) => !detail.votes.some((v) => v.member_id === x)).length;
    return (
      <div className="flex flex-col gap-2">
        <div className="btn btn-ghost w-full cursor-default">{voted ? `🗳 Vote cast · waiting on ${left}` : "🗳 Tap a movie above to vote"}</div>
        {isSelector && (
          <button className="text-center text-xs font-bold text-muted underline" disabled={busy} onClick={() => act(() => send("DELETE", `/api/nights/${id}`))}>
            Withdraw the shortlist
          </button>
        )}
      </div>
    );
  }
  if (night.status === "proposed") {
    if (isSelector) {
      const waiting = activeIds.filter((x) => x !== meId && !detail.approvals.some((a) => a.member_id === x)).length;
      return (
        <div className="flex flex-col gap-2">
          <div className="btn btn-ghost w-full cursor-default">⏳ Waiting on {waiting} approval{waiting === 1 ? "" : "s"}</div>
          <button className="text-center text-xs font-bold text-muted underline" disabled={busy} onClick={() => act(() => send("DELETE", `/api/nights/${id}`))}>
            Withdraw and pick something else
          </button>
        </div>
      );
    }
    const mine = detail.approvals.find((a) => a.member_id === meId);
    if (mine) {
      return <div className="btn btn-ghost w-full cursor-default">{mine.decision === "approve" ? "✓ You approved — waiting on the others" : "✕ You rejected"}</div>;
    }
    return (
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <button className="btn btn-good" disabled={busy} onClick={() => act(() => send("POST", `/api/nights/${id}/approval`, { decision: "approve" }))}>
          ✓ Approve
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => setOpen("reject")}>
          ✕
        </button>
      </div>
    );
  }
  if (night.status === "approved") {
    return (
      <div className="flex flex-col gap-2">
        <button className="btn btn-gold w-full text-lg" disabled={busy} onClick={() => act(() => send("POST", `/api/nights/${id}/start`))}>
          ▶ Start Movie
        </button>
        <button className="btn btn-ghost w-full" onClick={() => setOpen("predict")}>
          🎯 {detail.my_prediction ? `Your call: ${fmtScore(detail.my_prediction.own_score)} · change` : "Predict your score"}
        </button>
      </div>
    );
  }
  if (night.status === "watching") {
    return (
      <button className="btn btn-gold w-full text-lg" disabled={busy} onClick={() => act(() => send("POST", `/api/nights/${id}/finish`))}>
        🍿 Movie&apos;s over → Rate it
      </button>
    );
  }
  if (night.status === "rating") {
    const rated = detail.rated_member_ids.includes(meId);
    const left = activeIds.filter((x) => !detail.rated_member_ids.includes(x));
    return (
      <div className="flex flex-col gap-2">
        {rated ? (
          <div className="btn btn-ghost w-full cursor-default">🔒 You gave {fmtScore(detail.my_rating)} · waiting on {left.length}</div>
        ) : (
          <button className="btn btn-gold w-full text-lg" onClick={() => setOpen("rate")}>
            ⭐ Rate Movie
          </button>
        )}
        <div className="flex justify-center gap-1.5">
          {members
            .filter((m) => m.active)
            .map((m) => (
              <div key={m.id} className={detail.rated_member_ids.includes(m.id) ? "" : "opacity-30 grayscale"}>
                <Avatar member={m} size={26} />
              </div>
            ))}
        </div>
      </div>
    );
  }
  return null;
}

function VoteBoard({ detail, meId, busy, act }: { detail: NightDetail; meId: string; busy: boolean; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const { members, state } = useApp();
  const myVote = detail.votes.find((v) => v.member_id === meId) ?? null;
  const mine = myVote?.movie_id ?? null;
  // What you can put behind a vote: your balance plus whatever this vote already holds.
  const available = (state?.balances[meId] ?? 0) + (myVote?.amount ?? 0);
  const [stake, setStake] = useState<number>(myVote?.amount ?? 0);
  const clamped = Math.min(stake, available);
  const quick = [0, 5, 10, 25, 50].filter((q) => q <= available);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="label">{detail.selector.name}&apos;s shortlist · vote for one</div>
        <span className="text-xs text-muted">{detail.votes.length}/{members.filter((m) => m.active).length} voted</span>
      </div>
      <div className="flex flex-col gap-1.5 rounded-xl bg-bg-2 p-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold">🪙 Coins behind your vote</span>
          <span className="text-muted">{available} available</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {quick.map((q) => (
            <button key={q} className={`chip ${clamped === q ? "chip-on" : ""}`} onClick={() => setStake(q)}>
              {q}
            </button>
          ))}
          {available > 0 && (
            <button className={`chip ${clamped === available && !quick.includes(available) ? "chip-on" : ""}`} onClick={() => setStake(available)}>
              all {available}
            </button>
          )}
          <input
            type="number"
            min={0}
            max={available}
            value={clamped}
            onChange={(e) => setStake(Math.max(0, Math.min(available, Math.floor(Number(e.target.value) || 0))))}
            className="input ml-auto w-20 min-h-9 text-center"
            aria-label="Coins"
          />
        </div>
        <div className="text-[11px] text-muted">Spent coins are gone. A vote with 0 coins still counts as one voice. Everyone gets an allowance each new cycle.</div>
      </div>
      {detail.candidates.map((c) => {
        const cv = detail.votes.filter((v) => v.movie_id === c.id);
        const voters = cv.map((v) => members.find((m) => m.id === v.member_id));
        const coins = cv.reduce((a, v) => a + Math.max(1, v.amount), 0);
        const on = mine === c.id;
        return (
          <button
            key={c.id}
            disabled={busy}
            onClick={() => act(() => send("POST", `/api/nights/${detail.night.id}/vote`, { movie_id: c.id, amount: clamped }))}
            className={`flex items-center gap-3 rounded-2xl border p-2 text-left transition active:scale-[0.99] ${on ? "border-gold bg-gold/10" : "border-line bg-bg-2"}`}
          >
            <Poster path={c.poster_path} title={c.title} className="w-14 shrink-0" size="w185" />
            <div className="min-w-0 flex-1">
              <div className="font-black leading-tight">
                {c.title} {c.year && <span className="font-bold text-muted">({c.year})</span>}
              </div>
              <div className="text-xs text-gold">⏱ {fmtRuntime(c.runtime_min)}</div>
              <div className="truncate text-xs text-muted">{c.genres.map((g) => g.name).join(" · ")}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="text-xl font-black">
                {coins} <span className="text-xs font-bold text-muted">🪙</span>
              </div>
              <div className="flex -space-x-1">
                {voters.map((m) => (
                  <Avatar key={m?.id} member={m} size={18} />
                ))}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function TodoCard({ todos }: { todos: Todo[] }) {
  const [openList, setOpenList] = useState(true);
  const [busy, setBusy] = useState(false);
  const icon: Record<Todo["kind"], string> = { backfill: "🕰️", rate_missing: "⭐", approve: "✓", vote: "🗳", rate_now: "⭐", predict: "🎯" };
  return (
    <section className="card p-4">
      <button className="flex w-full items-center justify-between" onClick={() => setOpenList((o) => !o)}>
        <div className="label">Your to-dos · {todos.length}</div>
        <span className="chip">{openList ? "hide" : "show"}</span>
      </button>
      {openList && (
        <div className="mt-2 flex flex-col gap-1.5">
          {todos.slice(0, 8).map((t) => (
            <div key={t.key} className="flex items-center gap-2 rounded-xl bg-bg-2 px-3 py-2">
              <span className="text-lg">{icon[t.kind]}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{t.title}</div>
                {t.detail && <div className="truncate text-[11px] text-muted">{t.detail}</div>}
              </div>
              {t.href && t.href !== "/" && (
                <Link href={t.href} className="chip chip-on">
                  Go
                </Link>
              )}
              {t.dismissible && (
                <button
                  className="chip"
                  disabled={busy}
                  title="Mark done"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await send("POST", `/api/tasks/${t.key}`);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Done
                </button>
              )}
            </div>
          ))}
          {todos.length > 8 && <div className="text-center text-xs text-muted">+{todos.length - 8} more</div>}
        </div>
      )}
    </section>
  );
}

function RecentCard({ detail }: { detail: NightDetail }) {
  const { members } = useApp();
  const s = summarizeRatings(detail.ratings, detail.night.selector_id);
  const selector = members.find((m) => m.id === detail.night.selector_id);
  return (
    <Link href={`/movie/${detail.night.id}`} className="card flex items-center gap-3 p-3">
      <div className="w-14 shrink-0">
        <Poster path={detail.movie.poster_path} title={detail.movie.title} size="w185" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="label">Last watched</div>
        <div className="truncate font-black">{detail.movie.title}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <Avatar member={selector} size={16} /> {selector?.name}
        </div>
      </div>
      <div className="text-right">
        <div className="text-3xl font-black text-gold">{fmtScore(s.average)}</div>
        <div className="text-[10px] text-muted">See results →</div>
      </div>
    </Link>
  );
}
