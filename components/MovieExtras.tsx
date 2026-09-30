"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { preconnect } from "react-dom";
import { useApp } from "@/components/Shell";
import { useMovieExtras } from "@/lib/api";
import { serviceLabel } from "@/lib/streaming";
import { IMAGE_BASE } from "@/lib/tmdb";
import type { CastMember, MovieExtras, MovieWithExtras, WatchProvider } from "@/lib/types";

/** Clamped to a few lines; tap to read the rest. The toggle only appears when something is actually hidden. */
export function Synopsis({ text, lines = 4, className = "text-xs" }: { text: string; lines?: number; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);
  if (!text) return null;
  const toggle = overflows || open;
  // Stops the tap here: in the search sheet the whole row is a "propose" button.
  const onTap = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setOpen(!open);
  };
  return (
    <div className={toggle ? "cursor-pointer" : undefined} onClick={toggle ? onTap : undefined}>
      <p ref={ref} className={`${className} text-muted`} style={open ? undefined : { display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {text}
      </p>
      {toggle && <span className="mt-0.5 inline-block text-xs font-bold text-gold">{open ? "less ▴" : "more ▾"}</span>}
    </div>
  );
}

/**
 * Tagline, where to watch, trailer and cast for one film. Pass `initial` when
 * the caller already has the data (a spin result) so nothing refetches.
 */
export function MovieExtrasPanel({ tmdbId, initial }: { tmdbId: number; initial?: MovieWithExtras }) {
  const { data, error } = useMovieExtras(tmdbId, initial);
  if (error) return null;
  if (!data) return <div className="h-10 animate-pulse rounded-xl bg-card-2" />;
  const x = data.extras;
  return (
    <div className="flex flex-col gap-3">
      {x.tagline && <div className="text-sm font-bold italic text-ink/80">“{x.tagline}”</div>}
      <WhereToWatch providers={x.providers} />
      {x.trailer_key && <Trailer videoKey={x.trailer_key} title={data.movie.title} />}
      <CastRow cast={x.cast} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {x.certification && <span className="rounded border border-line px-1.5 py-0.5 font-bold text-ink">{x.certification}</span>}
        {data.movie.director && <span>Dir. {data.movie.director}</span>}
        {x.imdb_id && (
          <a className="font-bold text-gold" href={`https://www.imdb.com/title/${x.imdb_id}/`} target="_blank" rel="noreferrer">
            IMDb ↗
          </a>
        )}
        {x.providers.link && (
          <a className="font-bold text-gold" href={x.providers.link} target="_blank" rel="noreferrer">
            All watch options ↗
          </a>
        )}
      </div>
    </div>
  );
}

function Logo({ p, dim = false }: { p: WatchProvider; dim?: boolean }) {
  return p.logo_path ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`${IMAGE_BASE}/w92${p.logo_path}`} alt={p.provider_name} title={p.provider_name} className={`h-9 w-9 shrink-0 rounded-lg ${dim ? "opacity-40" : ""}`} />
  ) : (
    <span className={`chip ${dim ? "opacity-40" : ""}`}>{p.provider_name}</span>
  );
}

export function WhereToWatch({ providers }: { providers: MovieExtras["providers"] }) {
  const { state } = useApp();
  const ours = new Set(state?.streaming.services ?? []);
  const isOurs = (p: WatchProvider) => p.service != null && ours.has(p.service);
  const mine = providers.stream.filter(isOurs);
  const others = providers.stream.filter((p) => !isOurs(p));
  const onServices = [...new Set(mine.map((p) => serviceLabel(p.service!)))];
  const rent = providers.rent.slice(0, 4);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="label">Where to watch</div>
      {onServices.length ? (
        <div className="text-sm font-black text-good">✓ On {onServices.join(", ")}</div>
      ) : providers.stream.length ? (
        <div className="text-sm font-bold text-muted">Not on your services</div>
      ) : rent.length ? (
        <div className="text-sm font-bold text-muted">Not streaming — rent only</div>
      ) : (
        <div className="text-sm font-bold text-muted">No US streaming or rental listed</div>
      )}
      {(mine.length > 0 || others.length > 0) && (
        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto">
          {mine.map((p) => (
            <div key={p.provider_id} className="rounded-xl ring-2 ring-good">
              <Logo p={p} />
            </div>
          ))}
          {others.map((p) => (
            <Logo key={p.provider_id} p={p} dim />
          ))}
        </div>
      )}
      {!onServices.length && rent.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-muted">Rent:</span>
          {rent.map((p) => (
            <Logo key={p.provider_id} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The YouTube player itself, not a thumbnail: on iPhone a thumbnail-then-iframe
 * swap costs a second tap (Safari won't autoplay a cross-origin iframe), so the
 * real player is mounted straight away and one tap plays it. The connections
 * are warmed as soon as we know a trailer exists; `loading="lazy"` keeps
 * off-screen players from loading at all.
 */
export function Trailer({ videoKey, title }: { videoKey: string; title: string }) {
  preconnect("https://www.youtube-nocookie.com");
  preconnect("https://i.ytimg.com");
  preconnect("https://www.google.com");
  return (
    <div className="flex flex-col gap-1">
      <div className="relative w-full overflow-hidden rounded-xl bg-black" style={{ aspectRatio: "16 / 9" }}>
        <iframe
          key={videoKey}
          className="absolute inset-0 h-full w-full"
          src={`https://www.youtube-nocookie.com/embed/${videoKey}?playsinline=1&rel=0&modestbranding=1`}
          title={`${title} trailer`}
          loading="lazy"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
      <a className="self-end text-[11px] font-bold text-muted" href={`https://www.youtube.com/watch?v=${videoKey}`} target="_blank" rel="noreferrer">
        Open in YouTube ↗
      </a>
    </div>
  );
}

export function CastRow({ cast }: { cast: CastMember[] }) {
  if (!cast.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="label">Cast</div>
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
        {cast.map((c) => (
          <div key={c.name} className="flex w-16 shrink-0 flex-col items-center gap-1 text-center">
            {c.profile_path ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${IMAGE_BASE}/w185${c.profile_path}`} alt={c.name} loading="lazy" className="h-14 w-14 rounded-full object-cover" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-card-2 text-lg font-black text-muted">{c.name.slice(0, 1)}</div>
            )}
            <div className="line-clamp-2 text-[11px] font-bold leading-tight">{c.name}</div>
            {c.character && <div className="line-clamp-1 w-full text-[10px] text-muted">{c.character}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
