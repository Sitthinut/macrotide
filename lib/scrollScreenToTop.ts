"use client";

/**
 * Reset the active screen's scroll container to the top.
 *
 * Screens are swapped in place inside a single persistent scroll container
 * (see App.tsx) rather than being separate routes, so the container keeps its
 * `scrollTop` across a swap. Without this, navigating to a new screen (e.g. the
 * Templates view from the Portfolio "target" affordance) inherits the previous
 * screen's scroll offset and opens scrolled partway down.
 *
 * The scroll root differs by viewport, mirroring useScrollHide:
 *   - tablet/desktop: the OverlayScrollbars-generated viewport inside `.ra-main`
 *     (`.ra-main`'s own scrollTop stays 0 — the generated child scrolls).
 *   - mobile: the `window` (native scroll); `.ra-main` does not exist.
 *
 * `doc`/`win` are injectable so the root-selection logic is testable without a
 * real browser.
 */

const VIEWPORT_SELECTOR = ".ra-main [data-overlayscrollbars-viewport]";

export function scrollScreenToTop(
  doc: Pick<Document, "querySelector"> = typeof document !== "undefined"
    ? document
    : (undefined as unknown as Document),
  win: Pick<Window, "scrollTo"> = typeof window !== "undefined"
    ? window
    : (undefined as unknown as Window),
): void {
  // Tablet/desktop: scroll the OverlayScrollbars viewport. Mobile has no
  // `.ra-main`, so this is null and we fall back to the window.
  const viewport = doc?.querySelector?.<HTMLElement>(VIEWPORT_SELECTOR) ?? null;
  if (viewport) {
    viewport.scrollTop = 0;
    return;
  }
  win?.scrollTo?.(0, 0);
}
