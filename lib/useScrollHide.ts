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
 * scrolls the OverlayScrollbars viewport inside `.ra-main`. OverlayScrollbars
 * takes over `.ra-main`'s overflow and moves the actual scrolling to a
 * generated child element carrying `[data-overlayscrollbars-viewport]`, so
 * `.ra-main.scrollTop` stays 0 — we must read the viewport's scrollTop
 * instead. Scroll events don't bubble, but capture-phase delegation on
 * `document` catches both the window and the viewport scroll.
 */

const VIEWPORT_SELECTOR = ".ra-main [data-overlayscrollbars-viewport]";

const HIDE_AFTER_PX = 60; // ignore tiny scrolls at the top
const NOISE_PX = 4; // delta below this is treated as no movement

export function useScrollHide(): void {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let lastY = 0;
    let rafId = 0;

    const update = () => {
      rafId = 0;
      // Desktop/tablet: read the OverlayScrollbars viewport (the element that
      // actually scrolls). Mobile has no `.ra-main`, so this is null and we
      // fall back to the window scroll position.
      const viewport = document.querySelector<HTMLElement>(VIEWPORT_SELECTOR);
      const y = viewport ? viewport.scrollTop : window.scrollY;
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
