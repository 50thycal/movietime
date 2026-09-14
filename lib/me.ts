"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Which member this phone belongs to. This is the one thing localStorage is
 * for — everything else lives in Postgres and is shared.
 */
const KEY = "movietime:member";

export function getMemberId(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function useMe() {
  const [me, setMeState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setMeState(getMemberId());
    setReady(true);
  }, []);
  const setMe = useCallback((id: string | null) => {
    try {
      if (id) window.localStorage.setItem(KEY, id);
      else window.localStorage.removeItem(KEY);
    } catch {
      /* private mode etc. — the app still works, they'll just be asked again */
    }
    setMeState(id);
  }, []);
  return { me, setMe, ready };
}
