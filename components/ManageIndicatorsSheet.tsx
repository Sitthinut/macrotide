"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { useMarketIndicatorPrefs } from "@/lib/fetchers/portfolio";
import { invalidate } from "@/lib/fetchers/swr";
import type { IndicatorDef, IndicatorGroup, IndicatorTier } from "@/lib/market/indicators";

export interface ManageIndicatorsSheetProps {
  open: boolean;
  onClose: () => void;
}

const TIER_LABEL: Record<IndicatorTier, string> = {
  keyless: "no key",
  "free-key": "free key",
  paid: "paid plan",
};

// Tier → badge color. Keyless is the reliable one; paid is the caveat.
const TIER_STYLE: Record<IndicatorTier, { bg: string; fg: string }> = {
  keyless: { bg: "var(--up-soft, rgba(16,160,90,0.14))", fg: "var(--up, #109a5a)" },
  "free-key": { bg: "var(--chip-bg)", fg: "var(--muted)" },
  paid: { bg: "var(--warn-soft, rgba(200,140,0,0.16))", fg: "var(--warn, #b8860b)" },
};

const GROUP_ORDER: IndicatorGroup[] = [
  "Global equity",
  "Commodities",
  "FX",
  "Crypto",
  "Rates",
  "Thai",
];

function TierBadge({ tier }: { tier: IndicatorTier }) {
  const s = TIER_STYLE[tier];
  return (
    <span
      style={{
        fontSize: 9.5,
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.02em",
        padding: "2px 6px",
        borderRadius: 6,
        background: s.bg,
        color: s.fg,
        whiteSpace: "nowrap",
      }}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}

export function ManageIndicatorsSheet({ open, onClose }: ManageIndicatorsSheetProps) {
  const { data } = useMarketIndicatorPrefs();
  const [working, setWorking] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // (Re)seed the working list from the server selection each time we open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only on open
  useEffect(() => {
    if (open && data) setWorking(data.selected);
  }, [open]);

  const bySymbol = useMemo(() => {
    const m = new Map<string, IndicatorDef>();
    for (const d of data?.catalog ?? []) m.set(d.symbol, d);
    return m;
  }, [data]);

  const defaults = useMemo(
    () =>
      (data?.catalog ?? [])
        .filter((d) => d.defaultOrder !== undefined)
        .sort((a, b) => (a.defaultOrder ?? 0) - (b.defaultOrder ?? 0))
        .map((d) => d.symbol),
    [data],
  );

  // Addable = catalog minus what's already chosen, grouped for the picker.
  const addableByGroup = useMemo(() => {
    const chosen = new Set(working);
    const groups = new Map<IndicatorGroup, IndicatorDef[]>();
    for (const d of data?.catalog ?? []) {
      if (chosen.has(d.symbol)) continue;
      const arr = groups.get(d.group) ?? [];
      arr.push(d);
      groups.set(d.group, arr);
    }
    return groups;
  }, [data, working]);

  if (!open) return null;

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= working.length) return;
    const next = [...working];
    [next[i], next[j]] = [next[j], next[i]];
    setWorking(next);
  };
  const remove = (sym: string) => setWorking((w) => w.filter((s) => s !== sym));
  const add = (sym: string) => setWorking((w) => (w.includes(sym) ? w : [...w, sym]));

  const save = async () => {
    setSaving(true);
    try {
      await fetch("/api/market/indicators", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbols: working }),
      });
      await Promise.all([invalidate("/api/market/indicators"), invalidate("/api/market/indices")]);
      onClose();
    } catch (err) {
      console.error("Failed to save indicators:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">Manage indicators</div>
        <div className="sheet-subtitle">
          Choose which markets show on this screen, and their order.
        </div>

        {/* Current selection */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {working.length === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "4px 0" }}>
              No indicators selected — you&apos;ll see the default set.
            </div>
          )}
          {working.map((sym, i) => {
            const def = bySymbol.get(sym);
            return (
              <div key={sym} className="mi-row">
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{def?.label ?? sym}</span>
                    {def && <TierBadge tier={def.tier} />}
                  </div>
                  {def?.name && (
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{def.name}</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 2 }}>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <Icon name="arrowUp" size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Move down"
                    disabled={i === working.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <Icon name="arrowDown" size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Remove"
                    onClick={() => remove(sym)}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add picker */}
        <div className="sheet-title" style={{ fontSize: 13, marginTop: 18, marginBottom: 8 }}>
          Add
        </div>
        {GROUP_ORDER.map((group) => {
          const items = addableByGroup.get(group);
          if (!items || items.length === 0) return null;
          return (
            <div key={group} style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.04em",
                  color: "var(--muted)",
                  marginBottom: 6,
                }}
              >
                {group.toUpperCase()}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {items.map((d) => (
                  <button
                    key={d.symbol}
                    type="button"
                    className="mi-add-chip"
                    onClick={() => add(d.symbol)}
                  >
                    <Icon name="plus" size={12} />
                    {d.label}
                    <TierBadge tier={d.tier} />
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {/* Footer */}
        <div style={{ display: "flex", gap: 8, marginTop: 18, alignItems: "center" }}>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => setWorking(defaults)}
            disabled={saving}
          >
            Reset to default
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
