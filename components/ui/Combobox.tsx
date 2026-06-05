"use client";

// Combobox — the app's one custom autocomplete dropdown. A text input with a
// styled suggestion list (NOT the native <datalist>, which can't show a second
// line, tags, or an in-input adornment). Generic over the suggestion type: the
// caller supplies the items, a key, and how to render each one. Ported from the
// original AddHoldingsSheet symbol field so every custom dropdown — symbol,
// source, anything future — shares this behavior and styling.

import { type CSSProperties, type ReactNode, useId, useRef, useState } from "react";

export interface ComboboxProps<T> {
  value: string;
  onChange: (value: string) => void;
  /** A suggestion was chosen (mousedown, before blur). */
  onPick: (item: T) => void;
  /** Suggestions to show while focused. Empty → no dropdown. */
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  placeholder?: string;
  /** aria-label for the input. */
  label?: string;
  title?: string;
  invalid?: boolean;
  autoComplete?: string;
  /** Right-edge adornment rendered inside the field (e.g. a price-source badge). */
  trailing?: ReactNode;
  /** Right padding reserved for `trailing`. */
  trailingPad?: number;
  /** Render the list upward (when the field sits near the bottom of a sheet). */
  openUp?: boolean;
  inputClassName?: string;
  inputStyle?: CSSProperties;
  onFocus?: () => void;
  onBlur?: () => void;
}

export function Combobox<T>({
  value,
  onChange,
  onPick,
  items,
  getKey,
  renderItem,
  placeholder,
  label,
  title,
  invalid,
  autoComplete = "off",
  trailing,
  trailingPad = 42,
  openUp,
  inputClassName,
  inputStyle,
  onFocus,
  onBlur,
}: ComboboxProps<T>) {
  const [open, setOpen] = useState(false);
  // Measured fallback: if there isn't room below the input for the list, drop it
  // UPWARD instead. The floor is the nearest SCROLL CONTAINER's bottom (e.g. a
  // modal body, whose bottom edge is exactly where the sticky footer begins) —
  // not the viewport — so the list never hides under a sticky footer. `openUp`
  // forces it; otherwise we measure on focus.
  const [flipUp, setFlipUp] = useState(false);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = open && items.length > 0;
  const up = openUp || flipUp;

  const measureFlip = () => {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // The floor the list must stay above. Inside a modal the most reliable bound
    // is the sticky FOOTER's top (the scroll area uses OverlayScrollbars, which
    // re-parents content so an overflow:auto walk misses it). Fall back to the
    // nearest scrollable ancestor, then the viewport.
    let bottomBound = window.innerHeight;
    let topBound = 0;
    const modal = el.closest(".modal");
    const footer = modal?.querySelector(".modal-footer");
    const header = modal?.querySelector(".modal-header");
    if (footer) bottomBound = footer.getBoundingClientRect().top;
    if (header) topBound = header.getBoundingClientRect().bottom;
    if (!footer) {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const oy = getComputedStyle(node).overflowY;
        if (oy === "auto" || oy === "scroll") {
          const r = node.getBoundingClientRect();
          bottomBound = r.bottom;
          topBound = r.top;
          break;
        }
      }
    }
    const spaceBelow = bottomBound - rect.bottom;
    const spaceAbove = rect.top - topBound;
    // ~240px ≈ the list's max-height plus a little headroom. Flip up only when
    // below is too tight AND above has more room.
    setFlipUp(spaceBelow < 240 && spaceAbove > spaceBelow);
  };

  return (
    <div className="combobox">
      <input
        ref={inputRef}
        className={inputClassName}
        value={value}
        onChange={(e) => {
          setOpen(true);
          onChange(e.target.value);
        }}
        onFocus={() => {
          measureFlip();
          setOpen(true);
          onFocus?.();
        }}
        onBlur={() => {
          // Delay so a mousedown on an option lands before the list unmounts.
          if (blurTimer.current) clearTimeout(blurTimer.current);
          blurTimer.current = setTimeout(() => setOpen(false), 120);
          onBlur?.();
        }}
        placeholder={placeholder}
        aria-label={label}
        title={title}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={show}
        aria-controls={listId}
        aria-invalid={invalid || undefined}
        autoComplete={autoComplete}
        style={{ ...(trailing ? { paddingRight: trailingPad } : null), ...inputStyle }}
      />
      {trailing}
      {show && (
        <div id={listId} role="listbox" className="combobox__list" data-up={up || undefined}>
          {items.map((item) => (
            <button
              key={getKey(item)}
              type="button"
              role="option"
              aria-selected={false}
              className="combobox__option"
              // mousedown fires before blur — keeps the input focused so the
              // list doesn't unmount before the pick runs.
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(item);
                setOpen(false);
              }}
            >
              {renderItem(item)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
