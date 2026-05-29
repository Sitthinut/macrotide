"use client";

import "overlayscrollbars/overlayscrollbars.css";
import { useOverlayScrollbars } from "overlayscrollbars-react";
import { useEffect, useRef, useState } from "react";
import { type AddedHolding, AddHoldingsSheet } from "@/components/AddHoldingsSheet";
import {
  type AppId,
  ChatPanel,
  NotesPanel,
  PlanPanel,
  PortfoliosPanel,
} from "@/components/AppPanels";
import { FundSelectScreen } from "@/components/FundSelect";
import { Icon } from "@/components/Icon";
import { type PortfolioFormValues, PortfolioSheet } from "@/components/PortfolioSheet";
import { AccountScreen } from "@/components/screens/AccountScreen";
import { AdminScreen } from "@/components/screens/AdminScreen";
import { ChatScreen, type SeedPrompt } from "@/components/screens/ChatScreen";
import { JournalScreen } from "@/components/screens/JournalScreen";
import { MarketsScreen } from "@/components/screens/MarketsScreen";
import { ModelPortfoliosScreen } from "@/components/screens/ModelPortfoliosScreen";
import { PortfolioScreen } from "@/components/screens/PortfolioScreen";
import { SettingsScreen, type Theme } from "@/components/screens/SettingsScreen";
import { clearDemoSession } from "@/lib/auth/clear-demo";
import { authClient } from "@/lib/auth/client";
import { usePortfolioView, useSelectedModelId } from "@/lib/fetchers/legacy";
import { usePlan } from "@/lib/fetchers/portfolio";
import { invalidate, useResource } from "@/lib/fetchers/swr";
import type { Portfolio } from "@/lib/static/types";
import { setActiveId, usePortfolioUi } from "@/lib/stores/portfolio-ui";
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

type Screen =
  | "portfolio"
  | "markets"
  | "funds"
  | "chat"
  | "journal"
  | "models"
  | "settings"
  | "account"
  | "admin";

// Screen ids stay stable ("funds"/"chat") — only the visible labels changed:
// Funds → Explore (it's the catalog discovery tool, not a holdings list),
// Chat → Advisor (it's the AI investment advisor, not a generic chat).
const MOBILE_NAV: { id: Screen; icon: string; label: string }[] = [
  { id: "portfolio", icon: "home", label: "Portfolio" },
  { id: "markets", icon: "pulse", label: "Markets" },
  { id: "funds", icon: "search", label: "Explore" },
  { id: "chat", icon: "chat", label: "Advisor" },
  { id: "journal", icon: "book", label: "Journal" },
];

// Wide shell drops "chat" from the rail — chat lives in the right dock instead.
const WIDE_NAV: { id: Screen; icon: string; label: string }[] = [
  { id: "portfolio", icon: "home", label: "Portfolio" },
  { id: "markets", icon: "pulse", label: "Markets" },
  { id: "funds", icon: "search", label: "Explore" },
  { id: "journal", icon: "book", label: "Journal" },
];

const APPS_RAIL: { id: AppId; icon: string; label: string }[] = [
  { id: "chat", icon: "chat", label: "Advisor" },
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

  // OverlayScrollbars on the desktop/tablet content column. We initialize the
  // hook against the EXISTING <main className="ra-main"> element (no wrapper
  // DOM, so the CSS grid shell is untouched); OverlayScrollbars generates its
  // own scroll viewport child. This replaces the native scrollbar with a thin
  // overlay thumb that floats over the content and carves no layout space, so
  // the sticky tab bars stay flush to the docked chat panel. `.ra-main` only
  // exists in the wide shell, so we defer init until it is mounted. The mobile
  // shell keeps native window scrolling (see useScrollHide).
  const raMainRef = useRef<HTMLElement | null>(null);
  const [initOverlayScrollbars] = useOverlayScrollbars({
    defer: true,
    options: {
      scrollbars: {
        // Mimic the prior macOS-overlay feel: invisible at rest, dim thumb that
        // appears on hover and while scrolling, fading out once the pointer
        // leaves the content column.
        autoHide: "leave",
        autoHideDelay: 600,
        theme: "os-theme-ra-main",
      },
    },
  });
  useEffect(() => {
    if (isWide && raMainRef.current) {
      initOverlayScrollbars(raMainRef.current);
    }
    // useOverlayScrollbars cleans up its own instance on unmount; re-running on
    // isWide handles the wide↔mobile shell swap.
  }, [isWide, initOverlayScrollbars]);

  // Rail identity. A signed-in owner shows their real name/email; demo and
  // AUTH_DISABLED sessions have no better-auth user, so we fall back to the
  // generic "Demo user" labels.
  const accountUser = authClient.useSession().data?.user;
  // Owner gate for the Admin entry point. The /api/admin/status endpoint is the
  // single source of truth (mirrors the server-side OWNER_EMAIL check); the UI
  // only uses it to decide whether to SHOW the menu item — every admin action
  // is independently authorized server-side.
  const { data: adminStatus } = useResource<{ isOwner: boolean }>("/api/admin/status");
  const isOwner = adminStatus?.isOwner ?? false;
  const accountName = accountUser?.name?.trim() || "Demo user";
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
  const [pendingPrompt, setPendingPrompt] = useState<SeedPrompt | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [, setExtraHoldings] = useState<AddedHolding[]>([]);
  const [, setSavedReading] = useState<unknown[]>([]);
  const planSelectedModelId = useSelectedModelId();
  const { data: plan } = usePlan();
  const [selectedModelOverride, setSelectedModelOverride] = useState<string | null>(null);
  const selectedModelId = selectedModelOverride ?? planSelectedModelId ?? "bogle3";
  // Which app panel is open on the right.
  // Default behavior depends on viewport (thresholds mirror useViewport):
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
  // Create/edit intents from PortfolioScreen + PortfoliosPanel flow through the
  // shared store. App owns the sheet so it survives the mobile↔wide swap.
  const { editTarget, newNonce, consumeEditTarget } = usePortfolioUi();

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

  // Portfolio sheet intents come from the shared store (PortfolioScreen and
  // PortfoliosPanel both request through it). Open the create sheet whenever the
  // "new" nonce bumps; the initial mount value (0) is ignored via the ref below.
  const lastNewNonce = useRef(newNonce);
  useEffect(() => {
    if (newNonce === lastNewNonce.current) return;
    lastNewNonce.current = newNonce;
    setPortfolioSheet({ mode: "create" });
  }, [newNonce]);

  // Open the edit sheet for a requested id, then consume the intent so it fires
  // once. Waits for `portfolios` to resolve before clearing.
  useEffect(() => {
    if (editTarget === null) return;
    const found = portfolios?.find((p) => p.id === editTarget);
    if (!found) return;
    setPortfolioSheet({ mode: "edit", portfolio: found });
    consumeEditTarget();
  }, [editTarget, portfolios, consumeEditTarget]);

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
    // Reset the active selection if it was viewing the deleted portfolio.
    setActiveId("all");
  }

  // Cross-screen events
  useEffect(() => {
    const navHandler = (e: Event) => {
      const target = (e as CustomEvent<Screen>).detail;
      if (isWide && target === "chat") setActiveApp("chat");
      else setScreen(target);
    };
    const promptHandler = (e: Event) => {
      // detail is either a plain string (shown verbatim) or a { display, send }
      // split — the OCR handoff uses the latter to keep the raw transcription
      // out of the visible user bubble.
      setPendingPrompt((e as CustomEvent<SeedPrompt>).detail);
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

  // Mobile screens carry a top-right kebab that opens the account menu. The
  // wide shell hides it — the rail avatar holds the menu there.
  const openMobileMenu = () => setAccountMenuOpen(true);

  // Account menu contents, shared by the desktop rail dropdown and the mobile
  // sheet so the two stay in sync.
  const gotoScreen = (s: Screen) => {
    setAccountMenuOpen(false);
    setScreen(s);
  };
  const signOut = async () => {
    setAccountMenuOpen(false);
    // Clear the demo cookie too: `authClient.signOut()` only revokes the
    // better-auth session, so a demo user signing out would otherwise land
    // on /login with `macrotide_demo` intact and slide right back in.
    await clearDemoSession();
    await authClient.signOut();
    window.location.href = "/login";
  };
  const accountMenuItems = (
    <>
      <button onClick={() => gotoScreen("settings")}>
        <Icon name="settings" size={14} /> Settings
      </button>
      <button onClick={() => gotoScreen("models")}>
        <Icon name="insight" size={14} /> Templates
      </button>
      <button onClick={() => gotoScreen("account")}>
        <Icon name="user" size={14} /> Account
      </button>
      {isOwner && (
        <button onClick={() => gotoScreen("admin")}>
          <Icon name="shield" size={14} /> Admin
        </button>
      )}
      <hr />
      <button onClick={signOut}>
        <Icon name="refresh" size={14} /> Sign out
      </button>
    </>
  );

  const renderScreen = () => {
    if (screen === "portfolio") {
      return (
        <PortfolioScreen
          onOpenSettings={openMobileMenu}
          showMenu={!isWide}
          onOpenModels={() => setScreen("models")}
          onOpenChat={openChat}
          onOpenImport={() => setImportOpen(true)}
        />
      );
    }
    if (screen === "markets") {
      return <MarketsScreen onOpenSettings={openMobileMenu} showMenu={!isWide} />;
    }
    if (screen === "funds") {
      return <FundSelectScreen onOpenSettings={openMobileMenu} showMenu={!isWide} />;
    }
    if (screen === "chat") {
      return (
        <ChatScreen
          persona="advisor"
          seedPrompt={pendingPrompt}
          onPromptConsumed={() => setPendingPrompt(null)}
          onOpenMenu={() => setAccountMenuOpen(true)}
        />
      );
    }
    if (screen === "journal") {
      return (
        <JournalScreen
          onOpenChat={openChat}
          onOpenModels={() => setScreen("models")}
          onOpenSettings={openMobileMenu}
          showMenu={!isWide}
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
    if (screen === "admin") {
      // Defense in depth: even if a non-owner reaches this branch, the API
      // returns 403 and AdminScreen renders an access-denied message.
      return <AdminScreen onBack={() => setScreen("portfolio")} />;
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

  // ===== MOBILE SHELL (unchanged behavior from original) =====
  if (!isWide) {
    const hideNav =
      screen === "settings" || screen === "models" || screen === "account" || screen === "admin";
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
            {/* Account menu opens from each screen's top-right control (the
                settings gear, or the kebab on Chat) — see openMobileMenu. */}
            {accountMenuOpen && (
              <>
                <button
                  type="button"
                  className="mobile-menu-backdrop"
                  aria-label="Close menu"
                  onClick={() => setAccountMenuOpen(false)}
                />
                <div className="mobile-account-menu">{accountMenuItems}</div>
              </>
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
                </div>
              )}
            </button>
            {accountMenuOpen && (
              <div className="ra-account-menu" onMouseLeave={() => setAccountMenuOpen(false)}>
                {accountMenuItems}
              </div>
            )}
          </div>
        </aside>

        {/* ===== Main content ===== */}
        <main className="ra-main" ref={raMainRef}>
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
