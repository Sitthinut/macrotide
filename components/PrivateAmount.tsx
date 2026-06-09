"use client";

import type { ReactNode } from "react";
import { usePrivacy } from "@/lib/stores/privacy";

// Fixed placeholders we blur when hidden. The real digits are never rendered —
// blurring them would leak magnitude via width — so every masked amount in a
// comparison group shares one placeholder and therefore one width. `wide` is the
// hero total (genuinely 6–8 figures); the short form fits per-row / history /
// P&L amounts so the mask sits where real numbers normally do.
const PLACEHOLDER_WIDE = "123,454,321.21";
const PLACEHOLDER_SHORT = "12,345,456";

/**
 * Wraps a monetary amount so it masks out ("Discreet Mode") when privacy is on.
 *
 * When hidden we render a crisp ฿ sign followed by a blurred fixed placeholder
 * (see `.private-amt-digits` in globals.css) — it reads like a real hidden
 * balance, but because the placeholder is constant, neither the digits nor the
 * width leak the true amount.
 *
 * - `wide` uses the long placeholder (hero total only).
 * - `tappable` makes the masked value itself a button that reveals everything
 *   (the hero total isn't already inside a clickable row).
 */
export function PrivateAmount({
  children,
  tappable = false,
  wide = false,
}: {
  children: ReactNode;
  tappable?: boolean;
  wide?: boolean;
}) {
  const { hidden, toggle } = usePrivacy();

  if (!hidden) return <>{children}</>;

  // App is ฿-only, so the mask owns its currency sign + placeholder and ignores
  // the children's text entirely while hidden (no real digits reach the DOM).
  const mask = (
    <>
      ฿
      <span
        className={wide ? "private-amt-digits private-amt-digits--wide" : "private-amt-digits"}
        aria-hidden="true"
      >
        {wide ? PLACEHOLDER_WIDE : PLACEHOLDER_SHORT}
      </span>
      <span className="sr-only">hidden</span>
    </>
  );

  // Tappable masked value: a real <button> that reveals everything — native
  // keyboard + a11y, no manual key handling.
  if (tappable) {
    return (
      <button
        type="button"
        className="private-amt"
        data-private="true"
        aria-label="Show portfolio values"
        title="Show values"
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        {mask}
      </button>
    );
  }

  return (
    <span className="private-amt" data-private="true">
      {mask}
    </span>
  );
}
