"use client";

// Browser-only cache of the Advisor's in-chat import CARDS (the holdings /
// transactions review tables from propose_holdings_import /
// propose_transactions_import). Mirrors lib/stores/chat-images: the chat route
// persists only the assistant's TEXT, not tool output, so without this a card
// vanishes on reload. We keep its payload in localStorage keyed by
// `${threadId}:${seq}` — `seq` being the 0-based index of the user turn that
// produced it (computed identically on the send and reload paths) — so it
// re-attaches to that turn's reply. Bounded with oldest-first eviction.

import type { ExtractedTxnRow } from "@/lib/portfolio/ocr";
import type { ImportSeedRow } from "@/lib/stores/import-seed";

export interface ChatCard {
  holdingsImport?: { rows: ImportSeedRow[]; source: string | null; note: string | null };
  transactionsImport?: { rows: ExtractedTxnRow[]; source: string | null; note: string | null };
}

const KEY = "macrotide_chat_cards_v1";
// Cards are small JSON (a few dozen rows of numbers/strings); a modest budget
// holds a long backlog well under the localStorage quota.
const BUDGET_BYTES = 1_500_000;

interface Entry {
  ts: number;
  card: ChatCard;
}
type Store = Record<string, Entry>;

function readStore(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  if (typeof window === "undefined") return;
  let serialized = JSON.stringify(store);
  if (serialized.length > BUDGET_BYTES) {
    const byAge = Object.entries(store).sort((a, b) => a[1].ts - b[1].ts);
    while (serialized.length > BUDGET_BYTES && byAge.length > 0) {
      const [oldestKey] = byAge.shift() as [string, Entry];
      delete store[oldestKey];
      serialized = JSON.stringify(store);
    }
  }
  try {
    window.localStorage.setItem(KEY, serialized);
  } catch {
    // Quota or privacy mode — drop silently; the card is a best-effort nicety.
  }
}

const composeKey = (threadId: string, seq: number) => `${threadId}:${seq}`;

/** Persist the import card produced by one user turn. No-op when empty. */
export function saveChatCard(threadId: string, seq: number, card: ChatCard): void {
  if (!threadId || (!card.holdingsImport && !card.transactionsImport)) return;
  const store = readStore();
  store[composeKey(threadId, seq)] = { ts: Date.now(), card };
  writeStore(store);
}

/**
 * Load every stored card for a thread, keyed by the user-turn `seq`. Used on
 * thread reload to re-attach the table to the right assistant reply.
 */
export function loadChatThreadCards(threadId: string): Map<number, ChatCard> {
  const out = new Map<number, ChatCard>();
  if (!threadId) return out;
  const store = readStore();
  const prefix = `${threadId}:`;
  for (const [key, entry] of Object.entries(store)) {
    if (!key.startsWith(prefix)) continue;
    const seq = Number(key.slice(prefix.length));
    if (Number.isInteger(seq)) out.set(seq, entry.card);
  }
  return out;
}
