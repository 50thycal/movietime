"use client";

import { posterUrl } from "@/lib/tmdb";
import type { Member } from "@/lib/types";
import { useEffect } from "react";

export function Avatar({ member, size = 36, ring = false }: { member: Member | null | undefined; size?: number; ring?: boolean }) {
  if (!member) return <div style={{ width: size, height: size }} className="rounded-full bg-card-2" />;
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-black"
      style={{
        width: size,
        height: size,
        background: member.color,
        color: "#0b0a0f",
        fontSize: size * 0.42,
        boxShadow: ring ? `0 0 0 3px var(--bg), 0 0 0 5px ${member.color}` : undefined,
      }}
      title={member.name}
    >
      {member.emoji || member.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function Poster({ path, title, className = "", size = "w342" }: { path: string | null | undefined; title: string; className?: string; size?: "w185" | "w342" | "w500" }) {
  const url = posterUrl(path, size);
  return (
    <div className={`poster ${className}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={title} loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs font-bold text-muted">{title}</div>
      )}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="rise flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-3xl border border-line bg-bg-2"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="text-lg font-black">{title}</h2>
          <button className="chip" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="safe-b overflow-y-auto px-5 pb-4">{children}</div>
      </div>
    </div>
  );
}

/** 1–10 in half points, big enough to hit with a thumb. */
export function ScorePicker({ value, onChange, disabled }: { value: number | null; onChange: (n: number) => void; disabled?: boolean }) {
  const steps: number[] = [];
  for (let s = 1; s <= 10; s += 0.5) steps.push(s);
  return (
    <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
      {steps.map((s) => {
        const on = value === s;
        const whole = Number.isInteger(s);
        return (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => onChange(s)}
            className={`min-h-12 rounded-xl border text-base font-black transition ${
              on ? "border-gold bg-gold text-gold-ink" : whole ? "border-line bg-card-2 text-ink" : "border-line bg-card text-muted"
            }`}
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}

export function Stars({ value, onChange, size = 30 }: { value: number | null; onChange?: (n: number) => void; size?: number }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(n)}
          style={{ fontSize: size * 0.7, width: size, height: size }}
          className={`flex items-center justify-center leading-none ${value != null && n <= value ? "text-gold" : "text-line"}`}
          aria-label={`${n} star`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, body, children }: { title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="text-xl font-black">{title}</div>
      {body && <p className="text-sm text-muted">{body}</p>}
      {children}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <div className="rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm font-semibold text-bad">{msg}</div>;
}

export function Spinner() {
  return <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-line border-t-gold" />;
}
