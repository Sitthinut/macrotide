"use client";

import dynamic from "next/dynamic";

// The App reads window.innerWidth and switches between mobile / tablet / desktop
// shells. Skipping SSR keeps the viewport hook and SVG gradient ids simple and
// eliminates hydration-mismatch risk for a personal client app where SEO
// doesn't matter. ssr: false is only permitted inside a Client Component.
const App = dynamic(() => import("@/components/App").then((m) => m.App), {
  ssr: false,
});

export default function ClientApp({ isDemo }: { isDemo: boolean }) {
  return <App isDemo={isDemo} />;
}
