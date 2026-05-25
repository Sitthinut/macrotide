"use client";

import { useEffect, useState } from "react";
import { type AddedHolding, AddHoldingsSheet } from "@/components/AddHoldingsSheet";
import {
  type AppId,
  ChatPanel,
  NotesPanel,
  PlanPanel,
  PortfoliosPanel,
} from "@/components/AppPanels";
import { Icon } from "@/components/Icon";
import { type PortfolioFormValues, PortfolioSheet } from "@/components/PortfolioSheet";
import { AccountScreen } from "@/components/screens/AccountScreen";
import { ChatScreen } from "@/components/screens/ChatScreen";
import { JournalScreen } from "@/components/screens/JournalScreen";
import { MarketsScreen } from "@/components/screens/MarketsScreen";
import { ModelPortfoliosScreen } from "@/components/screens/ModelPortfoliosScreen";
import { PortfolioScreen } from "@/components/screens/PortfolioScreen";
import { SettingsScreen, type Theme } from "@/components/screens/SettingsScreen";
import { authClient } from "@/lib/auth/client";
import { usePortfolioView, useSelectedModelId } from "@/lib/fetchers/legacy";
import { usePlan } from "@/lib/fetchers/portfolio";
import { invalidate } from "@/lib/fetchers/swr";
import type { Portfolio } from "@/lib/static/types";
import { useScrollHide } from "@/lib/useScrollHide";
import { useViewport } from "@/lib/useViewport";

function portfolioToFormValues(p: Portfolio): PortfolioFormValues {
  return {
    id: p.id,
    name: p.name,
    icon: p.icon || "wallet",
    color: p.color || "var(--accent)",
    notes: p.notes || "",
  };
}

type Screen = "portfolio" | "markets" | "chat" | "journal" | "models" | "settings" | "account";

const MOBILE_NAV: { id: Screen; icon: string; label: string }[] = [
  { id: "portfolio", icon: "home", label: "Portfolio" },
  { id: "markets", icon: "pulse", label: "Markets" },
  { id: "chat", icon: "chat", label: "Chat" },
  { id: "journal", icon: "book", label: "Journal" },
];

// Wide shell drops "chat" from the rail — chat lives in the right dock instead.
const WIDE_NAV: { id: Screen; icon: string; label: string }[] = [
  { id: "portfolio", icon: "home", label: "Portfolio" },
  { id: "markets", icon: "pulse", label: "Markets" },
  { id: "journal", icon: "book", label: "Journal" },
];

const APPS_RAIL: { id: AppId; icon: string; label: string }[] = [
  { id: "chat", icon: "chat", label: "Chat" },
  { id: "portfolios", icon: "chart", label: "Portfolios" },
  { id: "plan", icon: "insight", label: "Plan" },
  { id: "notes", icon: "book", label: "Notes" },
];

const THEME_STORAGE_KEY = "macrotide-theme";

export function App() {
  const viewport = useViewport();
  const isWide = viewport !== "mobile";
  const isDesktop = viewport === "desktop";
  useScrollHide();

  // Rail identity. A signed-in owner shows their real name/email; demo and
  // AUTH_DISABLED sessions have no better-auth user, so we fall back to the
  // generic "Demo user" labels.
  const accountUser = authClient.useSession().data?.user;
  const accountName = accountUser?.name?.trim() || "Demo user";
  const accountSub = accountUser?.email || "Live · Demo Broker";
  const accountInitials =
    accountName
      .split(/\s+/)
      .map((w) => w[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || "DU";

  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "system";
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === "light" || stored === "dark" || stored === "system") return stored;
    } catch {}
    return "system";
  });
  const [screen, setScreen] = useState<Screen>("portfolio");
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [, setExtraHoldings] = useState<AddedHolding[]>([]);
  const [, setSavedReading] = useState<unknown[]>([]);
  const planSelectedModelId = useSelectedModelId();
  const { data: plan } = usePlan();
  const [selectedModelOverride, setSelectedModelOverride] = useState<string | null>(null);
  const selectedModelId = selectedModelOverride ?? planSelectedModelId ?? "bogle3";
  // Which app panel is open on the right.
  // Default behaviour depends on viewport (thresholds mirror useViewport):
  //   - Desktop (≥1000): chat opens by default — side-by-side fits.
  //   - Tablet (700–999):  closed by default — panel is an overlay.
  //   - Mobile (<700):     no panel rail at all; chat lives as its own screen.
  const [activeApp, setActiveApp] = useState<AppId | null>(() => {
    if (typeof window === "undefined") return "chat";
    return window.innerWidth >= 1000 ? "chat" : null;
  });
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  // PortfolioSheet lives at the App level so it survives the mobile↔wide
  // layout swap (which remounts everything below App). Without this lift,
  // an open edit dialog disappears the moment the viewport crosses 700px.
  const [portfolioSheet, setPortfolioSheet] = useState<
    { mode: "create" } | { mode: "edit"; portfolio: Portfolio } | null
  >(null);
  const { portfolios } = usePortfolioView();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {}
  }, [theme]);
  useEffect(() => {
    document.documentElement.setAttribute("data-viewport", viewport);
  }, [viewport]);

  // If we resize mobile → wide while on the Chat screen, hop into the dock.
  useEffect(() => {
    if (isWide && screen === "chat") {
      setScreen("portfolio");
      setActiveApp("chat");
    }
  }, [isWide, screen]);

  // Portfolio sheet event wiring: PortfolioScreen and PortfoliosPanel both
  // dispatch these. App owns the sheet so it persists across viewport swaps.
  useEffect(() => {
    const onNew = () => setPortfolioSheet({ mode: "create" });
    const onEdit = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const found = portfolios?.find((p) => p.id === id);
      if (found) setPortfolioSheet({ mode: "edit", portfolio: found });
    };
    window.addEventListener("new-portfolio", onNew);
    window.addEventListener("edit-portfolio", onEdit);
    return () => {
      window.removeEventListener("new-portfolio", onNew);
      window.removeEventListener("edit-portfolio", onEdit);
    };
  }, [portfolios]);

  async function savePortfolio(values: PortfolioFormValues) {
    const isEdit = portfolioSheet?.mode === "edit";
    if (isEdit) {
      const res = await fetch(`/api/buckets/${encodeURIComponent(values.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          icon: values.icon,
          color: values.color,
          notes: values.notes,
        }),
      });
      if (!res.ok) throw new Error(`Update failed (${res.status})`);
    } else {
      const res = await fetch("/api/buckets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) throw new Error(`Create failed (${res.status})`);
    }
    invalidate("/api/buckets");
  }

  async function deletePortfolio(id: string) {
    const res = await fetch(`/api/buckets/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`Delete failed (${res.status})`);
    invalidate("/api/buckets");
    invalidate(/^\/api\/holdings/);
    // Tell PortfolioScreen to reset its active selection if it was viewing
    // the deleted portfolio.
    window.dispatchEvent(new CustomEvent("activate-portfolio", { detail: "all" }));
  }

  // Cross-screen events
  useEffect(() => {
    const navHandler = (e: Event) => {
      const target = (e as CustomEvent<Screen>).detail;
      if (isWide && target === "chat") setActiveApp("chat");
      else setScreen(target);
    };
    const promptHandler = (e: Event) => {
      setPendingPrompt((e as CustomEvent<string>).detail);
      if (isWide) setActiveApp("chat");
      else setScreen("chat");
    };
    const saveReadingHandler = (e: Event) => {
      const article = (e as CustomEvent<unknown>).detail;
      setSavedReading((prev) => [...prev, article]);
    };
    window.addEventListener("nav", navHandler);
    window.addEventListener("ai-prompt", promptHandler);
    window.addEventListener("save-reading", saveReadingHandler);
    return () => {
      window.removeEventListener("nav", navHandler);
      window.removeEventListener("ai-prompt", promptHandler);
      window.removeEventListener("save-reading", saveReadingHandler);
    };
  }, [isWide]);

  // Helper: opening chat goes to dock on wide, screen on mobile.
  const openChat = () => {
    if (isWide) setActiveApp("chat");
    else setScreen("chat");
  };

  const renderScreen = () => {
    if (screen === "portfolio") {
      return (
        <PortfolioScreen
          onOpenSettings={() => setScreen("settings")}
          onOpenModels={() => setScreen("models")}
          onOpenChat={openChat}
          onOpenImport={() => setImportOpen(true)}
        />
      );
    }
    if (screen === "markets") {
      return <MarketsScreen onOpenSettings={() => setScreen("settings")} />;
    }
    if (screen === "chat") {
      return (
        <ChatScreen
          persona="advisor"
          seedPrompt={pendingPrompt}
          onPromptConsumed={() => setPendingPrompt(null)}
        />
      );
    }
    if (screen === "journal") {
      return (
        <JournalScreen
          onOpenChat={openChat}
          onOpenModels={() => setScreen("models")}
          onOpenSettings={() => setScreen("settings")}
        />
      );
    }
    if (screen === "models") {
      return (
        <ModelPortfoliosScreen
          selectedId={selectedModelId}
          onSelect={async (id) => {
            setSelectedModelOverride(id);
            try {
              await fetch("/api/plan", {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  markdown: plan?.markdown ?? "",
                  selectedModelId: id,
                }),
              });
              invalidate("/api/plan");
            } catch (err) {
              console.error("Failed to persist selected model:", err);
            }
          }}
          onBack={() => setScreen("portfolio")}
        />
      );
    }
    if (screen === "settings") {
      return (
        <SettingsScreen
          theme={theme}
          onThemeChange={(t) => setTheme(t)}
          onBack={() => setScreen("portfolio")}
        />
      );
    }
    if (screen === "account") {
      return <AccountScreen onBack={() => setScreen("portfolio")} />;
    }
    return null;
  };

  // Modals rendered outside the layout swap so they survive mobile↔wide.
  const sharedModals = (
    <>
      <PortfolioSheet
        open={!!portfolioSheet}
        initial={
          portfolioSheet?.mode === "edit" ? portfolioToFormValues(portfolioSheet.portfolio) : null
        }
        onClose={() => setPortfolioSheet(null)}
        onSave={savePortfolio}
        onDelete={
          portfolioSheet?.mode === "edit"
            ? () => deletePortfolio(portfolioSheet.portfolio.id)
            : undefined
        }
      />
      <AddHoldingsSheet
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onAdd={(rows) => setExtraHoldings((prev) => [...prev, ...rows])}
      />
    </>
  );

  // ===== MOBILE SHELL (unchanged behaviour from original) =====
  if (!isWide) {
    const hideNav = screen === "settings" || screen === "models" || screen === "account";
    return (
      <>
        <div className="app-root">
          <div className="app-frame" data-screen-label={screen}>
            {renderScreen()}
            {!hideNav && (
              <nav className="bottom-nav">
                {MOBILE_NAV.map((item) => (
                  <button
                    key={item.id}
                    data-active={screen === item.id}
                    onClick={() => setScreen(item.id)}
                  >
                    <Icon name={item.icon} size={17} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </nav>
            )}
          </div>
        </div>
        {sharedModals}
      </>
    );
  }

  // ===== WIDE SHELL (tablet + desktop) =====
  return (
    <>
      <div
        className={`ra-shell ${viewport} ${activeApp ? "panel-open" : "panel-closed"}`}
        data-screen-label={screen}
      >
        {/* ===== Left nav rail ===== */}
        <aside className="ra-rail">
          <nav className="ra-rail-nav">
            {WIDE_NAV.map((item) => (
              <button
                key={item.id}
                className="ra-rail-item"
                data-active={screen === item.id}
                onClick={() => setScreen(item.id)}
                aria-label={item.label}
              >
                <Icon name={item.icon} size={18} />
                <span className="ra-rail-item-label">{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="ra-rail-foot">
            <button
              className="ra-rail-avatar-btn"
              onClick={() => setAccountMenuOpen((o) => !o)}
              aria-label="Account"
            >
              <span className="ra-rail-avatar">{accountInitials}</span>
              {isDesktop && (
                <div className="ra-rail-acct-text">
                  <div className="ra-rail-acct-name">{accountName}</div>
                  <div className="ra-rail-acct-sub">{accountSub}</div>
                </div>
              )}
            </button>
            {accountMenuOpen && (
              <div className="ra-account-menu" onMouseLeave={() => setAccountMenuOpen(false)}>
                <button
                  onClick={() => {
                    setAccountMenuOpen(false);
                    setScreen("settings");
                  }}
                >
                  <Icon name="settings" size={14} /> Settings
                </button>
                <button
                  onClick={() => {
                    setAccountMenuOpen(false);
                    setScreen("models");
                  }}
                >
                  <Icon name="insight" size={14} /> Templates
                </button>
                <button
                  onClick={() => {
                    setAccountMenuOpen(false);
                    setScreen("account");
                  }}
                >
                  <Icon name="user" size={14} /> Account
                </button>
                <hr />
                <button
                  onClick={async () => {
                    setAccountMenuOpen(false);
                    await authClient.signOut();
                    window.location.href = "/login";
                  }}
                >
                  <Icon name="refresh" size={14} /> Sign out
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* ===== Main content ===== */}
        <main className="ra-main">
          <div className="ra-main-inner" data-screen-label={screen}>
            {renderScreen()}
          </div>
        </main>

        {/* ===== Apps panel + backdrop =====
            Backdrop is only visible at tablet (CSS) where the panel becomes
            an overlay over main content. Clicking it dismisses the panel. */}
        {activeApp && (
          <>
            <button
              type="button"
              className="ra-panel-backdrop"
              onClick={() => setActiveApp(null)}
              aria-label="Close panel"
            />
            <section className="ra-panel">
              {activeApp === "chat" && (
                <ChatPanel
                  seedPrompt={pendingPrompt}
                  onPromptConsumed={() => setPendingPrompt(null)}
                  onClose={() => setActiveApp(null)}
                />
              )}
              {activeApp === "portfolios" && <PortfoliosPanel onClose={() => setActiveApp(null)} />}
              {activeApp === "plan" && <PlanPanel onClose={() => setActiveApp(null)} />}
              {activeApp === "notes" && <NotesPanel onClose={() => setActiveApp(null)} />}
            </section>
          </>
        )}

        {/* ===== Right apps icon rail ===== */}
        <aside className="ra-apps-rail">
          {APPS_RAIL.map((a) => (
            <button
              key={a.id}
              className="ra-apps-rail-btn"
              data-active={activeApp === a.id}
              onClick={() => setActiveApp(activeApp === a.id ? null : a.id)}
              aria-label={a.label}
            >
              <Icon name={a.icon} size={18} />
              <span className="ra-apps-rail-label">{a.label}</span>
            </button>
          ))}
        </aside>
      </div>
      {sharedModals}
    </>
  );
}
