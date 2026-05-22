import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Macrotide · AI Investment Companion",
  description:
    "Open-source AI companion for Thai index investors. See your funds in one place and chat with an AI that knows your holdings.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Runs before React hydrates so the saved theme is applied on first paint.
// No-flash pattern used by next-themes; mutating <html> outside React avoids
// hydration mismatches.
const themeBootstrap = `(function(){try{var t=localStorage.getItem('macrotide-theme');if(t!=='light'&&t!=='dark'&&t!=='system')t='system';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','system');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: hardcoded constant, runs before hydration */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&family=IBM+Plex+Sans+Thai:wght@400;500&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
