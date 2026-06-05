"use client";

// QtyInput — quantity entry with a units ↔ ฿ switcher. You hold the canonical
// UNITS; the toggle lets you instead type a ฿ value, from which units are derived
// (units = ฿ ÷ price). Useful because many Thai broker apps show a holding's
// value, not its unit count. The price comes from the row (a trade's Price, or a
// Balance's current price / avg cost); when there's no price yet, ฿ entry can't
// derive units, so the toggle simply waits for one.

import { useState } from "react";

export interface QtyInputProps {
  units: string;
  /** Per-unit price used to convert a ฿ value into units. */
  price: string;
  onUnits: (units: string) => void;
  ariaLabel?: string;
}

const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return String(Math.round(n * f) / f);
};

export function QtyInput({ units, price, onUnits, ariaLabel = "Units" }: QtyInputProps) {
  // null = entering units; a string = entering a ฿ value (the raw text typed).
  const [baht, setBaht] = useState<string | null>(null);
  const p = Number(price);
  const hasPrice = Number.isFinite(p) && p > 0;
  const inBaht = baht !== null;

  const onBaht = (v: string) => {
    setBaht(v);
    if (v.trim() === "") onUnits("");
    else if (hasPrice) onUnits(round(Number(v) / p, 6));
  };
  const toggle = () => {
    if (inBaht) setBaht(null);
    // Entering ฿ mode: prefill from current units × price.
    else setBaht(hasPrice && units.trim() ? round(Number(units) * p, 2) : "");
  };

  return (
    <div className="qty-input">
      <input
        value={inBaht ? (baht ?? "") : units}
        onChange={(e) => (inBaht ? onBaht(e.target.value) : onUnits(e.target.value))}
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
