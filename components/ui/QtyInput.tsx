"use client";

// QtyInput — quantity entry with a units ↔ ฿ switcher. You hold the canonical
// UNITS; the toggle lets you instead type a ฿ value, from which units are derived
// (units = ฿ ÷ price). Useful because many Thai broker apps show a holding's
// value, not its unit count. The price comes from the row (a trade's Price, or a
// Balance's current price / avg cost); when there's no price yet, ฿ entry can't
// derive units LOCALLY — so it lifts the raw ฿ total up via `onValue`, and the
// server derives units from value ÷ NAV(date) at save (the value-only Balance
// case, #130). A row that arrives value-only (a ฿ total, no units) opens in ฿
// mode so the figure the user actually has is what they see.

import { useState } from "react";

export interface QtyInputProps {
  units: string;
  /** Per-unit price used to convert a ฿ value into units. */
  price: string;
  /** Canonical ฿ total, persisted on the row even when no price can turn it into
   *  units here yet — the server derives units from value ÷ NAV(date) (#130). */
  value?: string;
  onUnits: (units: string) => void;
  /** Lift the typed ฿ total so it persists on the row and reaches the save. */
  onValue?: (value: string) => void;
  ariaLabel?: string;
}

const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return String(Math.round(n * f) / f);
};

export function QtyInput({
  units,
  price,
  value,
  onUnits,
  onValue,
  ariaLabel = "Units",
}: QtyInputProps) {
  const p = Number(price);
  const hasPrice = Number.isFinite(p) && p > 0;
  // null = entering units; a string = entering a ฿ value (the raw text typed). A
  // row seeded value-only (a ฿ total, no units) opens in ฿ mode showing that total.
  const [baht, setBaht] = useState<string | null>(() =>
    value?.trim() && !units.trim() ? value : null,
  );
  const inBaht = baht !== null;

  const onBaht = (v: string) => {
    setBaht(v);
    onValue?.(v);
    if (v.trim() === "") onUnits("");
    else if (hasPrice) onUnits(round(Number(v) / p, 6));
    // No price → leave units empty; the lifted ฿ value carries to the server.
  };
  const onUnitsText = (v: string) => {
    onUnits(v);
    // Typing a unit count makes units canonical — drop any lingering ฿ value so the
    // server doesn't try to re-derive from a stale total.
    if (value?.trim()) onValue?.("");
  };
  const toggle = () => {
    if (inBaht) {
      setBaht(null);
      if (value?.trim()) onValue?.("");
    } else {
      // Entering ฿ mode: prefill from the stored value, else units × price.
      setBaht(value?.trim() ? value : hasPrice && units.trim() ? round(Number(units) * p, 2) : "");
    }
  };

  return (
    <div className="qty-input">
      <input
        value={inBaht ? (baht ?? "") : units}
        onChange={(e) => (inBaht ? onBaht(e.target.value) : onUnitsText(e.target.value))}
        placeholder={inBaht ? "฿ total" : "Units"}
        inputMode="decimal"
        aria-label={inBaht ? "Total in baht" : ariaLabel}
        style={{ paddingRight: 52 }}
      />
      <button
        type="button"
        className="qty-input__toggle"
        title={
          inBaht ? "Entering the ฿ total — tap for units" : "Entering units — tap for the ฿ total"
        }
        aria-label="Switch between units and total"
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
      >
        {inBaht ? "Total" : "Units"}
      </button>
    </div>
  );
}
