import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import { isDemoRequest } from "@/lib/db/context";
import { getOrCreateBrokerImportToken } from "@/lib/db/queries/broker-token";
import { buildUserscript } from "@/lib/portfolio/broker-import";
import { getConnectors } from "@/lib/portfolio/connector";

// Serve the install-ready userscript. The `[name]` segment only exists so the
// URL can end in `.user.js`, which is what userscript managers (Tampermonkey,
// Violentmonkey, Gear, …) intercept to show a one-click install prompt. The
// broker endpoints stay server-side (env only); the user's import token is baked
// in so the installed script can post straight to /ingest. 404 when no broker is
// configured (UI hides the panel) or in a demo session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  // ONE global script for every configured broker — it @matches all their hosts
  // and resolves which connector applies at run time from the page's hostname.
  const connectors = await getConnectors();
  if (connectors.length === 0)
    return new NextResponse("// broker import not configured", { status: 404 });

  const origin = process.env.PUBLIC_APP_URL?.trim() || url.origin;

  return withDb(() => {
    if (isDemoRequest()) return new NextResponse("// not available in demo", { status: 404 });
    const token = getOrCreateBrokerImportToken();
    const script = buildUserscript(connectors, origin, token);
    return new NextResponse(script, {
      status: 200,
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        // Token is embedded; never let a shared cache hold a per-user script.
        "Cache-Control": "no-store",
      },
    });
  });
}
