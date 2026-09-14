"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect } from "react";
import { useHomeState } from "@/lib/api";
import { useMe } from "@/lib/me";
import type { HomeState, Member } from "@/lib/types";
import { Avatar, Spinner } from "./ui";

interface Ctx {
  me: Member | null;
  meId: string | null;
  setMe: (id: string | null) => void;
  state: HomeState | undefined;
  members: Member[];
  memberById: (id: string | null | undefined) => Member | null;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside Shell");
  return c;
}

const NAV = [
  { href: "/", label: "Tonight", icon: "🍿" },
  { href: "/history", label: "History", icon: "🎞️" },
  { href: "/roulette", label: "Roulette", icon: "🎲" },
  { href: "/stats", label: "Stats", icon: "🏆" },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const { me: meId, setMe, ready } = useMe();
  const { data: state, error } = useHomeState();
  const pathname = usePathname();
  const router = useRouter();

  const members = state?.members ?? [];
  const memberById = (id: string | null | undefined) => members.find((m) => m.id === id) ?? null;
  const me = memberById(meId);

  // Setup gate: nobody exists yet → go set up the group.
  useEffect(() => {
    if (state && !state.setup_complete && pathname !== "/setup") router.replace("/setup");
  }, [state, pathname, router]);

  // A remembered member that no longer exists (database reset) → ask again.
  useEffect(() => {
    if (ready && meId && state?.setup_complete && !memberById(meId)) setMe(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, meId, state]);

  const ctx: Ctx = { me, meId, setMe, state, members, memberById };

  let body: React.ReactNode;
  if (!ready || (!state && !error)) {
    body = (
      <div className="flex h-[70dvh] items-center justify-center">
        <Spinner />
      </div>
    );
  } else if (error && !state) {
    body = (
      <div className="card m-5 p-5">
        <div className="text-lg font-black">Can&apos;t reach the database</div>
        <p className="mt-1 text-sm text-muted">{String((error as Error).message)}</p>
      </div>
    );
  } else if (state && !state.setup_complete) {
    body = children; // /setup renders itself
  } else if (state && !me && pathname !== "/setup") {
    body = <WhoAreYou members={members} onPick={setMe} />;
  } else {
    body = children;
  }

  const showNav = state?.setup_complete && me;

  return (
    <AppCtx.Provider value={ctx}>
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
        <header className="flex items-center justify-between px-5 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-2">
          <Link href="/" className="text-xl font-black tracking-tight">
            🎬 MovieTime
          </Link>
          {showNav && (
            <Link href="/settings" className="flex items-center gap-2" aria-label="Settings">
              <span className="text-sm font-bold text-muted">{me.name}</span>
              <Avatar member={me} size={32} />
            </Link>
          )}
        </header>
        <main className={`flex-1 px-4 ${showNav ? "pb-28" : "pb-8"}`}>{body}</main>
        {showNav && (
          <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/90 backdrop-blur-md">
            <div className="safe-b mx-auto grid max-w-lg grid-cols-4 pt-1">
              {NAV.map((n) => {
                const on = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
                return (
                  <Link key={n.href} href={n.href} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-extrabold ${on ? "text-gold" : "text-muted"}`}>
                    <span className="text-2xl leading-none">{n.icon}</span>
                    {n.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        )}
      </div>
    </AppCtx.Provider>
  );
}

function WhoAreYou({ members, onPick }: { members: Member[]; onPick: (id: string) => void }) {
  return (
    <div className="pop flex flex-col gap-4 pt-6">
      <div>
        <div className="label">First things first</div>
        <h1 className="text-3xl font-black">Who are you?</h1>
        <p className="mt-1 text-sm text-muted">This phone will remember. You can change it in Settings.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {members
          .filter((m) => m.active)
          .map((m) => (
            <button key={m.id} onClick={() => onPick(m.id)} className="card flex flex-col items-center gap-3 py-6 active:scale-95" style={{ borderColor: m.color }}>
              <Avatar member={m} size={56} />
              <span className="text-lg font-black">{m.name}</span>
            </button>
          ))}
      </div>
    </div>
  );
}
