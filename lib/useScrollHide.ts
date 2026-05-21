"use client";

import { useEffect } from "react";

/**
 * Google-Play-style "hide topbar on scroll-down, show on scroll-up". Sets a
 * `data-topbar-hidden` attribute on `<body>` that CSS reads to translateY
 * the topbar and slide the sub-tabs up to fill its space.
 *
 * Graceful degradation: without JS (or with prefers-reduced-motion), the
 * attribute is never set and the layout stays in its base sticky state —
 * topbar and sub-tabs both pinned, same across every screen.
 *
 * Scroll context varies by viewport: mobile scrolls `window`, tablet/desktop
 * scrolls `.ra-main` (which has its own overflow-y). Scroll events don't
 * bubble, but capture-phase delegation on `document` catches both.
 */

const HIDE_AFTER_PX = 60; // ignore tiny scrolls at the top
const NOISE_PX = 4; // delta below this is treated as no movement

export function useScrollHide(): void {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let lastY = 0;
    let rafId = 0;

    const update = () => {
      rafId = 0;
      const main = document.querySelector<HTMLElement>(".ra-main");
      const y = main ? main.scrollTop : window.scrollY;
      const delta = y - lastY;
      if (Math.abs(delta) < NOISE_PX) return;
      if (delta > 0 && y > HIDE_AFTER_PX) {
        document.body.dataset.topbarHidden = "true";
      } else if (delta < 0) {
        document.body.dataset.topbarHidden = "false";
      }
      lastY = y;
    };

    const onScroll = () => {
      if (rafId !== 0) return;
      rafId = window.requestAnimationFrame(update);
    };

    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
      document.removeEventListener("scroll", onScroll, { capture: true });
      delete document.body.dataset.topbarHidden;
    };
  }, []);
}
