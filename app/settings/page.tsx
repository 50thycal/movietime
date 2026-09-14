"use client";

import { useState } from "react";
import { useApp } from "@/components/Shell";
import { Avatar, ErrorNote } from "@/components/ui";
import { send, useVersionInfo } from "@/lib/api";
import { rotationOrder } from "@/lib/rotation";
import type { Member } from "@/lib/types";

const COLORS = ["#ff5c8a", "#ffb02e", "#3ddc97", "#5aa9ff", "#c084fc", "#f97316", "#22d3ee", "#a3e635"];

export default function SettingsPage() {
  const { state, me, setMe, members } = useApp();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const version = useVersionInfo();
  if (!state) return null;

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
  const order = rotationOrder(members);
  const current = state.rotation.current;

  return (
    <div className="flex flex-col gap-4 pt-1">
      <h1 className="text-2xl font-black">Settings</h1>

      <section className="card flex flex-col gap-2 p-4">
        <div className="label">This phone is</div>
        <div className="flex items-center gap-3">
          <Avatar member={me} size={40} />
          <div className="flex-1 text-lg font-black">{me?.name}</div>
          <button className="chip" onClick={() => setMe(null)}>
            Switch person
          </button>
        </div>
      </section>

      <section className="card flex flex-col gap-3 p-4">
        <div className="label">Whose turn is it?</div>
        <p className="text-xs text-muted">Skipped a night or someone picked out of order? Set it straight here. Takes effect immediately for everyone.</p>
        <div className="grid grid-cols-2 gap-2">
          {order.map((m) => (
            <button
              key={m.id}
              disabled={busy || !!state.current}
              className={`btn ${current?.id === m.id ? "btn-gold" : "btn-ghost"} justify-start gap-2`}
              onClick={() => run(() => send("POST", "/api/rotation", { member_id: m.id }))}
            >
              <Avatar member={m} size={24} /> {m.name}
            </button>
          ))}
        </div>
        {state.current && <div className="text-xs text-muted">Locked while a movie is in play.</div>}
      </section>

      <CoinsSection />

      <section className="card flex flex-col gap-3 p-4">
        <div className="label">Picking order (one cycle = one full pass)</div>
        <p className="text-xs text-muted">
          Cycle {state.cycle.number}. When the turn comes back round to {members.find((m) => m.id === state.cycle.first_member_id)?.name ?? "the first person"}, a new cycle starts and everyone gets their allowance.
        </p>
        {members
          .slice()
          .sort((a, b) => a.rotation_position - b.rotation_position)
          .map((m, i, arr) => (
            <div key={m.id} className={`flex items-center gap-2 ${m.active ? "" : "opacity-50"}`}>
              <span className="w-5 text-center text-sm font-black text-muted">{i + 1}</span>
              <Avatar member={m} size={30} />
              <span className="flex-1 font-bold">
                {m.name} {!m.active && <span className="text-xs text-muted">(inactive)</span>}
              </span>
              <button className="chip" disabled={busy || i === 0} onClick={() => run(() => swap(arr[i], arr[i - 1]))} aria-label="Move up">
                ↑
              </button>
              <button className="chip" disabled={busy || i === arr.length - 1} onClick={() => run(() => swap(arr[i], arr[i + 1]))} aria-label="Move down">
                ↓
              </button>
              <button className="chip" onClick={() => setEditing(m)}>
                Edit
              </button>
            </div>
          ))}
      </section>

      {editing && <EditMember member={editing} onClose={() => setEditing(null)} run={run} busy={busy} />}
      <ErrorNote error={error} />

      <div className="text-center text-[11px] text-muted">
        MovieTime · build {version?.build ?? "dev"}
      </div>
    </div>
  );

  async function swap(a: Member, b: Member) {
    await send("PATCH", `/api/members/${a.id}`, { rotation_position: b.rotation_position });
    await send("PATCH", `/api/members/${b.id}`, { rotation_position: a.rotation_position });
  }
}

function CoinsSection() {
  const { state, members } = useApp();
  const [initial, setInitial] = useState(String(state?.budget.initial ?? 100));
  const [allowance, setAllowance] = useState(String(state?.budget.allowance ?? 50));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  if (!state) return null;
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await fn();
      setSaved(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card flex flex-col gap-3 p-4">
      <div className="label">🪙 Voting coins</div>
      <p className="text-xs text-muted">Everyone starts with the same budget and can stake any of it on shortlist votes. A new cycle pays everyone the allowance.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-bold text-muted">
          Starting budget
          <input type="number" min={0} className="input mt-1" value={initial} onChange={(e) => setInitial(e.target.value)} />
        </label>
        <label className="text-xs font-bold text-muted">
          Allowance per cycle
          <input type="number" min={0} className="input mt-1" value={allowance} onChange={(e) => setAllowance(e.target.value)} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn btn-ghost" disabled={busy} onClick={() => run(() => send("POST", "/api/budget", { initial: Number(initial), allowance: Number(allowance) }))}>
          {saved ? "Saved ✓" : "Save amounts"}
        </button>
        <button className="btn btn-gold" disabled={busy} onClick={() => run(() => send("POST", "/api/budget", { action: "new_cycle" }))}>
          Pay allowance now
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        {members
          .filter((m) => m.active)
          .map((m) => (
            <div key={m.id} className="flex items-center gap-2 text-sm">
              <Avatar member={m} size={24} />
              <span className="flex-1 font-bold">{m.name}</span>
              <button className="chip" disabled={busy} onClick={() => run(() => send("POST", "/api/budget", { member_id: m.id, delta: -10 }))} aria-label={`Take 10 from ${m.name}`}>
                −10
              </button>
              <span className="w-14 text-right text-lg font-black text-gold">{state.balances[m.id] ?? 0}</span>
              <button className="chip" disabled={busy} onClick={() => run(() => send("POST", "/api/budget", { member_id: m.id, delta: 10 }))} aria-label={`Give 10 to ${m.name}`}>
                +10
              </button>
            </div>
          ))}
      </div>
      <ErrorNote error={error} />
    </section>
  );
}

function EditMember({ member, onClose, run, busy }: { member: Member; onClose: () => void; run: (fn: () => Promise<unknown>) => Promise<void>; busy: boolean }) {
  const [name, setName] = useState(member.name);
  const [emoji, setEmoji] = useState(member.emoji);
  const [color, setColor] = useState(member.color);
  const [active, setActive] = useState(member.active);
  return (
    <section className="card flex flex-col gap-3 p-4" style={{ borderColor: color }}>
      <div className="label">Edit {member.name}</div>
      <div className="flex gap-2">
        <input className="input w-16 text-center" value={emoji} maxLength={4} onChange={(e) => setEmoji(e.target.value)} aria-label="Emoji" />
        <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Name" />
      </div>
      <div className="flex flex-wrap gap-2">
        {COLORS.map((c) => (
          <button key={c} className="h-9 w-9 rounded-full" style={{ background: c, outline: color === c ? "3px solid white" : undefined, outlineOffset: 2 }} onClick={() => setColor(c)} aria-label={c} />
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> In the rotation (uncheck if they&apos;ve moved away)
      </label>
      <div className="flex gap-2">
        <button className="btn btn-ghost flex-1" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-gold flex-1"
          disabled={busy || !name.trim()}
          onClick={() => run(async () => (await send("PATCH", `/api/members/${member.id}`, { name, emoji: emoji || "🎬", color, active }), onClose()))}
        >
          Save
        </button>
      </div>
    </section>
  );
}
