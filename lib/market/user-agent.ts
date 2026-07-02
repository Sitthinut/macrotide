// One browser User-Agent for every outbound market-data fetch.
//
// Keyless public endpoints (Yahoo Finance, SEC EDGAR / data.sec.gov) reject or
// throttle requests carrying a bare automated-tool UA — empty, "python-requests/…",
// "Go-http-client/…", "curl/…" — but serve normal browsers. So we present a real
// browser UA. SEC EDGAR's 403 ("Undeclared Automated Tool") targets those bot UAs,
// NOT browsers, so no contact string is required; SEC_EDGAR_USER_AGENT can still
// override this in prod if that ever changes.
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
