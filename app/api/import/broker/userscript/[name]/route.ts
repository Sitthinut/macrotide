import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import { isDemoRequest } from "@/lib/db/context";
import { getOrCreateBrokerImportToken } from "@/lib/db/queries/broker-token";
import { buildUserscript } from "@/lib/portfolio/broker-import";
import { getConnector } from "@/lib/portfolio/connector";

// Serve the install-ready userscript. The `[name]` segment only exists so the
// URL can end in `.user.js`, which is what userscript managers (Tampermonkey,
// Violentmonkey, Gear, …) intercept to show a one-click install prompt. The
// broker endpoints stay server-side (env only); the user's import token is baked
// in so the installed script can post straight to /ingest. 404 when no broker is
// configured (UI hides the panel) or in a demo session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const connector = await getConnector();
  if (!connector) return new NextResponse("// broker import not configured", { status: 404 });

  const url = new URL(req.url);
  const origin = process.env.PUBLIC_APP_URL?.trim() || url.origin;

  return withDb(() => {
    if (isDemoRequest()) return new NextResponse("// not available in demo", { status: 404 });
    const token = getOrCreateBrokerImportToken();
    const script = buildUserscript(connector, origin, token);
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
