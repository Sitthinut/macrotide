"use client";

import { useRef, useState } from "react";
import { ModelDonut } from "@/components/charts";
import { Icon } from "@/components/Icon";
import { useModelPortfoliosView } from "@/lib/fetchers/legacy";
import { invalidate } from "@/lib/fetchers/swr";
import { modelPortfolioToInsert } from "@/lib/portfolio/adapter";
import type { ModelPortfolio } from "@/lib/static/types";

export interface ModelPortfoliosScreenProps {
  selectedId: string;
  onSelect: (id: string) => void;
  onBack: () => void;
}

export function ModelPortfoliosScreen({
  selectedId,
  onSelect,
  onBack,
}: ModelPortfoliosScreenProps) {
  const { models, isLoading } = useModelPortfoliosView();
  const [openId, setOpenId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "curated" | "custom">("all");

  const list = models ?? [];
  const open = list.find((m) => m.id === openId);

  const filtered =
    filter === "custom"
      ? list.filter((m) => m.isCustom)
      : filter === "curated"
        ? list.filter((m) => !m.isCustom)
        : list;

  const addModel = async (m: ModelPortfolio) => {
    try {
      await fetch("/api/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(modelPortfolioToInsert(m)),
      });
      invalidate("/api/models");
    } catch (err) {
      console.error("Failed to save custom model:", err);
    }
  };

  // Duplicate-to-customize: fork a (built-in or any) model into a user-owned,
  // editable copy. The POST path stamps the current user via ownerId(), so the
  // copy is `built_in = false` and fully editable, while the shared original is
  // never mutated. Opens the new copy so the user can immediately edit it.
  const duplicateModel = async (m: ModelPortfolio) => {
    try {
      const copy: ModelPortfolio = {
        ...m,
        id: `custom_${Date.now()}`,
        name: `${m.name} (copy)`,
        isCustom: true,
      };
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(modelPortfolioToInsert(copy)),
      });
      const saved = res.ok ? await res.json() : null;
      await invalidate("/api/models");
      setOpenId(saved?.id ?? copy.id);
    } catch (err) {
      console.error("Failed to duplicate model:", err);
    }
  };

  const deleteModel = async (id: string) => {
    try {
      await fetch(`/api/models/${id}`, { method: "DELETE" });
      await invalidate("/api/models");
      setOpenId(null);
    } catch (err) {
      console.error("Failed to delete model:", err);
    }
  };

  if (open) {
    return (
      <ModelDetail
        model={open}
        selected={selectedId === open.id}
        onBack={() => setOpenId(null)}
        onSelect={onSelect}
        onDuplicate={() => duplicateModel(open)}
        onDelete={() => deleteModel(open.id)}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="screen">
        <div className="topbar">
          <div className="brand" style={{ flex: 1 }}>
            <span>Templates</span>
          </div>
        </div>
        <div style={{ padding: 24, color: "var(--muted)" }}>Loading…</div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Back" style={{ marginRight: 8 }}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="brand" style={{ flex: 1 }}>
          <span>Templates</span>
        </div>
        <button
          className="icon-btn"
          aria-label="Add custom"
          onClick={() => setAddOpen(true)}
          style={{ borderColor: "var(--accent)" }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      <div style={{ padding: "4px 20px 14px" }}>
        <p
          style={{
            fontSize: 13.5,
            color: "var(--ink-soft)",
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          Time-tested index-investing strategies. Pick one as your{" "}
          <strong style={{ fontWeight: 500 }}>target allocation</strong>, or add your own from a
          URL, image, or by chatting with the advisor.
        </p>
      </div>

      <div className="filter-chips" style={{ padding: "0 16px 12px" }}>
        <span className="chip" data-active={filter === "all"} onClick={() => setFilter("all")}>
          All · {list.length}
        </span>
        <span
          className="chip"
          data-active={filter === "curated"}
          onClick={() => setFilter("curated")}
        >
          Curated · {list.filter((m) => !m.isCustom).length}
        </span>
        <span
          className="chip"
          data-active={filter === "custom"}
          onClick={() => setFilter("custom")}
        >
          Yours · {list.filter((m) => m.isCustom).length}
        </span>
      </div>

      <div
        style={{
          padding: "0 14px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {filtered.map((m) => (
          <div
            key={m.id}
            className="card"
            style={{
              cursor: "pointer",
              borderColor: selectedId === m.id ? "var(--accent)" : "var(--line-soft)",
              borderWidth: selectedId === m.id ? 2 : 1,
              padding: 14,
            }}
            onClick={() => setOpenId(m.id)}
          >
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <ModelDonut mix={m.mix} size={56} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14.5,
                    fontWeight: 500,
                    letterSpacing: "-0.01em",
                    lineHeight: 1.25,
                    marginBottom: 4,
                  }}
                >
                  {m.name}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    marginBottom: 6,
                    flexWrap: "wrap",
                  }}
                >
                  {selectedId === m.id && (
                    <span className="tag green" style={{ fontSize: 9 }}>
                      ● TARGET
                    </span>
                  )}
                  {m.isCustom && (
                    <span
                      className="tag"
                      style={{
                        fontSize: 9,
                        background: "var(--card-soft)",
                      }}
                    >
                      CUSTOM
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    lineHeight: 1.35,
                    marginBottom: 8,
                  }}
                >
                  {m.tagline}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    fontSize: 11,
                    color: "var(--ink-soft)",
                    flexWrap: "wrap",
                  }}
                >
                  <span className="num">
                    <span style={{ color: "var(--muted)" }}>Return</span>{" "}
                    {m.expectedReturn.toFixed(1)}%
                  </span>
                  <span className="num">
                    <span style={{ color: "var(--muted)" }}>Vol</span> {m.expectedVol.toFixed(1)}%
                  </span>
                  <span className="num">
                    <span style={{ color: "var(--muted)" }}>TER</span> {m.ter.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}

        <div
          className="card"
          style={{
            padding: 14,
            cursor: "pointer",
            borderStyle: "dashed",
            borderColor: "var(--line)",
            background: "transparent",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
          onClick={() => setAddOpen(true)}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 11,
              background: "var(--card-soft)",
              display: "grid",
              placeItems: "center",
              color: "var(--accent)",
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 500,
                letterSpacing: "-0.01em",
              }}
            >
              Add custom template
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              From URL, image, text, or chat
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <div
          style={{
            fontSize: 11,
            color: "var(--muted)",
            lineHeight: 1.5,
            padding: "0 4px",
            fontFamily: "var(--font-mono)",
          }}
        >
          ⓘ Expected return/vol are historical estimates, not guarantees. Past performance does not
          predict future results.
        </div>
      </div>

      <AddCustomModelSheet open={addOpen} onClose={() => setAddOpen(false)} onAdd={addModel} />
    </div>
  );
}

function ModelDetail({
  model,
  selected,
  onBack,
  onSelect,
  onDuplicate,
  onDelete,
}: {
  model: ModelPortfolio;
  selected: boolean;
  onBack: () => void;
  onSelect: (id: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  // Built-ins are a shared, read-only library — you fork them to customize.
  // User-owned ("custom") models are editable/deletable in place.
  const isCustom = model.isCustom === true;
  return (
    <div className="screen">
      <div className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Back" style={{ marginRight: 8 }}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="brand" style={{ flex: 1 }}>
          <span>{model.name}</span>
        </div>
      </div>

      <div style={{ padding: "4px 20px 8px" }}>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>{model.tagline}</div>
        <p
          style={{
            fontSize: 14,
            color: "var(--ink-soft)",
            lineHeight: 1.5,
            margin: "8px 0 0",
          }}
        >
          {model.blurb}
        </p>
      </div>

      <div className="section" style={{ marginTop: 14 }}>
        <div className="card">
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <ModelDonut mix={model.mix} size={92} thickness={14} />
            <div style={{ flex: 1 }}>
              {model.mix.map((m) => (
                <div
                  key={m.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 5,
                    fontSize: 12.5,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: m.color,
                    }}
                  ></span>
                  <span style={{ flex: 1, fontWeight: 500 }}>{m.label}</span>
                  <span className="num" style={{ color: "var(--muted)" }}>
                    {m.pct.toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 8,
          }}
        >
          {[
            {
              lbl: "EXPECTED RETURN",
              val: `${model.expectedReturn.toFixed(1)}%`,
              color: "var(--gain)",
            },
            {
              lbl: "VOLATILITY",
              val: `${model.expectedVol.toFixed(1)}%`,
              color: "var(--ink)",
            },
            {
              lbl: "BLENDED TER",
              val: `${model.ter.toFixed(2)}%`,
              color: "var(--ink)",
            },
          ].map((s) => (
            <div
              key={s.lbl}
              className="card-soft"
              style={{ padding: "10px 12px", textAlign: "left" }}
            >
              <div
                style={{
                  fontSize: 9.5,
                  fontFamily: "var(--font-mono)",
                  color: "var(--muted)",
                  letterSpacing: "0.04em",
                  marginBottom: 2,
                }}
              >
                {s.lbl}
              </div>
              <div className="num" style={{ fontSize: 16, fontWeight: 500, color: s.color }}>
                {s.val}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="card">
          <div style={{ display: "flex", gap: 16, fontSize: 12.5, marginBottom: 12 }}>
            <div>
              <div
                style={{
                  color: "var(--muted)",
                  fontSize: 10.5,
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.04em",
                  marginBottom: 2,
                }}
              >
                HORIZON
              </div>
              <div style={{ fontWeight: 500 }}>{model.horizon}</div>
            </div>
            <div>
              <div
                style={{
                  color: "var(--muted)",
                  fontSize: 10.5,
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.04em",
                  marginBottom: 2,
                }}
              >
                RISK
              </div>
              <div style={{ fontWeight: 500, textTransform: "capitalize" }}>{model.risk}</div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: "var(--gain)",
                  marginBottom: 6,
                }}
              >
                Pros
              </div>
              {model.pros.map((p) => (
                <div
                  key={p}
                  style={{
                    fontSize: 12,
                    lineHeight: 1.4,
                    marginBottom: 4,
                    color: "var(--ink-soft)",
                  }}
                >
                  + {p}
                </div>
              ))}
            </div>
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: "var(--loss)",
                  marginBottom: 6,
                }}
              >
                Cons
              </div>
              {model.cons.map((c) => (
                <div
                  key={c}
                  style={{
                    fontSize: 12,
                    lineHeight: 1.4,
                    marginBottom: 4,
                    color: "var(--ink-soft)",
                  }}
                >
                  − {c}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="section" style={{ marginTop: 4 }}>
        <button
          className="btn primary full"
          onClick={() => {
            onSelect(model.id);
            onBack();
          }}
          disabled={selected}
        >
          {selected ? "● Currently your target" : "Set as my target allocation"}
          {!selected && <Icon name="arrowRight" size={13} />}
        </button>
        {!isCustom && (
          <button className="btn ghost full" style={{ marginTop: 8 }} onClick={onDuplicate}>
            <Icon name="copy" size={13} /> Duplicate to customize
          </button>
        )}
        {isCustom && (
          <button
            className="btn ghost full"
            style={{ marginTop: 8, color: "var(--loss)" }}
            onClick={onDelete}
          >
            <Icon name="trash" size={13} /> Delete this template
          </button>
        )}
        <button
          className="btn ghost full"
          style={{ marginTop: 8 }}
          onClick={() => {
            window.dispatchEvent(new CustomEvent("nav", { detail: "chat" }));
            window.dispatchEvent(
              new CustomEvent("ai-prompt", {
                detail: `Tell me more about the ${model.name} strategy — when does it work best and when does it struggle?`,
              }),
            );
          }}
        >
          <Icon name="chat" size={13} /> Ask the advisor about this
        </button>
      </div>
    </div>
  );
}

interface PendingModel {
  name: string;
  tagline: string;
  blurb: string;
  mix: { label: string; pct: number; color: string }[];
  expectedReturn: number;
  expectedVol: number;
  ter: number;
  source: string;
}

function AddCustomModelSheet({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (model: ModelPortfolio) => void;
}) {
  const [method, setMethod] = useState<"url" | "text" | "image" | "chat">("url");
  const [url, setUrl] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [name, setName] = useState("");
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [extracted, setExtracted] = useState<PendingModel | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const ingestUrl = () => {
    setProcessing(true);
    setTimeout(() => {
      setProcessing(false);
      setExtracted({
        name: name || "Permanent Portfolio (HB)",
        tagline: "Harry Browne · imported from blog post",
        blurb:
          "Equal weights across stocks, bonds, gold, and cash. Imported from " +
          (url || "the URL you shared") +
          ".",
        mix: [
          { label: "US Stocks", pct: 25, color: "var(--accent)" },
          { label: "Long Bonds", pct: 25, color: "#F4A434" },
          { label: "Gold", pct: 25, color: "#D4AE5C" },
          { label: "Cash", pct: 25, color: "#9E9EA8" },
        ],
        expectedReturn: 5.0,
        expectedVol: 7.5,
        ter: 0.4,
        source: url || "Imported URL",
      });
    }, 1500);
  };

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImgPreview((ev.target?.result as string) ?? null);
      setProcessing(true);
      setTimeout(() => {
        setProcessing(false);
        setExtracted({
          name: name || "From screenshot",
          tagline: "Extracted from image · review and confirm",
          blurb: "AI parsed allocation chart from your image. Verify the breakdown looks right.",
          mix: [
            { label: "Equity", pct: 60, color: "var(--accent)" },
            { label: "Bonds", pct: 30, color: "#F4A434" },
            { label: "Alternatives", pct: 10, color: "#7C7CFF" },
          ],
          expectedReturn: 6.5,
          expectedVol: 10.5,
          ter: 0.55,
          source: "Imported image",
        });
      }, 1800);
    };
    reader.readAsDataURL(file);
  };

  const ingestText = () => {
    setProcessing(true);
    setTimeout(() => {
      setProcessing(false);
      const matches = [
        ...pasteText.matchAll(/(\d+)\s*%?\s*([A-Za-z][A-Za-z\s\-/]+?)(?:[,.\n]|$)/g),
      ].slice(0, 6);
      const colors = ["var(--accent)", "#F4A434", "#7C7CFF", "#C76A8F", "#5BA7B5", "#9E9EA8"];
      const mix = matches.map((m, i) => ({
        label: m[2].trim(),
        pct: Number(m[1]),
        color: colors[i] || "#9E9EA8",
      }));
      setExtracted({
        name: name || "From text",
        tagline: "Built from your pasted allocation",
        blurb: "Mock-parsed from text. Verify the breakdown is correct.",
        mix: mix.length
          ? mix
          : [
              { label: "Stocks", pct: 60, color: "var(--accent)" },
              { label: "Bonds", pct: 40, color: "#F4A434" },
            ],
        expectedReturn: 6.0,
        expectedVol: 10.0,
        ter: 0.5,
        source: "Pasted text",
      });
    }, 800);
  };

  const startChat = () => {
    window.dispatchEvent(
      new CustomEvent("ai-prompt", {
        detail:
          "Help me design a custom portfolio allocation. Ask me a few questions about what I want and propose an allocation.",
      }),
    );
    onClose();
  };

  const confirm = () => {
    if (!extracted) return;
    onAdd({
      id: `custom_${Date.now()}`,
      name: extracted.name,
      tagline: extracted.tagline,
      blurb: extracted.blurb,
      mix: extracted.mix,
      expectedReturn: extracted.expectedReturn,
      expectedVol: extracted.expectedVol,
      ter: extracted.ter,
      horizon: "Any",
      risk: "balanced",
      pros: [],
      cons: [],
      source: extracted.source,
      isCustom: true,
    });
    setExtracted(null);
    setUrl("");
    setPasteText("");
    setName("");
    setImgPreview(null);
    onClose();
  };

  if (extracted) {
    return (
      <div className="sheet-overlay" onClick={onClose}>
        <div className="sheet" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-handle"></div>
          <div className="sheet-title">Review & confirm</div>
          <div className="sheet-subtitle">
            AI parsed this model. Tweak the name or accept as-is.
          </div>

          <div
            style={{
              background: "var(--card-soft)",
              borderRadius: 12,
              padding: 12,
              marginBottom: 12,
            }}
          >
            <input
              value={extracted.name}
              onChange={(e) => setExtracted({ ...extracted, name: e.target.value })}
              style={{
                fontSize: 16,
                fontWeight: 500,
                letterSpacing: "-0.02em",
                width: "100%",
                background: "transparent",
                border: 0,
                outline: 0,
                color: "var(--ink)",
                marginBottom: 4,
                fontFamily: "var(--font-sans)",
              }}
            />
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{extracted.tagline}</div>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <ModelDonut mix={extracted.mix} size={56} thickness={8} />
              <div style={{ flex: 1 }}>
                {extracted.mix.map((m, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      padding: "2px 0",
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: m.color,
                      }}
                    ></span>
                    <span style={{ flex: 1 }}>{m.label}</span>
                    <span className="num" style={{ color: "var(--muted)" }}>
                      {m.pct.toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div
            style={{
              fontSize: 11,
              color: "var(--muted)",
              lineHeight: 1.5,
              marginBottom: 12,
            }}
          >
            <strong style={{ fontWeight: 500, color: "var(--ink-soft)" }}>Source:</strong>{" "}
            {extracted.source}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost" style={{ flex: 1 }} onClick={() => setExtracted(null)}>
              Back
            </button>
            <button className="btn primary" style={{ flex: 2 }} onClick={confirm}>
              Save template <Icon name="check" size={13} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle"></div>
        <div className="sheet-title">Add a custom template</div>
        <div className="sheet-subtitle">
          Bring any allocation from outside Macrotide. The AI parses, you confirm, and it&apos;s
          saved to your Journal.
        </div>

        <div style={{ marginBottom: 14 }}>
          <label
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--muted)",
              letterSpacing: "0.04em",
              marginBottom: 4,
              display: "block",
            }}
          >
            NAME (OPTIONAL)
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. My EM-tilt mix"
            style={{
              width: "100%",
              padding: "8px 10px",
              background: "var(--card-soft)",
              border: "1px solid var(--line-soft)",
              borderRadius: 8,
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              color: "var(--ink)",
              outline: "none",
            }}
          />
        </div>

        <div className="method-tabs">
          <button data-active={method === "url"} onClick={() => setMethod("url")}>
            🔗 URL
          </button>
          <button data-active={method === "text"} onClick={() => setMethod("text")}>
            📋 Text
          </button>
          <button data-active={method === "image"} onClick={() => setMethod("image")}>
            📷 Image
          </button>
          <button data-active={method === "chat"} onClick={() => setMethod("chat")}>
            💬 Chat
          </button>
        </div>

        {method === "url" && (
          <div>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://bogleheads.org/wiki/Three-fund_portfolio"
              style={{
                width: "100%",
                padding: "12px 14px",
                background: "var(--card-soft)",
                border: "1px solid var(--line-soft)",
                borderRadius: 12,
                fontFamily: "var(--font-mono)",
                fontSize: 12.5,
                color: "var(--ink)",
                outline: "none",
              }}
            />
            <div
              style={{
                fontSize: 11,
                color: "var(--muted)",
                marginTop: 6,
                lineHeight: 1.5,
                fontFamily: "var(--font-mono)",
              }}
            >
              ⓘ The advisor reads the article and extracts the allocation.
            </div>
          </div>
        )}

        {method === "text" && (
          <textarea
            className="sheet-input"
            placeholder={"e.g.\n50% US Total Market\n30% International\n20% Bonds"}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
        )}

        {method === "image" && !imgPreview && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleImage}
            />
            <div className="drop-zone" onClick={() => fileRef.current?.click()}>
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              <div className="dz-title">Drop an allocation chart</div>
              <div className="dz-sub">or tap to browse · AI will read the breakdown</div>
            </div>
          </>
        )}
        {method === "image" && imgPreview && (
          <div>
            <div
              style={{
                borderRadius: 12,
                overflow: "hidden",
                border: "1px solid var(--line-soft)",
                marginBottom: 12,
                position: "relative",
              }}
            >
              <img
                src={imgPreview}
                alt="preview"
                style={{
                  width: "100%",
                  display: "block",
                  maxHeight: 200,
                  objectFit: "cover",
                }}
              />
              {processing && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(0,0,0,0.5)",
                    display: "grid",
                    placeItems: "center",
                    color: "white",
                  }}
                >
                  <div className="typing">
                    <span style={{ background: "white" }}></span>
                    <span style={{ background: "white" }}></span>
                    <span style={{ background: "white" }}></span>
                  </div>
                </div>
              )}
            </div>
            <button className="btn ghost sm full" onClick={() => setImgPreview(null)}>
              Use a different image
            </button>
          </div>
        )}

        {method === "chat" && (
          <div
            className="card"
            style={{
              background: "var(--accent-soft)",
              borderColor: "transparent",
              padding: 14,
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 500,
                marginBottom: 6,
                color: "var(--accent-ink)",
                letterSpacing: "-0.01em",
              }}
            >
              Build with the advisor
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: "var(--accent-ink)",
                lineHeight: 1.5,
                marginBottom: 12,
                opacity: 0.85,
              }}
            >
              The advisor will ask 3–5 questions and propose an allocation. You confirm and
              it&apos;s saved.
            </div>
            <button className="btn sm primary" onClick={startChat}>
              <Icon name="chat" size={12} /> Start conversation
            </button>
          </div>
        )}

        {method !== "chat" && (
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              className="btn ghost"
              style={{ flex: 1 }}
              onClick={onClose}
              disabled={processing}
            >
              Cancel
            </button>
            <button
              className="btn primary"
              style={{ flex: 2 }}
              disabled={
                processing ||
                (method === "url" && !url) ||
                (method === "text" && !pasteText) ||
                (method === "image" && !imgPreview)
              }
              onClick={() => {
                if (method === "url") ingestUrl();
                if (method === "text") ingestText();
              }}
            >
              {processing ? "Reading…" : "Parse"} <Icon name="arrowRight" size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
