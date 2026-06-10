import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import { isDemoRequest } from "@/lib/db/context";
import { brokerInstallUrl } from "@/lib/portfolio/broker-install";
import { getConnectors } from "@/lib/portfolio/connector";

// Lists every configured broker connector for the Connect-a-broker picker (so the
// UI can offer more than one). Data-only (no token, no secrets) — just each
// broker's display name, host, login/open links, and its per-connector install
// URL. 404 in a demo session; an empty array when none is configured.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const connectors = await getConnectors();

  return withDb(() => {
    if (isDemoRequest()) return NextResponse.json({ error: "not_available" }, { status: 404 });
    return NextResponse.json(
      connectors.map((c) => ({
        id: c.id,
        // The tag stamped on imported rows — lets the UI group synced accounts
        // (whose `source` is this tag) under the right broker.
        source: c.sourceTag,
        displayName: c.displayName,
        host: c.host,
        openUrl: c.openUrl ?? null,
        loginUrl: c.loginUrl ?? c.openUrl ?? null,
        installUrl: brokerInstallUrl(req),
      })),
    );
  });
}
