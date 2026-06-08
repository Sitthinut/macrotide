import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import { isDemoRequest } from "@/lib/db/context";
import {
  getOrCreateBrokerImportToken,
  rotateBrokerImportToken,
} from "@/lib/db/queries/broker-token";
import { getSetting } from "@/lib/db/queries/settings";
import { brokerInstallUrl } from "@/lib/portfolio/broker-install";
import { getConnector } from "@/lib/portfolio/connector";

// The per-user broker import token + everything the import UI needs to render:
// the broker display name, the userscript install URL, the broker's order-history
// URL (for "open / sync"), and the first-time login URL. GET mints the token on
// first use; POST rotates it (invalidating any installed userscript). 404 when no
// broker is configured (UI hides the panel) or in a demo session.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const connector = await getConnector();
  if (!connector) return NextResponse.json({ error: "not_configured" }, { status: 404 });

  const installUrl = brokerInstallUrl(req);

  return withDb(() => {
    if (isDemoRequest()) return NextResponse.json({ error: "not_available" }, { status: 404 });
    return NextResponse.json({
      token: getOrCreateBrokerImportToken(),
      displayName: connector.displayName,
      accountLabel: getSetting<string>(`broker_login_label:${connector.sourceTag}`) ?? null,
      installUrl,
      openUrl: connector.openUrl ?? null,
      loginUrl: connector.loginUrl ?? connector.openUrl ?? null,
    });
  });
}

export function POST() {
  return withDb(() => {
    if (isDemoRequest()) return NextResponse.json({ error: "not_available" }, { status: 404 });
    return NextResponse.json({ token: rotateBrokerImportToken() });
  });
}
