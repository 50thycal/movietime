"use client";

import Link from "next/link";
import { fmtRuntime } from "@/lib/format";
import type { Member, NightDetail } from "@/lib/types";
import { Avatar, Poster } from "./ui";

export const STATUS_LABEL: Record<string, string> = {
  proposed: "Waiting for approval",
  approved: "Approved · ready to watch",
  watching: "Now playing",
  rating: "Rating in progress",
  complete: "Complete",
  rejected: "Rejected",
};

/** Poster + title + meta. Used on Tonight, the last-movie card and the movie page header. */
export function MovieHeader({ detail, members, link = true }: { detail: NightDetail; members: Member[]; link?: boolean }) {
  const { movie, night } = detail;
  const selector = members.find((m) => m.id === night.selector_id);
  const body = (
    <div className="flex gap-4">
      <Poster path={movie.poster_path} title={movie.title} className="w-28 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <h2 className="text-xl font-black leading-tight">
          {movie.title} {movie.year && <span className="font-bold text-muted">({movie.year})</span>}
        </h2>
        <div className="flex flex-wrap gap-1.5">
          <span className="chip chip-on">⏱ {fmtRuntime(movie.runtime_min)}</span>
          {movie.genres.slice(0, 3).map((g) => (
            <span key={g.id} className="chip">
              {g.name}
            </span>
          ))}
        </div>
        {movie.director && <div className="text-xs text-muted">Directed by {movie.director}</div>}
        {movie.tmdb_rating != null && <div className="text-xs text-muted">TMDB {movie.tmdb_rating}/10</div>}
        {selector && (
          <div className="mt-auto flex items-center gap-2 text-sm font-bold">
            <Avatar member={selector} size={22} /> {selector.name}&apos;s pick
          </div>
        )}
      </div>
    </div>
  );
  return link ? (
    <Link href={`/movie/${night.id}`} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function ApprovalRow({ detail, members }: { detail: NightDetail; members: Member[] }) {
  const voters = members.filter((m) => m.active && m.id !== detail.night.selector_id);
  return (
    <div className="flex flex-wrap gap-2">
      {voters.map((m) => {
        const a = detail.approvals.find((x) => x.member_id === m.id);
        const state = a?.decision === "approve" ? "✓" : a?.decision === "reject" ? "✕" : "…";
        const cls = a?.decision === "approve" ? "text-good" : a?.decision === "reject" ? "text-bad" : "text-muted";
        return (
          <div key={m.id} className="chip gap-2" title={a?.reason ?? undefined}>
            <Avatar member={m} size={18} />
            {m.name}
            <span className={`text-base font-black ${cls}`}>{state}</span>
          </div>
        );
      })}
    </div>
  );
}
