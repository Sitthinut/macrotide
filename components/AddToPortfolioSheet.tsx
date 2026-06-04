"use client";

// One "Add to portfolio" entry point with a Snapshot ↔ Activity toggle (ADR
// 0004 — holdings and the ledger are one model). Snapshot lands a current
// position (an `opening` anchor); Activity records buy/sell/dividend events.
// Both write to the same ledger; this wrapper just swaps which entry form shows
// and shares one segmented control between them.

import { type AddedHolding, AddHoldingsSheet } from "@/components/AddHoldingsSheet";
import { AddTransactionsSheet } from "@/components/AddTransactionsSheet";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import type { ExtractedTxnRow } from "@/lib/portfolio/ocr";
import type { ImportSeedRow } from "@/lib/stores/import-seed";

export type AddMode = "snapshot" | "activity";

export interface AddToPortfolioSheetProps {
  open: boolean;
  onClose: () => void;
  mode: AddMode;
  onModeChange: (mode: AddMode) => void;
  /** Default bucket to preselect (the active portfolio). */
  defaultBucketId?: string | null;
  // Snapshot (holdings) wiring.
  onAdd: (rows: AddedHolding[]) => void;
  holdingsSeed?: ImportSeedRow[] | null;
  /** Carry transaction-shaped rows when the scope-guard flips to Activity. */
  onHandoffToActivity?: (seed: ExtractedTxnRow[] | null) => void;
  // Activity (transactions) wiring.
  txnSeed?: ExtractedTxnRow[] | null;
  onSaved?: (count: number) => void;
}

function ModeToggle({ mode, onChange }: { mode: AddMode; onChange: (m: AddMode) => void }) {
  return (
    <div className="method-tabs add-mode-tabs">
      <button type="button" data-active={mode === "snapshot"} onClick={() => onChange("snapshot")}>
        <Icon name="wallet" size={13} /> Holdings
      </button>
      <button type="button" data-active={mode === "activity"} onClick={() => onChange("activity")}>
        <Icon name="book" size={13} /> Activity
      </button>
    </div>
  );
}

export function AddToPortfolioSheet(props: AddToPortfolioSheetProps) {
  const toggle = <ModeToggle mode={props.mode} onChange={props.onModeChange} />;
  const activity = props.mode === "activity";

  // ONE Modal owns the chrome + width for both modes (fixed at `modal--txnwide`,
  // 880px desktop / full-bleed mobile). Switching the toggle swaps only the body
  // — the modal never closes/reopens or resizes (the old jank). The body
  // components render Modal.Header/Body/Footer into this Modal's context.
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      variant="form"
      className="modal--txnwide"
      labelledBy={activity ? "at-title" : "ah-title"}
    >
      {activity ? (
        <AddTransactionsSheet
          open={props.open}
          onClose={props.onClose}
          onSaved={props.onSaved}
          defaultBucketId={props.defaultBucketId}
          seedRows={props.txnSeed}
          modeToggle={toggle}
        />
      ) : (
        <AddHoldingsSheet
          open={props.open}
          onClose={props.onClose}
          onAdd={props.onAdd}
          seedRows={props.holdingsSeed}
          modeToggle={toggle}
          onSwitchToTransactions={(seed) => {
            props.onHandoffToActivity?.(seed ?? null);
            props.onModeChange("activity");
          }}
        />
      )}
    </Modal>
  );
}
