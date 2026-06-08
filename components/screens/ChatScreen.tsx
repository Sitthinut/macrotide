"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatThreadList } from "@/components/ChatThreadList";
import { FeedbackRow } from "@/components/FeedbackRow";
import { Icon } from "@/components/Icon";
import { MarkdownMessage } from "@/components/MarkdownMessage";
import type { EntryContext } from "@/lib/advisor/entry-context";
import { MAX_CHAT_ATTACHMENTS } from "@/lib/advisor/image-turn";
import {
  useModelPortfoliosView,
  usePortfolioView,
  useSelectedModelId,
} from "@/lib/fetchers/legacy";
import { invalidate, useResource } from "@/lib/fetchers/swr";
import { normalizeImage } from "@/lib/image-normalize";
import { type AdvisorScreenContext, buildChatSuggestions } from "@/lib/portfolio/chat-suggestions";
import { computeHealth } from "@/lib/portfolio/health";
import type { ExtractedTxnRow } from "@/lib/portfolio/ocr";
import { AI_PERSONALITIES } from "@/lib/static/personalities";
import { loadChatThreadCards, saveChatCard } from "@/lib/stores/chat-cards";
import { type ChatImage, loadChatThreadImages, saveChatImages } from "@/lib/stores/chat-images";
import { consumeLoadTarget, setActiveThreadId, useChatUi } from "@/lib/stores/chat-ui";
import {
  type ImportSeedRow,
  requestImportWithRows,
  requestTxnImportWithRows,
} from "@/lib/stores/import-seed";
import { useOverlayScrollbar } from "@/lib/useOverlayScrollbar";

// Per-message attachment cap — the single source of truth lives in
// lib/advisor/image-turn (the chat route enforces the same number as a backstop).
// Images are normalized client-side (the shared 2048px / JPEG-0.8 — see
// lib/image-normalize) before send, so chat and the importer feed the SAME vision
// model the SAME image.
const MAX_ATTACHMENTS = MAX_CHAT_ATTACHMENTS;

// Normalize an image File for chat: the shared 2048/0.8 JPEG (sent to the model,
// shown as a thumbnail, persisted), keeping the original for the full-res lightbox.
async function downscaleImage(file: File): Promise<ChatImage> {
  const n = await normalizeImage(file);
  return {
    id: makeId(),
    dataUrl: n.dataUrl,
    fullDataUrl: n.fullDataUrl,
    mime: n.mime,
    name: file.name,
    capturedAt: file.lastModified ? new Date(file.lastModified).toISOString() : undefined,
  };
}

// Transcribe an attached image to plain text ONCE (on attach), so a follow-up
// turn can reference it as cheap text instead of re-sending the bytes. Best
// effort — returns "" on any failure and the caller proceeds without one.
async function transcribeAttachment(dataUrl: string): Promise<string> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const fd = new FormData();
    fd.append("image", blob, "image.jpg");
    const res = await fetch("/api/chat/transcribe", { method: "POST", body: fd });
    if (!res.ok) return "";
    const body = (await res.json()) as { text?: string };
    return body.text?.trim() ?? "";
  } catch {
    return "";
  }
}

// Fold an image turn's transcription into its text for the model, so later turns
// read the image as text without the bytes. Plain text when no transcript yet.
function imageText(m: Message): string {
  const ts = (m.images ?? []).map((i) => i.transcript?.trim()).filter(Boolean);
  if (ts.length === 0) return m.text;
  return `${m.text}\n\n[Attached image, transcribed so you can read it without the photo:]\n${ts.join("\n--- next image ---\n")}`;
}

const ACTIVE_THREAD_KEY = "macrotide_chat_active_thread";

// Remove the trailing "[N image(s) attached]" marker the server stores in a
// user message (images aren't persisted server-side). Used on reload when we
// have the thumbnails to show, so the marker doesn't duplicate the preview.
function stripImageMarker(text: string): string {
  return text.replace(/\s*\[\d+ image(?:s)? attached\]\s*$/, "").trimEnd();
}

interface PlanProposal {
  section: string;
  rationale: string;
  add: string | null;
  rm: string | null;
}

// A holding the advisor proposed via the propose_holding tool. Mirrors the
// payload POST /api/holdings/propose accepts; rendered as a HoldingProposalCard.
interface HoldingProposal {
  ticker: string;
  englishName: string;
  thaiName: string | null;
  units: number;
  avgCost: number | null;
  ter: number | null;
  assetClass: string | null;
  region: string | null;
  quoteSource: string;
  bucketId: string | null;
  source: string | null;
  rationale: string;
}

// The advisor's propose_holdings_import tool output: a batch of extracted rows
// rendered as a compact in-chat table that opens the full importer pre-seeded.
interface HoldingsImport {
  rows: ImportSeedRow[];
  source: string | null;
  note: string | null;
}

// The advisor's propose_transactions_import tool output: a batch of dated trade
// rows (a buy/sell/dividend history) → a compact table that opens the importer.
interface TransactionsImport {
  rows: ExtractedTxnRow[];
  source: string | null;
  note: string | null;
}

interface Message {
  role: "user" | "ai";
  text: string;
  ts: number;
  // Stable identity for streaming updates. `ts` is for display only — two
  // messages can share a ms if they're queued in the same event-loop tick.
  id: string;
  // Images the user attached to this turn (downscaled). Shown as thumbnails;
  // kept in the browser only (localStorage), never persisted server-side.
  images?: ChatImage[];
  proposal?: PlanProposal;
  applied?: boolean;
  rejected?: boolean;
  // A batch holdings-import table (one per turn) from propose_holdings_import.
  holdingsImport?: HoldingsImport;
  // A batch transaction-import table from propose_transactions_import.
  transactionsImport?: TransactionsImport;
  // A turn can yield MANY holding proposals (one per extracted statement row),
  // so unlike `proposal` these are a keyed list with per-card accept/reject
  // state tracked by index.
  holdings?: HoldingProposal[];
  holdingStatus?: Record<number, "applied" | "rejected">;
  // Set on a failed/empty assistant turn so the UI can offer a "Try again"
  // button that re-sends the preceding user message.
  canRetry?: boolean;
  /** The model id that served this assistant message (null/undefined = unknown). */
  model?: string | null;
}

function makeId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface MsgFeedback {
  rating?: "up" | "down" | null;
  saved?: boolean;
}

// A seed message can be a plain string (shown verbatim as the user turn) or a
// split { display, send } pair: `display` is the short visible bubble, `send`
// is the larger payload actually sent to the model. The OCR handoff uses the
// split form so the raw transcription stays out of the visible message body.
// The split form may also carry a structured `context` envelope (the screen +
// intent + a few pre-computed facts) so the server can answer without a tool
// round-trip — never shown in the bubble. See lib/advisor/entry-context.ts.
export type SeedPrompt = string | { display: string; send: string; context?: EntryContext };

export interface ChatScreenProps {
  persona?: string;
  seedPrompt?: SeedPrompt | null;
  onPromptConsumed?: () => void;
  /** Opens the account menu from the topbar (mobile only; hidden in the dock). */
  onOpenMenu?: () => void;
  /**
   * The screen the composer is being shown against, so its starter suggestions
   * can reflect where the user is. Optional — omitted (or `null`) just drops the
   * screen-flavored chips and falls back to portfolio + evergreen prompts. This
   * is the existing app-shell `screen` state threaded down by callers, NOT a new
   * context abstraction (a sibling effort owns the formal Advisor context model;
   * see NOTES-22.md).
   */
  activeScreen?: AdvisorScreenContext | null;
}

function PlanProposalCard({
  proposal,
  applied,
  onApply,
  onReject,
}: {
  proposal: PlanProposal;
  applied?: boolean;
  onApply: () => void;
  onReject: () => void;
}) {
  if (applied === true) {
    return (
      <div
        className="plan-proposal"
        style={{ background: "var(--accent-soft)", borderColor: "transparent" }}
      >
        <div className="label">
          <span>✓ APPLIED TO YOUR PLAN · {proposal.section.toUpperCase()}</span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--accent-ink)" }}>
          Saved to <strong style={{ fontWeight: 500 }}>{proposal.section}</strong>. View in Journal
          → Plan.
        </div>
      </div>
    );
  }
  if (applied === false) {
    return (
      <div
        className="plan-proposal"
        style={{ background: "var(--card-soft)", borderColor: "var(--line)" }}
      >
        <div
          style={{
            fontSize: 12,
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.04em",
          }}
        >
          ○ DISMISSED
        </div>
      </div>
    );
  }
  return (
    <div className="plan-proposal">
      <div className="label">
        <Icon name="sparkle" size={12} />
        <span>PLAN CHANGE · {proposal.section.toUpperCase()}</span>
      </div>
      <div className="diff">
        {proposal.rm && <span className="rm">{proposal.rm}</span>}
        {proposal.rm && proposal.add && "\n"}
        {proposal.add && <span className="add">{proposal.add}</span>}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-soft)", lineHeight: 1.45 }}>
        {proposal.rationale}
      </div>
      <div className="actions">
        <button className="btn ghost sm" onClick={onReject}>
          Not now
        </button>
        <button className="btn primary sm" onClick={onApply} style={{ flex: 1 }}>
          <Icon name="check" size={12} /> Apply to plan
        </button>
      </div>
    </div>
  );
}

function HoldingProposalCard({
  holding,
  status,
  onApply,
  onReject,
}: {
  holding: HoldingProposal;
  status?: "applied" | "rejected";
  onApply: () => void;
  onReject: () => void;
}) {
  if (status === "applied") {
    return (
      <div
        className="plan-proposal"
        style={{ background: "var(--accent-soft)", borderColor: "transparent" }}
      >
        <div className="label">
          <span>✓ ADDED · {holding.ticker.toUpperCase()}</span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--accent-ink)" }}>
          Saved to your portfolio. View it in your holdings.
        </div>
      </div>
    );
  }
  if (status === "rejected") {
    return (
      <div
        className="plan-proposal"
        style={{ background: "var(--card-soft)", borderColor: "var(--line)" }}
      >
        <div
          style={{
            fontSize: 12,
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.04em",
          }}
        >
          ○ SKIPPED · {holding.ticker.toUpperCase()}
        </div>
      </div>
    );
  }
  const facts = [
    `${holding.units} units`,
    holding.avgCost != null ? `@ ฿${holding.avgCost.toLocaleString()}` : null,
    holding.assetClass,
    holding.region,
  ].filter(Boolean);
  return (
    <div className="plan-proposal">
      <div className="label">
        <Icon name="sparkle" size={12} />
        <span>ADD HOLDING · {holding.ticker.toUpperCase()}</span>
      </div>
      <div className="diff">
        <span className="add">
          {holding.englishName}
          {facts.length > 0 ? `\n${facts.join(" · ")}` : ""}
        </span>
      </div>
      {holding.rationale && (
        <div style={{ fontSize: 11.5, color: "var(--ink-soft)", lineHeight: 1.45 }}>
          {holding.rationale}
        </div>
      )}
      <div className="actions">
        <button className="btn ghost sm" onClick={onReject}>
          Skip
        </button>
        <button className="btn primary sm" onClick={onApply} style={{ flex: 1 }}>
          <Icon name="check" size={12} /> Add to portfolio
        </button>
      </div>
    </div>
  );
}

// Compact, read-only summary of a batch of extracted holdings (from the
// propose_holdings_import tool), with a button that opens the full importer
// pre-seeded with these rows for review/edit/bulk-save (see lib/stores/import-seed).
function HoldingsImportCard({ data, onOpen }: { data: HoldingsImport; onOpen: () => void }) {
  const fmt = (n: number | undefined) =>
    n === undefined || !Number.isFinite(n) ? "—" : String(Math.round(n * 1e4) / 1e4);
  return (
    <div className="plan-proposal">
      <div className="label">
        <Icon name="sparkle" size={12} />
        <span>
          REVIEW HOLDINGS · {data.rows.length} ROW{data.rows.length === 1 ? "" : "S"}
        </span>
      </div>
      {data.note && (
        <div style={{ fontSize: 11.5, color: "var(--ink-soft)", lineHeight: 1.45 }}>
          {data.note}
        </div>
      )}
      <table className="chat-import-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th style={{ textAlign: "right" }}>Units</th>
            <th style={{ textAlign: "right" }}>Avg cost</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={`${r.ticker}-${i}`}>
              <td data-label="Symbol">
                <span className="t">{r.ticker.toUpperCase()}</span>
                {r.needsUnits && <span className="flag">needs units</span>}
                {!r.needsUnits && r.estimated && <span className="flag est">estimated</span>}
              </td>
              <td data-label="Units" style={{ textAlign: "right" }}>
                {fmt(r.units)}
              </td>
              <td data-label="Avg cost" style={{ textAlign: "right" }}>
                {fmt(r.avgCost)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions">
        <button className="btn primary sm" onClick={onOpen} style={{ flex: 1 }}>
          <Icon name="arrowRight" size={12} /> Review &amp; import
        </button>
      </div>
    </div>
  );
}

// Compact in-chat table for a batch of dated TRANSACTIONS (propose_transactions_import),
// with a button that opens the importer pre-seeded with these trades.
function TransactionsImportCard({
  data,
  onOpen,
}: {
  data: TransactionsImport;
  onOpen: () => void;
}) {
  const fmt = (n: number | undefined) =>
    n === undefined || !Number.isFinite(n) ? "—" : String(Math.round(n * 1e4) / 1e4);
  return (
    <div className="plan-proposal">
      <div className="label">
        <Icon name="sparkle" size={12} />
        <span>
          REVIEW TRANSACTIONS · {data.rows.length} ROW{data.rows.length === 1 ? "" : "S"}
        </span>
      </div>
      {data.note && (
        <div style={{ fontSize: 11.5, color: "var(--ink-soft)", lineHeight: 1.45 }}>
          {data.note}
        </div>
      )}
      <table className="chat-import-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Symbol</th>
            <th>Type</th>
            <th style={{ textAlign: "right" }}>Units</th>
            <th style={{ textAlign: "right" }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={`${r.ticker}-${r.tradeDate ?? ""}-${i}`}>
              <td data-label="Date">{r.tradeDate ?? "—"}</td>
              <td data-label="Symbol">
                <span className="t">{r.ticker.toUpperCase()}</span>
              </td>
              <td data-label="Type">{r.kind ?? "—"}</td>
              <td data-label="Units" style={{ textAlign: "right" }}>
                {fmt(r.units)}
              </td>
              <td data-label="Total" style={{ textAlign: "right" }}>
                {fmt(r.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions">
        <button className="btn primary sm" onClick={onOpen} style={{ flex: 1 }}>
          <Icon name="arrowRight" size={12} /> Review &amp; import
        </button>
      </div>
    </div>
  );
}

export function ChatScreen({
  persona = "advisor",
  seedPrompt,
  onPromptConsumed,
  onOpenMenu,
  activeScreen,
}: ChatScreenProps) {
  void persona; // single advisor persona for MVP

  const initial = useMemo<Message[]>(
    () => [
      {
        role: "ai",
        text: "Hi — I'm your index-investing advisor. Ask me about your portfolio, your plan, or how index investing works. If you don't have a plan yet, say \"help me write my plan\" and I'll walk you through it.",
        ts: Date.now(),
        id: makeId(),
      },
    ],
    [],
  );

  const [messages, setMessages] = useState<Message[]>(initial);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  // Pending image attachments for the next turn (downscaled), plus a click-to-
  // enlarge lightbox. Whether the attach affordance shows at all is gated by the
  // server-computed capability below (vision on + demo allows it).
  const [attachments, setAttachments] = useState<ChatImage[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);
  // Transient note when a multi-file pick is truncated to the cap, so the
  // dropped images aren't silently discarded. Cleared on the next clean add /
  // removal / send.
  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: caps } = useResource<{ imageUpload: boolean }>("/api/chat/capabilities");
  const imageUploadEnabled = caps?.imageUpload === true;
  const [msgFeedback, setMsgFeedback] = useState<Record<number, MsgFeedback>>({});
  const [showThreads, setShowThreads] = useState(false);
  // Set when the server signals it crossed ~80% of the model context budget
  // (header `x-context-summarized`). Earlier turns are summarized in the
  // model's input view; we surface a banner suggesting a fresh chat rather
  // than condensing silently. See docs/explanation/memory.md § mid-chat.
  const [contextNotice, setContextNotice] = useState(false);
  // Set when the server rejects a turn because the user hit their daily token
  // budget (header `x-daily-limit`). Resets at UTC midnight
  // server-side; the banner just nudges the user to come back.
  const [limitNotice, setLimitNotice] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  // Replace the chat stream's native scrollbar with the app-standard overlay
  // scrollbar (os-theme-macrotide), same as the side panels and main column.
  // Desktop/tablet only (the hook no-ops on mobile/touch, which keeps native).
  // OverlayScrollbars re-parents the stream's children into a generated viewport,
  // so the children live under one stable `.chat-stream-content` wrapper (below)
  // and auto-scroll targets that viewport (see the scroll effect).
  const streamOsRef = useOverlayScrollbar();
  const setStreamRef = useCallback(
    (node: HTMLDivElement | null) => {
      streamRef.current = node;
      streamOsRef(node);
    },
    [streamOsRef],
  );
  // Tracks which thread ids we've already tried to title in this session, so
  // a slow title-endpoint response doesn't get re-fired while the user keeps
  // chatting. The server is idempotent regardless, but this saves the round
  // trip + the SWR invalidate churn.
  const titledRef = useRef<Set<string>>(new Set());
  // Mirror of threadId for callbacks that must not re-bind on every switch
  // (e.g. newChat reads it without taking threadId as a dep).
  const threadIdRef = useRef<string | null>(null);
  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);
  // True once the user has sent a message into the current thread that hasn't
  // been closed yet. Gates the close beacon so we never spend an extraction
  // model call on a session with no NEW activity — a refresh, or reopening a
  // thread just to read it. Token-efficiency: extract only when there's
  // something new to extract, and only once per session.
  const dirtyRef = useRef(false);

  // Real-time session close for the OUTGOING thread — on New Chat, thread
  // switch, or the page going away (pagehide). The server extracts durable
  // facts + marks the thread idle (lib/memory/session-close.ts), once per
  // session. Fire-and-forget: idempotent + best-effort server-side, so we
  // ignore the response. Prefers `sendBeacon` (survives unload) with a
  // keepalive `fetch` fallback. No-ops unless the session is dirty.
  const closeOutgoing = useCallback((id: string | null) => {
    if (!id || !dirtyRef.current || typeof navigator === "undefined") return;
    dirtyRef.current = false;
    const url = `/api/chat/threads/${encodeURIComponent(id)}/close`;
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url)) return;
    void fetch(url, { method: "POST", keepalive: true }).catch(() => {});
  }, []);

  // Close the active session when the page goes away (tab/window close,
  // navigation, bfcache). `pagehide` is the reliable unload signal;
  // `beforeunload` is not. This is what catches "user closed the window
  // without clicking New Chat".
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHide = () => closeOutgoing(threadIdRef.current);
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [closeOutgoing]);

  const loadThread = useCallback(
    async (id: string): Promise<boolean> => {
      // Close the thread we're leaving (no-op on first load / same thread).
      if (id !== threadIdRef.current) closeOutgoing(threadIdRef.current);
      try {
        const res = await fetch(`/api/chat/threads/${encodeURIComponent(id)}`);
        if (!res.ok) return false;
        const { messages: rows } = (await res.json()) as {
          messages: Array<{
            id: number;
            role: string;
            content: string;
            createdAt: string;
            model?: string | null;
          }>;
        };
        setThreadId(id);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(ACTIVE_THREAD_KEY, id);
        }
        // Re-attach any browser-cached images to their turns. Keyed by the
        // 0-based index of the user message within the thread (deterministic and
        // append-only), so the send path and this reload path agree without a
        // server-side image id. See lib/stores/chat-images.ts.
        const storedImages = loadChatThreadImages(id);
        // Re-attach any browser-cached import cards to their assistant reply,
        // keyed by the same user-turn index the send path used.
        const storedCards = loadChatThreadCards(id);
        let userSeq = -1;
        setMessages(
          rows.length === 0
            ? initial
            : rows.map((r) => {
                const isUser = r.role !== "assistant";
                if (isUser) userSeq += 1;
                const imgs = isUser ? storedImages.get(userSeq) : undefined;
                const card = isUser ? undefined : storedCards.get(userSeq);
                // The server stores a "[N image(s) attached]" marker since images
                // aren't persisted server-side. When we DO have the thumbnails
                // (from localStorage), drop the redundant marker — it's only a
                // fallback for when the images can't be shown.
                const text = imgs?.length ? stripImageMarker(r.content) : r.content;
                return {
                  role: r.role === "assistant" ? "ai" : "user",
                  text,
                  ts: Date.parse(r.createdAt) || Date.now(),
                  id: `db-${r.id}`,
                  model: r.model ?? null,
                  images: imgs,
                  holdingsImport: card?.holdingsImport,
                  transactionsImport: card?.transactionsImport,
                } as Message;
              }),
        );
        setMsgFeedback({});
        setContextNotice(false);
        return true;
      } catch {
        return false;
      }
    },
    [initial, closeOutgoing],
  );

  // Hydrate the most recently active thread on mount. If the server doesn't
  // know about the stored id (e.g. demo session restarted, DB wiped), we silently
  // discard the stale id and start fresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(ACTIVE_THREAD_KEY);
    if (!stored) return;
    let cancelled = false;
    (async () => {
      const ok = await loadThread(stored);
      if (cancelled) return;
      if (!ok && typeof window !== "undefined") {
        window.localStorage.removeItem(ACTIVE_THREAD_KEY);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadThread]);

  const newChat = useCallback(() => {
    // Close the session we're leaving before clearing it (real-time extraction).
    closeOutgoing(threadIdRef.current);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(ACTIVE_THREAD_KEY);
    }
    setThreadId(null);
    setMessages(initial);
    setMsgFeedback({});
    setContextNotice(false);
    setAttachments([]);
    setAttachNotice(null);
  }, [initial, closeOutgoing]);

  // ── Image attachments ────────────────────────────────────────────────────
  // Downscale + stage image files (from the picker, drag-drop, or paste),
  // capped at MAX_ATTACHMENTS. Non-image files are ignored.
  const addFiles = useCallback(
    async (files: File[]) => {
      if (!imageUploadEnabled || loading) return;
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (images.length === 0) return;
      const room = MAX_ATTACHMENTS - attachments.length;
      if (room <= 0) {
        setAttachNotice(`Advisor reads up to ${MAX_ATTACHMENTS} images per message.`);
        return;
      }
      const skipped = images.length - room;
      setAttachNotice(
        skipped > 0
          ? `Added ${room} — Advisor reads up to ${MAX_ATTACHMENTS} images per message, so ${skipped} ${skipped === 1 ? "was" : "were"} skipped. For a larger batch, use Add holdings → Image.`
          : null,
      );
      const processed = await Promise.all(images.slice(0, room).map(downscaleImage));
      setAttachments((prev) => [...prev, ...processed].slice(0, MAX_ATTACHMENTS));
      // Transcribe each new image once, in the background, so a later follow-up
      // can reference it as text. Patches the staged attachment and — once the
      // turn is sent — the message carrying it.
      for (const img of processed) {
        void transcribeAttachment(img.dataUrl).then((transcript) => {
          if (!transcript) return;
          setAttachments((prev) => prev.map((a) => (a.id === img.id ? { ...a, transcript } : a)));
          setMessages((prev) =>
            prev.map((m) =>
              m.images?.some((i) => i.id === img.id)
                ? {
                    ...m,
                    images: m.images.map((i) => (i.id === img.id ? { ...i, transcript } : i)),
                  }
                : m,
            ),
          );
        });
      }
    },
    [imageUploadEnabled, loading, attachments.length],
  );

  const removeAttachment = (idx: number) => {
    setAttachNotice(null);
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  // Keyboard shortcut: ⌘/Ctrl+K opens a new chat. We swallow the event so the
  // browser's "search bar" default (Firefox) doesn't also fire. Disabled
  // while a turn is in flight — same constraint as the topbar's "New chat"
  // button.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || e.key.toLowerCase() !== "k") return;
      if (loading) return;
      e.preventDefault();
      newChat();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [newChat, loading]);

  // Cross-component coordination with the in-panel thread list (desktop/tablet
  // right rail). The list lives in ChatPanel, which can't reach this component's
  // threadId/loadThread/newChat directly — so we go through the shared chat UI
  // store (lib/stores/chat-ui.ts) instead of window events. Mobile keeps driving
  // the drawer through props and ignores this.
  const { loadTarget, newNonce } = useChatUi();

  // Publish the active thread so the panel list highlights the right row.
  useEffect(() => {
    setActiveThreadId(threadId);
  }, [threadId]);

  // Consume the panel's "load this thread" intent (fires once, then clears).
  useEffect(() => {
    if (loadTarget && loadTarget !== threadIdRef.current) void loadThread(loadTarget);
    consumeLoadTarget();
  }, [loadTarget, loadThread]);

  // Consume the panel's "new chat" intent. nonce 0 is the initial state, not a
  // request, so only act once it increments.
  const handledNewNonce = useRef(0);
  useEffect(() => {
    if (newNonce !== handledNewNonce.current) {
      handledNewNonce.current = newNonce;
      if (newNonce > 0) newChat();
    }
  }, [newNonce, newChat]);

  /**
   * Fire-and-forget auto-title trigger. Called after the first turn pair
   * completes on a brand-new thread. The server is idempotent so a duplicate
   * POST is harmless; `titledRef` just avoids the redundant round trip.
   */
  const maybeAutoTitle = useCallback(async (id: string) => {
    if (titledRef.current.has(id)) return;
    titledRef.current.add(id);
    try {
      const res = await fetch(`/api/chat/threads/${encodeURIComponent(id)}/title`, {
        method: "POST",
      });
      if (!res.ok) {
        // Allow a retry on the next turn-pair completion — the server probably
        // just didn't have the assistant message persisted yet.
        titledRef.current.delete(id);
        return;
      }
      // Refresh the sidebar so the new title surfaces next time the drawer
      // opens. Matches the existing SWR pattern in this file.
      void invalidate("/api/chat/threads");
    } catch {
      titledRef.current.delete(id);
    }
  }, []);

  // Auto-scroll to the bottom whenever messages grow or the streaming text
  // changes. We track the last message's text length so streamed deltas tick
  // the effect without re-rendering it on every keystroke in the composer.
  const lastText = messages[messages.length - 1]?.text ?? "";
  useEffect(() => {
    const host = streamRef.current;
    if (!host) return;
    // On desktop the overlay scrollbar moves the content into a generated
    // viewport child, so the host itself no longer scrolls — scroll that. On
    // mobile/native there's no viewport and the host scrolls directly.
    const scroller = host.querySelector<HTMLElement>("[data-overlayscrollbars-viewport]") ?? host;
    scroller.scrollTop = scroller.scrollHeight;
  }, [messages.length, lastText]);

  const askLive = async (
    prompt: string,
    history: Message[],
    context?: EntryContext,
    attached: ChatImage[] = [],
  ) => {
    setLoading(true);
    // New user turn → this session now has content worth extracting when it
    // closes (gates the close beacon; see closeOutgoing).
    dirtyRef.current = true;
    const hasImages = attached.length > 0;
    // Index of this user turn within the thread (for the image localStorage key).
    const userSeq = history.filter((m) => m.role === "user").length;

    // Prior image turns carry their TRANSCRIPTION as text (imageText), not the
    // bytes — so a follow-up reads the image without re-running the vision path
    // or busting the prompt cache. Only THIS turn's freshly-attached images go as
    // `file` parts. Text-only turns keep the compact `{role, content}` shape so
    // the prefix cache stays warm.
    // Surface each attachment's file name + saved date to the model (NOT the
    // displayed bubble) so it can date a holdings snapshot from the file when the
    // image itself shows no date. The model decides — we don't parse it.
    const fileNote = attached.length
      ? `\n\n(Attached file${attached.length === 1 ? "" : "s"}: ${attached
          .map((a) => `"${a.name}"${a.capturedAt ? ` saved ${a.capturedAt.slice(0, 10)}` : ""}`)
          .join("; ")})`
      : "";
    const turnText = prompt + fileNote;
    const stringPayload = [
      // The `proposal` field is UI-only metadata and is never forwarded (we only
      // pass role + text), but the assistant prose that accompanied a proposal IS
      // part of the conversation, so keep these turns.
      ...history.map((m) => ({
        role: m.role === "ai" ? "assistant" : "user",
        content: imageText(m),
      })),
      { role: "user" as const, content: turnText },
    ];
    const uiPayload = [
      ...history.map((m) => ({
        role: m.role === "ai" ? "assistant" : "user",
        parts: [{ type: "text", text: imageText(m) }],
      })),
      {
        role: "user" as const,
        parts: [
          ...(turnText ? [{ type: "text", text: turnText }] : []),
          ...attached.map((a) => ({ type: "file", mediaType: a.mime, url: a.dataUrl })),
        ],
      },
    ];
    const payload = hasImages ? uiPayload : stringPayload;

    // Reserve the placeholder assistant message we'll stream into.
    const placeholderId = makeId();
    setMessages((m) => [...m, { role: "ai", text: "", ts: Date.now(), id: placeholderId }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: payload,
          threadId: threadId ?? undefined,
          // Structured entry context (screen/intent/signals) from an Ask-Advisor
          // button, when present — lets the server skip a tool round-trip. Omitted
          // for ordinary typed turns, so the body is byte-identical to before.
          entryContext: context,
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`chat failed (${res.status})`);
      }
      const ctxHeader = res.headers.get("x-context-summarized");
      if (ctxHeader === "1" || ctxHeader === "over") setContextNotice(true);
      // Daily token budget hit — the server streams a plain-text explanation
      // (rendered as the assistant turn) and flags it here so we also show a
      // dismissible banner above the composer.
      if (res.headers.get("x-daily-limit") === "reached") setLimitNotice(true);
      const returnedThread = res.headers.get("x-thread-id");
      if (returnedThread && returnedThread !== threadId) {
        setThreadId(returnedThread);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(ACTIVE_THREAD_KEY, returnedThread);
        }
      }
      // Cache this turn's images in the browser (never server-side) so they
      // survive a reload, keyed by the user-message index in this thread.
      const tidForImages = returnedThread ?? threadId;
      if (hasImages && tidForImages) saveChatImages(tidForImages, userSeq, attached);
      // Refresh the sidebar so the new/updated thread surfaces next time
      // the drawer opens.
      void invalidate("/api/chat/threads");

      // The route returns a UI message stream — each line is `data: <json>`.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      // Tool confirmations collected from the stream. A model can run a tool
      // (e.g. save_preference) and end its turn without emitting any prose —
      // some cheaper models do this routinely. We surface the tool's own
      // message so the turn is never blank when work actually happened.
      const toolMessages: string[] = [];
      // propose_holding can fire multiple times in one turn (one per extracted
      // statement row). Accumulate them here and attach the growing list to the
      // streaming assistant message so each card appears as it arrives.
      const holdingProposals: HoldingProposal[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const event = JSON.parse(payload);
            // UIMessage stream emits various event types; collect text from
            // any text-delta or text shape so we work regardless of which
            // event variant the model emits.
            const delta: string | undefined =
              event.delta ?? event.text ?? event.textDelta ?? undefined;
            if (delta && (event.type?.startsWith("text") || !event.type)) {
              accumulated += delta;
              setMessages((prev) =>
                prev.map((m) => (m.id === placeholderId ? { ...m, text: accumulated } : m)),
              );
            }
            // Tool result, regardless of the exact event variant: our memory
            // tools return `{ message: string }`. Pull it from common shapes.
            const toolOut: unknown = event.output ?? event.result ?? undefined;
            if (toolOut && typeof toolOut === "object" && "message" in toolOut) {
              const msg = (toolOut as { message?: unknown }).message;
              if (typeof msg === "string" && msg.trim()) toolMessages.push(msg.trim());
            }
            // propose_plan_edit emits a `proposal` in its tool output (the
            // PlanProposal shape the card expects). Attach it to the streaming
            // assistant message so PlanProposalCard renders with Accept/Not now.
            if (toolOut && typeof toolOut === "object" && "proposal" in toolOut) {
              const p = (toolOut as { proposal?: unknown }).proposal;
              if (p && typeof p === "object" && "section" in p && "add" in p) {
                const raw = p as Partial<PlanProposal>;
                const proposal: PlanProposal = {
                  section: String(raw.section ?? "Plan"),
                  rationale: String(raw.rationale ?? ""),
                  add: raw.add ?? null,
                  rm: raw.rm ?? null,
                };
                setMessages((prev) =>
                  prev.map((m) => (m.id === placeholderId ? { ...m, proposal } : m)),
                );
              }
            }
            // propose_holding emits a `holding` in its tool output. Collect each
            // one and re-attach the full list so the cards render incrementally.
            if (toolOut && typeof toolOut === "object" && "holding" in toolOut) {
              const h = (toolOut as { holding?: unknown }).holding;
              if (h && typeof h === "object" && "ticker" in h && "units" in h) {
                const raw = h as Partial<HoldingProposal>;
                holdingProposals.push({
                  ticker: String(raw.ticker ?? ""),
                  englishName: String(raw.englishName ?? raw.ticker ?? ""),
                  thaiName: raw.thaiName ?? null,
                  units: Number(raw.units ?? 0),
                  avgCost: raw.avgCost ?? null,
                  ter: raw.ter ?? null,
                  assetClass: raw.assetClass ?? null,
                  region: raw.region ?? null,
                  quoteSource: String(raw.quoteSource ?? "market"),
                  bucketId: raw.bucketId ?? null,
                  source: raw.source ?? null,
                  rationale: String(raw.rationale ?? ""),
                });
                const snapshot = [...holdingProposals];
                setMessages((prev) =>
                  prev.map((m) => (m.id === placeholderId ? { ...m, holdings: snapshot } : m)),
                );
              }
            }
            // propose_holdings_import emits a `holdingsImport` batch — attach it
            // so HoldingsImportCard renders the compact table + open-importer CTA.
            if (toolOut && typeof toolOut === "object" && "holdingsImport" in toolOut) {
              const hi = (toolOut as { holdingsImport?: unknown }).holdingsImport;
              if (hi && typeof hi === "object" && Array.isArray((hi as { rows?: unknown }).rows)) {
                const raw = hi as { rows: ImportSeedRow[]; source?: unknown; note?: unknown };
                const holdingsImport: HoldingsImport = {
                  rows: raw.rows,
                  source: typeof raw.source === "string" ? raw.source : null,
                  note: typeof raw.note === "string" ? raw.note : null,
                };
                setMessages((prev) =>
                  prev.map((m) => (m.id === placeholderId ? { ...m, holdingsImport } : m)),
                );
                // Persist the card (browser-only, like images) so it survives a
                // reload — the server stores only the assistant's text.
                if (tidForImages) saveChatCard(tidForImages, userSeq, { holdingsImport });
              }
            }
            // propose_transactions_import emits a `transactionsImport` batch —
            // attach it so TransactionsImportCard renders the dated-trade table.
            if (toolOut && typeof toolOut === "object" && "transactionsImport" in toolOut) {
              const ti = (toolOut as { transactionsImport?: unknown }).transactionsImport;
              if (ti && typeof ti === "object" && Array.isArray((ti as { rows?: unknown }).rows)) {
                const raw = ti as { rows: ExtractedTxnRow[]; source?: unknown; note?: unknown };
                const transactionsImport: TransactionsImport = {
                  rows: raw.rows,
                  source: typeof raw.source === "string" ? raw.source : null,
                  note: typeof raw.note === "string" ? raw.note : null,
                };
                setMessages((prev) =>
                  prev.map((m) => (m.id === placeholderId ? { ...m, transactionsImport } : m)),
                );
                if (tidForImages) saveChatCard(tidForImages, userSeq, { transactionsImport });
              }
            }
          } catch {
            // Some events are not JSON (heartbeats, [DONE]); ignore.
          }
        }
      }

      // Fail-safe: if the model emitted no prose, fall back to the tool
      // confirmation(s); if there were none either, show a calm note rather
      // than a scary "check server logs" message. The dashboard is unaffected
      // regardless of what the LLM did.
      if (!accumulated) {
        const hadTool = toolMessages.length > 0;
        // Image turns that come back empty are usually a vision-model hiccup
        // (provider error / a model that can't read the image) — say so and
        // invite a retry, rather than the generic "no reply" line.
        const fallback = hadTool
          ? toolMessages.join("\n\n")
          : hasImages
            ? "I couldn't read that image just now — please try again in a moment. Your dashboard and notes are unaffected."
            : "I didn't have a reply for that — your dashboard and notes are unaffected.";
        setMessages((prev) =>
          prev.map((m) =>
            // Offer retry only on a genuinely empty turn (no tool ran). When a
            // tool ran, the work succeeded — no point retrying.
            m.id === placeholderId ? { ...m, text: fallback, canRetry: !hadTool } : m,
          ),
        );
        // A tool ran even though no prose came back — refresh memory views and
        // still attempt the auto-title so the thread doesn't stay "Untitled".
        if (toolMessages.length) {
          void invalidate("/api/memory/preferences");
          const tid = returnedThread ?? threadId;
          if (tid) void maybeAutoTitle(tid);
        }
      } else {
        // First turn pair just completed on a thread we haven't titled yet —
        // ask the server to auto-title it. Idempotent server-side; the ref
        // dedup is just to avoid the round trip on subsequent turns.
        const tid = returnedThread ?? threadId;
        if (tid) void maybeAutoTitle(tid);
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderId
            ? {
                ...m,
                text: `Chat error: ${err instanceof Error ? err.message : "unknown"}. The dashboard still works; this just means AI hasn't been configured (or the demo turn cap was hit).`,
                canRetry: true,
              }
            : m,
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  // `display` is the visible user bubble; `send` is what's actually sent to the
  // model. They differ only for the OCR handoff, where the raw transcription
  // rides along in `send` but stays out of the visible body. Default: identical.
  // `attached` carries any image attachments for this turn (shown as thumbnails
  // on the user bubble; forwarded to the vision model).
  const ask = (
    display: string,
    send: string = display,
    context?: EntryContext,
    attached: ChatImage[] = [],
  ) => {
    // Allow an image-only turn (empty text) when attachments are present.
    if ((!display.trim() && attached.length === 0) || loading) return;
    const newUserMsg: Message = {
      role: "user",
      text: display,
      ts: Date.now(),
      id: makeId(),
      images: attached.length ? attached : undefined,
    };
    const nextHistory = [...messages, newUserMsg];
    setMessages(nextHistory);
    setInput("");

    // Plan edits flow through propose_plan_edit, holding extraction through
    // propose_holding / propose_holdings_import: the model emits proposals in the
    // chat stream, which askLive picks up and renders as cards/tables. `context`,
    // when an Ask-Advisor button supplied it, rides along to the server (never
    // into the visible bubble).
    void askLive(send, messages, context, attached);
  };

  // Send the composer's current text + staged attachments, then clear them.
  const sendComposer = () => {
    if (loading) return;
    const imgs = attachments;
    if (!input.trim() && imgs.length === 0) return;
    ask(input, input, undefined, imgs);
    setAttachments([]);
    setAttachNotice(null);
  };

  // Re-send the user message that produced a failed/empty assistant turn.
  // Drops the failed placeholder, then replays the preceding user turn with
  // the same prior history (askLive re-appends the prompt itself).
  const retry = (failedId: string) => {
    if (loading) return;
    const withoutFailed = messages.filter((m) => m.id !== failedId);
    const last = withoutFailed[withoutFailed.length - 1];
    if (!last || last.role !== "user") return;
    setMessages(withoutFailed);
    void askLive(last.text, withoutFailed.slice(0, -1));
  };

  // Context the UI already has, fed to the thin suggestion layer. These are the
  // SAME fetchers + health computation the Plan panel already uses (AppPanels'
  // PlanPanel) — we're consuming existing context, not building a new data path.
  // The `aggregate` book + selected target model drive portfolio-specific chips;
  // `activeScreen` biases the screen-flavored ones. When a sibling effort lands a
  // formal Advisor context model, swap these inputs for it without touching copy.
  const { aggregate } = usePortfolioView();
  const { models } = useModelPortfoliosView();
  const selectedModelId = useSelectedModelId();
  const targetModel = useMemo(
    () => models?.find((m) => m.id === selectedModelId) ?? null,
    [models, selectedModelId],
  );
  const suggestions = useMemo(() => {
    const health =
      aggregate && aggregate.holdings.length > 0
        ? computeHealth(
            aggregate.holdings,
            aggregate.totalValue,
            targetModel?.mix ?? null,
            targetModel?.ter ?? null,
          )
        : null;
    return buildChatSuggestions({
      screen: activeScreen,
      health,
      targetName: targetModel?.name ?? null,
      hasHoldings: !!aggregate && aggregate.holdings.length > 0,
    });
  }, [aggregate, targetModel, activeScreen]);

  useEffect(() => {
    if (seedPrompt) {
      if (typeof seedPrompt === "string") ask(seedPrompt);
      else ask(seedPrompt.display, seedPrompt.send, seedPrompt.context);
      onPromptConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedPrompt, onPromptConsumed, ask]);

  const applyProposal = async (idx: number, proposal: PlanProposal) => {
    // Optimistic: mark applied immediately, roll back on failure.
    setMessages((prev) => prev.map((x, i) => (i === idx ? { ...x, applied: true } : x)));
    try {
      // Single server round trip — the route reads the current plan, applies
      // the additive edit (applyPlanEdit), and upserts it, all per-user scoped.
      const res = await fetch("/api/plan/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: proposal.section,
          add: proposal.add,
          rm: proposal.rm,
        }),
      });
      if (!res.ok) throw new Error(`plan edit ${res.status}`);
      invalidate("/api/plan");
    } catch (err) {
      // Roll back the optimistic apply and surface the error inline.
      setMessages((prev) =>
        prev.map((x, i) =>
          i === idx
            ? {
                ...x,
                applied: undefined,
                text: `${x.text}\n\n(Couldn't save: ${err instanceof Error ? err.message : "unknown error"}. Try again?)`,
              }
            : x,
        ),
      );
    }
  };

  // Accept a single holding proposal: optimistically mark it applied, POST to
  // the per-user-scoped accept route, then invalidate the holdings SWR cache so
  // the portfolio refreshes. Rolls back on failure. `msgIdx` is the message in
  // the stream; `holdingIdx` is which card within that message's list.
  const applyHolding = async (msgIdx: number, holdingIdx: number, holding: HoldingProposal) => {
    setMessages((prev) =>
      prev.map((x, i) =>
        i === msgIdx ? { ...x, holdingStatus: { ...x.holdingStatus, [holdingIdx]: "applied" } } : x,
      ),
    );
    try {
      const res = await fetch("/api/holdings/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bucketId: holding.bucketId,
          ticker: holding.ticker,
          englishName: holding.englishName,
          thaiName: holding.thaiName,
          assetClass: holding.assetClass,
          region: holding.region,
          units: holding.units,
          avgCost: holding.avgCost,
          ter: holding.ter,
          quoteSource: holding.quoteSource,
          source: holding.source,
        }),
      });
      if (!res.ok) throw new Error(`holding save ${res.status}`);
      invalidate(/^\/api\/holdings/);
    } catch (err) {
      // Roll back the optimistic apply and surface the error inline.
      setMessages((prev) =>
        prev.map((x, i) => {
          if (i !== msgIdx) return x;
          const next = { ...x.holdingStatus };
          delete next[holdingIdx];
          return {
            ...x,
            holdingStatus: next,
            text: `${x.text}\n\n(Couldn't save ${holding.ticker}: ${
              err instanceof Error ? err.message : "unknown error"
            }. Try again?)`,
          };
        }),
      );
    }
  };

  const rejectHolding = (msgIdx: number, holdingIdx: number) => {
    setMessages((prev) =>
      prev.map((x, i) =>
        i === msgIdx
          ? { ...x, holdingStatus: { ...x.holdingStatus, [holdingIdx]: "rejected" } }
          : x,
      ),
    );
  };

  return (
    <div
      // .chat-shell sets the screen's height as a CSS rule rather than inline
      // so the wide-screen panel override (.ra-chat-body .screen { height: 100% })
      // can win on specificity — inline `height` would block it.
      className="screen chat-shell"
    >
      <div className="topbar">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setShowThreads(true)}
          disabled={loading}
          aria-label="Open chat list"
          title="All chats"
        >
          <Icon name="menu" size={15} />
        </button>
        <div className="brand" style={{ flex: 1 }}>
          <span>{AI_PERSONALITIES.advisor.label}</span>
        </div>
        <button
          type="button"
          className="chip-btn"
          onClick={newChat}
          disabled={loading}
          title="Start a new conversation"
        >
          <Icon name="sparkle" size={12} /> New chat
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onOpenMenu}
          aria-label="More"
          title="More"
        >
          <Icon name="ellipsis-vertical" size={15} />
        </button>
      </div>

      <ChatThreadList
        open={showThreads}
        onClose={() => setShowThreads(false)}
        activeThreadId={threadId}
        onSelect={(id) => {
          if (id !== threadId) {
            void loadThread(id);
          }
        }}
        onNewChat={newChat}
      />

      <div
        className="chat-stream"
        ref={setStreamRef}
        // `min-height: 0` lets flex:1 shrink below content size so overflow-y
        // actually kicks in (otherwise long messages push the composer off-screen).
        style={{ flex: 1, paddingBottom: 8, minHeight: 0, overflowY: "auto" }}
        onDragOver={imageUploadEnabled ? (e) => e.preventDefault() : undefined}
        onDrop={
          imageUploadEnabled
            ? (e) => {
                const files = Array.from(e.dataTransfer.files).filter((f) =>
                  f.type.startsWith("image/"),
                );
                if (files.length > 0) {
                  e.preventDefault();
                  void addFiles(files);
                }
              }
            : undefined
        }
      >
        {/* Single stable child: OverlayScrollbars re-parents the host's children
            into a generated viewport, so React must reconcile the dynamic
            messages INSIDE this wrapper, not directly under the OS host (else
            `removeChild` throws). Carries the column+gap layout the OS host
            would otherwise strip. Mirrors `.ra-panel-body-content`. */}
        <div className="chat-stream-content">
          {messages.map((m, i) => (
            <div key={m.id} className={`msg ${m.role}`}>
              {m.role === "ai" && (
                <div className="meta">
                  Advisor ·{" "}
                  {new Date(m.ts).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {m.model && <> · {m.model}</>}
                </div>
              )}
              {m.role === "ai" && !m.text && loading ? (
                <div className="typing">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              ) : m.role === "ai" ? (
                // Advisor replies are Markdown — render them styled. User bubbles
                // stay plain text (below) so nothing the user typed is reinterpreted
                // as markup.
                m.text && <MarkdownMessage text={m.text} />
              ) : (
                m.text && <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
              )}
              {m.images && m.images.length > 0 && (
                <div className="chat-attachments">
                  {m.images.map((img) => (
                    <button
                      type="button"
                      key={img.id}
                      className="thumb"
                      onClick={() => setLightbox(img.fullDataUrl ?? img.dataUrl)}
                      title={img.name}
                      aria-label={`View ${img.name}`}
                    >
                      {/* biome-ignore lint/performance/noImgElement: data-URL thumbnail, not a remote asset */}
                      <img src={img.dataUrl} alt={img.name} />
                    </button>
                  ))}
                </div>
              )}
              {m.canRetry && (
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => retry(m.id)}
                  disabled={loading}
                  style={{ marginTop: 6 }}
                >
                  Try again
                </button>
              )}
              {m.proposal && (
                <PlanProposalCard
                  proposal={m.proposal}
                  applied={m.applied}
                  onApply={() => applyProposal(i, m.proposal!)}
                  onReject={() => {
                    setMessages((prev) =>
                      prev.map((x, idx) =>
                        idx === i ? { ...x, applied: false, rejected: true } : x,
                      ),
                    );
                  }}
                />
              )}
              {m.holdings?.map((h, hIdx) => (
                <HoldingProposalCard
                  key={`${m.id}-holding-${hIdx}`}
                  holding={h}
                  status={m.holdingStatus?.[hIdx]}
                  onApply={() => applyHolding(i, hIdx, h)}
                  onReject={() => rejectHolding(i, hIdx)}
                />
              ))}
              {m.holdingsImport && (
                <HoldingsImportCard
                  data={m.holdingsImport}
                  onOpen={() => requestImportWithRows(m.holdingsImport!.rows)}
                />
              )}
              {m.transactionsImport && (
                <TransactionsImportCard
                  data={m.transactionsImport}
                  onOpen={() => requestTxnImportWithRows(m.transactionsImport!.rows)}
                />
              )}
              {m.role === "ai" &&
                i > 0 &&
                !m.proposal &&
                !m.holdings?.length &&
                !m.holdingsImport &&
                !m.transactionsImport && (
                  <FeedbackRow
                    label="HELPFUL?"
                    value={msgFeedback[i]?.rating ?? null}
                    saved={msgFeedback[i]?.saved}
                    onChange={(rating) =>
                      setMsgFeedback({
                        ...msgFeedback,
                        [i]: { ...msgFeedback[i], rating },
                      })
                    }
                    onSave={() =>
                      setMsgFeedback({
                        ...msgFeedback,
                        [i]: { ...msgFeedback[i], saved: !msgFeedback[i]?.saved },
                      })
                    }
                  />
                )}
            </div>
          ))}
          {/* Standalone "thinking" bubble only when there's no streaming
            placeholder yet — i.e. proposal flow with 700ms setTimeout. The
            stream flow renders typing dots inline inside the empty AI msg. */}
          {loading && messages[messages.length - 1]?.role !== "ai" && (
            <div className="msg ai">
              <div className="meta">Advisor · thinking</div>
              <div className="typing">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          )}
        </div>
      </div>

      {contextNotice && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            margin: "0 8px 6px",
            padding: "8px 10px",
            fontSize: 12,
            lineHeight: 1.4,
            color: "var(--ink-soft)",
            background: "var(--card-soft)",
            border: "1px solid var(--line)",
            borderRadius: 8,
          }}
        >
          <Icon name="sparkle" size={12} />
          <span style={{ flex: 1 }}>
            This chat is getting long — earlier turns are summarized to keep replies fast. Start a
            new chat for a clean slate.
          </span>
          <button
            type="button"
            className="btn ghost sm"
            onClick={newChat}
            disabled={loading}
            style={{ flexShrink: 0 }}
          >
            New chat
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => setContextNotice(false)}
            aria-label="Dismiss"
            style={{ flexShrink: 0, padding: "4px 8px" }}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      {limitNotice && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            margin: "0 8px 6px",
            padding: "8px 10px",
            fontSize: 12,
            lineHeight: 1.4,
            color: "var(--ink-soft)",
            background: "var(--card-soft)",
            border: "1px solid var(--line)",
            borderRadius: 8,
          }}
        >
          <Icon name="sparkle" size={12} />
          <span style={{ flex: 1 }}>
            You've reached today's chat usage limit. It resets at midnight UTC — your dashboard and
            saved notes are unaffected.
          </span>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => setLimitNotice(false)}
            aria-label="Dismiss"
            style={{ flexShrink: 0, padding: "4px 8px" }}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      {attachments.length === 0 && (
        <div className="suggested-chips">
          {suggestions.map((s) => (
            <button key={s} className="chip" onClick={() => ask(s)} disabled={loading}>
              {s}
            </button>
          ))}
        </div>
      )}

      {imageUploadEnabled && attachments.length > 0 && (
        <div className="composer-attachments">
          {attachments.map((a, idx) => (
            <div className="thumb" key={a.id}>
              {/* biome-ignore lint/performance/noImgElement: data-URL preview, not a remote asset */}
              <img src={a.dataUrl} alt={a.name} />
              <button
                type="button"
                onClick={() => removeAttachment(idx)}
                aria-label={`Remove ${a.name}`}
                title="Remove"
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          ))}
          <span className="note">
            Images stay in your browser and are sent to Advisor to answer — they are not stored on
            our servers.
          </span>
          {attachNotice && (
            <span className="note" style={{ color: "var(--amber)" }}>
              {attachNotice}
            </span>
          )}
        </div>
      )}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          sendComposer();
        }}
      >
        {imageUploadEnabled && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                void addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading || attachments.length >= MAX_ATTACHMENTS}
              aria-label="Attach image"
              title={
                attachments.length >= MAX_ATTACHMENTS
                  ? `Up to ${MAX_ATTACHMENTS} images`
                  : "Attach image"
              }
            >
              <Icon name="paperclip" size={16} />
            </button>
          </>
        )}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => {
            if (!imageUploadEnabled) return;
            const files = Array.from(e.clipboardData.files).filter((f) =>
              f.type.startsWith("image/"),
            );
            if (files.length > 0) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          placeholder="Ask about your portfolio…"
          disabled={loading}
        />
        <button type="submit" disabled={(!input.trim() && attachments.length === 0) || loading}>
          <Icon name="send" size={14} />
        </button>
      </form>

      {/*
        Persistent AI disclaimer. Verbatim project-wide string — see
        AGENTS.md § Product copy & vocabulary. Plain muted text, not
        dismissible, not a banner.
      */}
      <div
        role="note"
        style={{
          textAlign: "center",
          fontSize: 11,
          color: "var(--muted)",
          padding: "6px 12px 8px",
          lineHeight: 1.4,
        }}
      >
        Advisor is AI and can make mistakes.
      </div>

      {lightbox && (
        <button
          type="button"
          className="chat-lightbox"
          onClick={() => setLightbox(null)}
          aria-label="Close image"
        >
          {/* biome-ignore lint/performance/noImgElement: data-URL preview, not a remote asset */}
          <img src={lightbox} alt="Attached" />
        </button>
      )}
    </div>
  );
}
