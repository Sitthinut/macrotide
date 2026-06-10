import "server-only";

// The `.user.js` filename the userscript install URL ends in. The serving route
// (`/api/import/broker/userscript/[name]`) ignores the name — it only has to end
// in `.user.js` so a userscript manager offers a one-click install. Centralized so
// the install wizard (token route) and the loader's runtime config (`/runtime`)
// agree on one URL.
export const USERSCRIPT_FILE = "macrotide-connector.user.js";

/**
 * Absolute install URL for the ONE global userscript, derived from the request
 * origin. A single install covers every configured broker — the script @matches
 * all their hosts and resolves the connector at run time from the page hostname.
 */
export function brokerInstallUrl(req: Request): string {
  const origin = process.env.PUBLIC_APP_URL?.trim() || new URL(req.url).origin;
  return `${origin}/api/import/broker/userscript/${USERSCRIPT_FILE}`;
}
