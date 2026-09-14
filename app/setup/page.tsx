"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { send } from "@/lib/api";
import { useApp } from "@/components/Shell";
import { ErrorNote } from "@/components/ui";
import type { Member } from "@/lib/types";

export default function SetupPage() {
  const { state, setMe } = useApp();
  const router = useRouter();
  const [names, setNames] = useState(["", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Already set up (someone else beat this phone to it) → straight to Tonight.
  useEffect(() => {
    if (state?.setup_complete) router.replace("/");
  }, [state?.setup_complete, router]);
  if (state?.setup_complete) return null;

  const filled = names.map((n) => n.trim()).filter(Boolean);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const members = await send<Member[]>("POST", "/api/setup", { names: filled });
      setMe(members[0].id);
      router.replace("/");
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <div className="pop flex flex-col gap-5 pt-6">
      <div>
        <div className="label">Welcome</div>
        <h1 className="text-3xl font-black">Who&apos;s in the group?</h1>
        <p className="mt-1 text-sm text-muted">Top to bottom is the picking order. The first name gets the first pick. You can fix this later in Settings.</p>
      </div>
      <div className="flex flex-col gap-2">
        {names.map((n, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="w-6 text-center text-lg font-black text-muted">{i + 1}</span>
            <input
              className="input"
              placeholder={["Calvin", "Molly", "Name", "Name"][i] ?? "Name"}
              value={n}
              maxLength={40}
              autoCapitalize="words"
              onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))}
            />
          </div>
        ))}
        {names.length < 6 && (
          <button className="chip self-start" onClick={() => setNames([...names, ""])}>
            + another person
          </button>
        )}
      </div>
      <ErrorNote error={error} />
      <button className="btn btn-gold" disabled={filled.length < 2 || busy} onClick={submit}>
        {busy ? "Setting up…" : "Start MovieTime"}
      </button>
      <p className="text-center text-xs text-muted">This phone will be signed in as {filled[0] || "the first person"}.</p>
    </div>
  );
}
