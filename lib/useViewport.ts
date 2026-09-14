"use client";

import { useEffect, useState } from "react";

/**
 * A soft keyboard doesn't change the layout viewport on iOS — it only shrinks
 * the *visual* viewport and slides it around. Anything positioned `fixed`
 * (the bottom nav, a sheet pinned to the bottom) therefore ends up underneath
 * the keyboard, and the browser "helpfully" scrolls the page to chase the
 * focused input. Measuring the gap between the two viewports lets the UI get
 * out of the way instead.
 */
const KEYBOARD_THRESHOLD = 120;

export interface ViewportInsets {
  /** Visible height in CSS pixels, or null before the first measurement. */
  height: number | null;
  /** Pixels hidden at the bottom by a soft keyboard. 0 when it's closed. */
  keyboard: number;
}

export function useViewportInsets(): ViewportInsets {
  const [insets, setInsets] = useState<ViewportInsets>({ height: null, keyboard: 0 });

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const read = () => {
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // A collapsing address bar also shrinks the visual viewport, so only a
      // substantial gap counts as a keyboard.
      setInsets({ height: vv.height, keyboard: hidden > KEYBOARD_THRESHOLD ? Math.round(hidden) : 0 });
    };
    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    return () => {
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
    };
  }, []);

  return insets;
}
