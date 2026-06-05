"use client";

// Typed external store that lets the Advisor's in-chat holdings table open the
// unified Add modal (RecordSheet) pre-seeded with rows. ChatScreen (in the chat
// tree) and RecordSheet (lifted in App.tsx, above the mobile↔wide swap) share no
// provider subtree, so — exactly like lib/stores/chat-ui.ts — they coordinate
// through one module singleton read via useSyncExternalStore.
//
// `seedRows` + `openNonce` are a CONSUMABLE intent, not durable state: ChatScreen
// publishes rows via requestImportWithRows(); App reacts to the nonce change,
// copies the rows into the sheet, and calls consumeImportSeed() to clear them.

import { useSyncExternalStore } from "react";
import type { QuoteSource } from "@/lib/market/sources";

/**
 * One extracted holding row handed to the importer. Structurally matches the
 * `DerivedRow` the image-import API returns (lib/portfolio/ocr.ts) and the
 * `ImportedRow` the sheet already consumes — declared here as a plain interface
 * because the store is client-side and DerivedRow lives in a `server-only` module.
 */
export interface ImportSeedRow {
  ticker: string;
  englishName?: string;
  units?: number;
  nav?: number;
  avgCost?: number;
  value?: number;
  pl?: number;
  quoteSource?: QuoteSource;
  estimated?: boolean;
  needsUnits?: boolean;
}

export interface ImportSeedState {
  /** Rows to seed into the importer, or null when none pending / consumed. */
  seedRows: ImportSeedRow[] | null;
  /** Bumped per request so the same rows can re-open the sheet. */
  openNonce: number;
}

let state: ImportSeedState = { seedRows: null, openNonce: 0 };

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setState(patch: Partial<ImportSeedState>) {
  state = { ...state, ...patch };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ImportSeedState {
  return state;
}

// ── Actions ──────────────────────────────────────────────────────────────────

/** ChatScreen asks App to open the importer pre-filled with these rows. */
export function requestImportWithRows(rows: ImportSeedRow[]) {
  setState({ seedRows: rows, openNonce: state.openNonce + 1 });
}

/** App calls this after handling a request so the intent fires exactly once. */
export function consumeImportSeed() {
  if (state.seedRows !== null) setState({ seedRows: null });
}

// ── React binding ──────────────────────────────────────────────────────────

export function useImportSeed() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...snapshot, requestImportWithRows, consumeImportSeed };
}
