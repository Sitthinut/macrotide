import { describe, expect, it, vi } from "vitest";
import { scrollScreenToTop } from "./scrollScreenToTop";

// The scroll-root selection logic is the testable core: tablet/desktop scroll
// the OverlayScrollbars viewport inside `.ra-main`; mobile (no viewport) falls
// back to the window. We inject fake doc/win so this runs in the node env
// without a real browser.

describe("scrollScreenToTop", () => {
  it("resets the OverlayScrollbars viewport when present (tablet/desktop)", () => {
    const viewport = { scrollTop: 420 } as HTMLElement;
    const doc = { querySelector: () => viewport } as unknown as Document;
    const scrollTo = vi.fn();
    const win = { scrollTo } as unknown as Window;

    scrollScreenToTop(doc, win);

    expect(viewport.scrollTop).toBe(0);
    // Window is left alone when a viewport owns the scroll.
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("falls back to window.scrollTo when there is no viewport (mobile)", () => {
    const doc = { querySelector: () => null } as unknown as Document;
    const scrollTo = vi.fn();
    const win = { scrollTo } as unknown as Window;

    scrollScreenToTop(doc, win);

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });
});
