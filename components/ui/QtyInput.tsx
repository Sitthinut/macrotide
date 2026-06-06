"use client";

// QtyInput — quantity entry with a Units ↔ ฿ switcher. ONE number in ONE box; the
// toggle is a TYPE BADGE on what you typed (Units or ฿ Total), not a converter:
// flipping it keeps your figure and just re-reads it as the other kind, so picking
// the wrong type is a one-tap fix. Useful because many Thai broker apps show a
// holding's value, not its unit count.
//
// FACTS-ONLY (ADR 0004): the box persists exactly ONE fact — the side you typed.
// Units mode writes `units` (and clears the ฿ value); ฿ mode writes `value` (the
// canonical ฿ total — a trade's `amount`, a Balance's value) and leaves `units`
// EMPTY. It never derives-and-stores the other side: the projection fold computes
// the missing side on READ (units = ฿ ÷ (price ?? NAV); amount = units × NAV). That
// keeps `units` empty ⟺ "typed a total", so a saved row reopens in the SAME mode it
// was entered — which `units`-presence alone encodes (see `qtyDefaultMode`). Both
// inline editors (the Add modal + History) wire it the same way, so they match.

import { useState } from "react";

export interface QtyInputProps {
  units: string;
  /** Canonical ฿ total — a trade's `amount`, a Balance's value. The fold derives
   *  units from it on read; this box never freezes a derived unit count. */
  value?: string;
  onUnits: (units: string) => void;
  /** Lift the typed ฿ total so it persists on the row and reaches the save. */
  onValue?: (value: string) => void;
  /** Force the initial mode. A saved row carries only the typed fact, so
   *  `qtyDefaultMode(units)` recovers the entry mode: units present → Units, else ฿. */
  defaultMode?: "units" | "total";
  ariaLabel?: string;
}

/**
 * The mode a stored row reopens in: a read unit count → Units; otherwise ฿ Total (a
 * value-only Balance / amount-only trade). Because a row persists only the side the
 * user typed (see the file header), `units`-presence faithfully encodes the entry
 * mode. Shared by BOTH inline editors so the Add modal and History behave identically.
 */
export function qtyDefaultMode(units: string): "units" | "total" {
  return units.trim() ? "units" : "total";
}

export function QtyInput({
  units,
  value,
  onUnits,
  onValue,
  defaultMode,
  ariaLabel = "Units",
}: QtyInputProps) {
  // ONE number in ONE box; the Units ↔ ฿ Total toggle just RE-TYPES it — like a type
  // badge on what you entered. Flipping the toggle keeps your figure (no convert, no
  // clear), so picking the wrong kind is a one-tap fix. Initial mode: a caller hint
  // (`defaultMode`), else inferred — a non-empty ฿ `value` means Total (Units mode
  // clears `value`, so value set ⟺ Total during entry).
  const [mode, setMode] = useState<"units" | "total">(
    () => defaultMode ?? (value?.trim() ? "total" : "units"),
  );
  const inBaht = mode === "total";
  const text = inBaht ? (value ?? "") : units;

  // Write the typed number to its canonical field and CLEAR the other, so the row
  // stores only the fact you gave. In ฿ mode units stay empty — the fold derives them
  // (฿ ÷ (price ?? NAV)) on read, never a frozen count here; in Units mode the ฿ value
  // is cleared so it can't override on save. (ADR 0004 / value-only Balance, #130.)
  const apply = (v: string, m: "units" | "total") => {
    if (m === "total") {
      onValue?.(v);
      onUnits("");
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
