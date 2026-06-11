"use client";

// The Portfolio chart's "VS" benchmark control, as removable pills.
//
// Off state is a single "+ Compare" chip; once a benchmark is chosen it becomes a
// pill (label + ✕ to clear, tap the label to change). The pill row is built to
// grow into MULTIPLE benchmarks later: render one pill per selected key plus a
// trailing "+ Add" chip, and lift `value`/`onChange` to an array. For now it's
// single-select (the chart overlays one benchmark line), so there's one pill at a
// time and the "+ Compare" chip stands in for the future "+ Add".
//
// The menu reuses the shared `.combobox__list` styling + `useFlipUp` placement
// (the same logic the symbol Combobox uses) so it sizes, flips, and looks like
// every other dropdown in the app.

import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { BENCHMARK_TR_OPTIONS } from "@/lib/market/benchmark-options";
import { useFlipUp } from "@/lib/useFlipUp";

// Fixed height so the off chip and the active pill (which has an extra ✕ child)
// are exactly the same height — no jump on select.
const CONTROL: CSSProperties = { height: 32, boxSizing: "border-box" };

export function BenchmarkPicker({
  value,
  onChange,
}: {
  /** Selected benchmark key, or "none" when off. */
  value: string;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { up, measure } = useFlipUp(ref);

  const active = BENCHMARK_TR_OPTIONS.find((b) => b.key === value);

  // Measure placement BEFORE the list renders so it never flips after opening.
  function toggle() {
    if (!open) measure();
    setOpen((o) => !o);
  }

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // On open, move focus into the list (the selected option, or the first).
  useEffect(() => {
    if (!open) return;
    const opts = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    const selected = opts.find((o) => o.getAttribute("aria-selected") === "true");
    (selected ?? opts[0])?.focus();
  }, [open]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        measure();
        setOpen(true);
      }
      return;
    }
    const opts = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    const idx = opts.indexOf(document.activeElement as HTMLButtonElement);
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case "ArrowDown":
        e.preventDefault();
        opts[Math.min(idx + 1, opts.length - 1)]?.focus();
        break;
      case "ArrowUp":
        e.preventDefault();
        opts[Math.max(idx - 1, 0)]?.focus();
        break;
      case "Home":
        e.preventDefault();
        opts[0]?.focus();
        break;
      case "End":
        e.preventDefault();
        opts[opts.length - 1]?.focus();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    // inline-flex so the wrapper hugs its content — a click to the right of the
    // control (empty chart row) lands outside it and closes the menu.
    <div
      ref={ref}
      onKeyDown={onKeyDown}
      style={{
        position: "relative",
        display: "inline-flex",
        flexWrap: "wrap",
        gap: 6,
        alignItems: "center",
        margin: "10px 4px 0",
      }}
    >
      {active ? (
        // Span padding is 0 so the two inner buttons fill the pill — clicking the
        // swatch or anywhere on the label area (not just the text) opens the menu.
        <span className="btn ghost sm" style={{ ...CONTROL, padding: 0, gap: 0 }}>
          <button
            ref={triggerRef}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={`Comparing against ${active.label} — change`}
            onClick={toggle}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: "100%",
              padding: "0 4px 0 12px",
              background: "none",
              border: "none",
              cursor: "pointer",
              font: "inherit",
              color: "inherit",
            }}
          >
            {/* Dashed swatch in the benchmark color, matching its chart line. */}
            <span
              aria-hidden="true"
              style={{ width: 14, flex: "none", borderTop: "1.5px dashed var(--benchmark)" }}
            />
            {active.label}
          </button>
          <button
            type="button"
            aria-label="Remove benchmark"
            onClick={(e) => {
              e.stopPropagation();
              onChange("none");
              setOpen(false);
            }}
            style={{
              height: "100%",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--muted)",
              fontSize: 15,
              lineHeight: 1,
              padding: "0 8px 0 2px",
            }}
          >
            ×
          </button>
        </span>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          className="btn ghost sm"
          style={CONTROL}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={toggle}
        >
          + Compare
        </button>
      )}
      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-label="Benchmark"
          className="combobox__list"
          data-up={up || undefined}
        >
          {BENCHMARK_TR_OPTIONS.map((b) => (
            <button
              key={b.key}
              type="button"
              role="option"
              aria-selected={b.key === value}
              className="combobox__option"
              style={b.key === value ? { background: "var(--accent-soft)" } : undefined}
              onClick={() => {
                onChange(b.key);
                setOpen(false);
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
