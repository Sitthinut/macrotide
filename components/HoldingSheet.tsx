"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { mergeSourceSuggestions } from "@/lib/data/sources";
import { useHoldings } from "@/lib/fetchers/portfolio";
import { QUOTE_SOURCE_LABELS, QUOTE_SOURCES, type QuoteSource } from "@/lib/market/sources";
import type { AssetClass } from "@/lib/static/types";

export interface HoldingFormValues {
  bucketId: string;
  ticker: string;
  thaiName: string;
  englishName: string;
  category: string;
  assetClass: AssetClass;
  region: string;
  units: number;
  avgCost: number;
  ter: number;
  source: string;
  /** Which provider serves this holding's NAV/price. */
  quoteSource: QuoteSource;
  color: string;
}

export interface HoldingSheetProps {
  open: boolean;
  /** DB id when editing; absent when creating. */
  holdingId?: number;
  initial: HoldingFormValues;
  /** When editing, true if the ticker should be locked. */
  lockTicker?: boolean;
  /** Optional list of buckets so the user can move a holding between them. */
  bucketOptions?: { id: string; name: string }[];
  onClose: () => void;
  onSave: (values: HoldingFormValues) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}

const ASSET_CLASSES: { value: AssetClass; label: string }[] = [
  { value: "equity", label: "Equity" },
  { value: "bond", label: "Bond" },
  { value: "alternative", label: "Alternative" },
  { value: "cash", label: "Cash" },
];

export function HoldingSheet({
  open,
  holdingId,
  initial,
  lockTicker = false,
  bucketOptions,
  onClose,
  onSave,
  onDelete,
}: HoldingSheetProps) {
  const isEdit = holdingId !== undefined;
  const [values, setValues] = useState<HoldingFormValues>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Free-text source label, with suggestions from the user's existing sources.
  const { data: allHoldings } = useHoldings();
  const sourceOptions = mergeSourceSuggestions((allHoldings ?? []).map((h) => h.source));

  useEffect(() => {
    if (open) {
      setValues(initial);
      setError(null);
    }
    // initial intentionally captured at open time — avoids re-rendering as parent re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const update = (patch: Partial<HoldingFormValues>) => setValues((v) => ({ ...v, ...patch }));

  const submit = async () => {
    if (!values.ticker.trim()) {
      setError("Symbol is required");
      return;
    }
    if (!values.englishName.trim()) {
      setError("Name is required");
      return;
    }
    if (!values.bucketId) {
      setError("Portfolio is required");
      return;
    }
    if (!Number.isFinite(values.units) || values.units <= 0) {
      setError("Quantity must be a positive number");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSave(values);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setSubmitting(true);
    try {
      await onDelete();
      setConfirmDelete(false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
      setSubmitting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} variant="form" labelledBy="hs-title">
        <Modal.Header
          title={isEdit ? "Edit holding" : "Add holding"}
          subtitle={
            isEdit
              ? "Update quantity, cost basis, or move to another portfolio."
              : "Add a single holding. Use the import sheet for multiple at once."
          }
          id="hs-title"
        />
        <Modal.Body gap={14}>
          <FormRow label="Type" hint="Determines where we fetch this holding's price">
            <select
              className="sheet-input"
              value={values.quoteSource}
              onChange={(e) => update({ quoteSource: e.target.value as QuoteSource })}
              disabled={lockTicker}
            >
              {QUOTE_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {QUOTE_SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
          </FormRow>

          <FormRow label="Symbol">
            <input
              className="sheet-input"
              value={values.ticker}
              onChange={(e) => update({ ticker: e.target.value.toUpperCase() })}
              disabled={lockTicker}
              placeholder="Symbol"
              style={{ textTransform: "uppercase" }}
            />
          </FormRow>

          <FormRow label="Name (English)">
            <input
              className="sheet-input"
              value={values.englishName}
              onChange={(e) => update({ englishName: e.target.value })}
              placeholder="SCB S&P 500 Index Fund"
            />
          </FormRow>

          <FormRow label="Name (Thai)" hint="Optional">
            <input
              className="sheet-input"
              value={values.thaiName}
              onChange={(e) => update({ thaiName: e.target.value })}
              placeholder="เอสซีบี เอสแอนด์พี 500"
            />
          </FormRow>

          {bucketOptions && bucketOptions.length > 0 && (
            <FormRow label="Portfolio">
              <select
                className="sheet-input"
                value={values.bucketId}
                onChange={(e) => update({ bucketId: e.target.value })}
              >
                {bucketOptions.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </FormRow>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <FormRow label="Quantity">
              <input
                className="sheet-input"
                type="number"
                step="0.0001"
                value={Number.isFinite(values.units) ? values.units : ""}
                onChange={(e) => update({ units: Number.parseFloat(e.target.value) || 0 })}
                placeholder="0"
              />
            </FormRow>
            <FormRow label="Avg cost" hint="THB per unit/share">
              <input
                className="sheet-input"
                type="number"
                step="0.01"
                value={Number.isFinite(values.avgCost) ? values.avgCost : ""}
                onChange={(e) => update({ avgCost: Number.parseFloat(e.target.value) || 0 })}
                placeholder="0"
              />
            </FormRow>
          </div>

          <FormRow label="Asset class">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ASSET_CLASSES.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => update({ assetClass: a.value })}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "1px solid",
                    borderColor:
                      values.assetClass === a.value ? "var(--accent)" : "var(--line-soft)",
                    background:
                      values.assetClass === a.value ? "var(--accent-soft)" : "var(--paper)",
                    fontSize: 12.5,
                    cursor: "pointer",
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </FormRow>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <FormRow label="Category" hint="e.g. US Equity">
              <input
                className="sheet-input"
                value={values.category}
                onChange={(e) => update({ category: e.target.value })}
                placeholder="US Equity"
              />
            </FormRow>
            <FormRow label="Region" hint="US / TH / Global / EM">
              <input
                className="sheet-input"
                value={values.region}
                onChange={(e) => update({ region: e.target.value })}
                placeholder="US"
              />
            </FormRow>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <FormRow label="TER (%)" hint="Annual expense ratio">
              <input
                className="sheet-input"
                type="number"
                step="0.01"
                value={Number.isFinite(values.ter) ? values.ter : ""}
                onChange={(e) => update({ ter: Number.parseFloat(e.target.value) || 0 })}
                placeholder="0.45"
              />
            </FormRow>
            <FormRow label="Source" hint="Where this came from">
              <input
                className="sheet-input"
                list="edit-source-suggestions"
                value={values.source}
                onChange={(e) => update({ source: e.target.value })}
                placeholder="Type or pick a source"
              />
              <datalist id="edit-source-suggestions">
                {sourceOptions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </FormRow>
          </div>

          {error && (
            <div
              style={{
                color: "var(--loss)",
                fontSize: 12.5,
                padding: "8px 12px",
                background: "var(--loss-soft, rgba(220,38,38,0.08))",
                borderRadius: 8,
              }}
            >
              {error}
            </div>
          )}
        </Modal.Body>
        <Modal.Footer
          start={
            isEdit && onDelete ? (
              <button
                type="button"
                className="icon-btn btn-delete"
                onClick={() => setConfirmDelete(true)}
                disabled={submitting}
                aria-label="Delete holding"
                title="Delete holding"
                style={{ color: "var(--loss)" }}
              >
                <Icon name="trash-2" size={16} />
                <span className="btn-delete-label">Delete</span>
              </button>
            ) : undefined
          }
        >
          <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Add holding"}
          </button>
        </Modal.Footer>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete holding?"
        message={`Remove ${values.ticker || "this holding"} from this portfolio. This can't be undone.`}
        confirmLabel="Delete holding"
        busy={submitting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

function FormRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          color: "var(--muted)",
          letterSpacing: "0.04em",
          marginBottom: 6,
        }}
      >
        {label.toUpperCase()}
      </div>
      {children}
      {hint && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
