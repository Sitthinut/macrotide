"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { useMarketIndicatorPrefs } from "@/lib/fetchers/portfolio";
import { invalidate } from "@/lib/fetchers/swr";
import type { IndicatorDef, IndicatorGroup } from "@/lib/market/indicators";

export interface ManageIndicatorsSheetProps {
  open: boolean;
  onClose: () => void;
}

const GROUP_ORDER: IndicatorGroup[] = [
  "Global equity",
  "Commodities",
  "FX",
  "Crypto",
  "Rates",
  "Thai",
];

// A single draggable, keyboard-operable row in the current selection.
function SortableRow({
  sym,
  def,
  onRemove,
}: {
  sym: string;
  def: IndicatorDef | undefined;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sym,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 1 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className="mi-row">
      <button
        type="button"
        className="icon-btn mi-drag-handle"
        aria-label={`Reorder ${def?.label ?? sym}`}
        {...attributes}
        {...listeners}
      >
        <Icon name="grip-vertical" size={14} />
      </button>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{def?.label ?? sym}</span>
        {def?.name && <span style={{ fontSize: 11, color: "var(--muted)" }}>{def.name}</span>}
      </div>
      <button type="button" className="icon-btn" aria-label="Remove" onClick={onRemove}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

export function ManageIndicatorsSheet({ open, onClose }: ManageIndicatorsSheetProps) {
  const { data } = useMarketIndicatorPrefs();
  const [working, setWorking] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setWorking((w) => {
      const from = w.indexOf(active.id as string);
      const to = w.indexOf(over.id as string);
      if (from < 0 || to < 0) return w;
      return arrayMove(w, from, to);
    });
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
          Choose which markets show on this screen. Drag the handle to reorder.
        </div>

        {/* Current selection — drag-and-drop reorder */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {working.length === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "4px 0" }}>
              No indicators selected — you&apos;ll see the default set.
            </div>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={working} strategy={verticalListSortingStrategy}>
              {working.map((sym) => (
                <SortableRow
                  key={sym}
                  sym={sym}
                  def={bySymbol.get(sym)}
                  onRemove={() => remove(sym)}
                />
              ))}
            </SortableContext>
          </DndContext>
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
