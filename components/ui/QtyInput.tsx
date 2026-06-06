"use client";

// QtyInput — quantity entry with a units ↔ ฿ switcher. ONE number in ONE box; the
// toggle is a TYPE BADGE on what you typed (Units or ฿ Total), not a converter:
// flipping it keeps your figure and just re-reads it as the other kind, so picking
// the wrong type is a one-tap fix. Useful because many Thai broker apps show a
// holding's value, not its unit count. The canonical field follows the badge — Units
// → `units`; Total → `value` (a trade's `amount`) with units DERIVED (฿ ÷ price). When
// there's no price, ฿ entry can't derive units locally, so the raw ฿ total lifts up
// via `onValue` and the server derives units from value ÷ NAV(date) at save (the
// value-only Balance case, #130). A row that arrives value-only opens in ฿ mode.

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
  // ONE number in ONE box; the Units ↔ ฿ Total toggle just RE-TYPES it — like a type
  // badge on what you entered. Flipping the toggle keeps your figure (no convert, no
  // clear), so picking the wrong kind is a one-tap fix. The mode is inferred from the
  // row so it survives collapse/reopen: a non-empty ฿ `value` means Total mode (Units
  // mode always clears `value`, so value set ⟺ Total).
  const [mode, setMode] = useState<"units" | "total">(() => (value?.trim() ? "total" : "units"));
  const inBaht = mode === "total";
  const text = inBaht ? (value ?? "") : units;

  // Write the typed number to its canonical field and keep the OTHER as the DERIVED
  // one: in Total mode, units = ฿ ÷ price (or cleared when there's no price — the
  // server then derives units from value ÷ NAV(date) at save), never a stale count;
  // in Units mode, the ฿ value is cleared so it can't override on save.
  const apply = (v: string, m: "units" | "total") => {
    if (m === "total") {
      onValue?.(v);
      onUnits(v.trim() === "" ? "" : hasPrice ? round(Number(v) / p, 6) : "");
    } else {
      onUnits(v);
      if (value?.trim()) onValue?.("");
    }
  };

  const toggle = () => {
    const next = inBaht ? "units" : "total";
    setMode(next);
    apply(text, next); // re-type the SAME number as the new kind — don't clear it
  };

  return (
    <div className="qty-input">
      <input
        value={text}
        onChange={(e) => apply(e.target.value, mode)}
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
