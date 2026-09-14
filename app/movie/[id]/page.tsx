"use client";

import { use } from "react";
import { ApprovalRow, MovieHeader, STATUS_LABEL } from "@/components/NightCard";
import { Awards, LateRating, Predictions, Results, Reviews, Snacks } from "@/components/NightSections";
import { useApp } from "@/components/Shell";
import { ErrorNote, Spinner } from "@/components/ui";
import { useNight } from "@/lib/api";
import { fmtDate } from "@/lib/format";

export default function MoviePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error } = useNight(id);
  const { members } = useApp();
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;
  const n = data.night;
  return (
    <div className="flex flex-col gap-4 pt-1">
      <section className="card flex flex-col gap-3 p-4">
        <MovieHeader detail={data} members={members} link={false} />
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="chip">{STATUS_LABEL[n.status]}</span>
          {n.completed_at && <span>Watched {fmtDate(n.watched_at ?? n.completed_at)}</span>}
          {n.status === "rejected" && <span>Proposed {fmtDate(n.proposed_at)}</span>}
        </div>
        {data.movie.overview && <p className="text-sm text-muted">{data.movie.overview}</p>}
        {(n.status === "proposed" || n.status === "rejected") && <ApprovalRow detail={data} members={members} />}
        {n.status === "rejected" && data.approvals.some((a) => a.reason) && (
          <div className="text-xs text-bad">{data.approvals.filter((a) => a.reason).map((a) => `“${a.reason}”`).join(" ")}</div>
        )}
      </section>
      <Results detail={data} />
      <LateRating detail={data} />
      <Awards detail={data} />
      <Predictions detail={data} />
      {n.status !== "rejected" && (
        <>
          <Reviews detail={data} />
          <Snacks detail={data} />
        </>
      )}
    </div>
  );
}
