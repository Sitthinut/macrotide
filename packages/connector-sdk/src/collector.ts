// The collector that runs IN the broker tab (same-origin, with the user's
// cookies), and the userscript loader that delivers it (one-click install, posts
// straight to the authenticated ingest endpoint). Authored as placeholder strings
// so the emitted code is stable and the broker specifics are injected at run time,
// never hardcoded.
//
// The gather is SHAPE-DRIVEN: every field path it reads (account list, account
// id/name, history items + cursor, pending items, login label) comes from the
// connector's `shape.plan/history/pending`, fetched at run time and read via an
// emitted `getPath` helper — so a new broker is a manifest, not new code. Omitted
// shape parts fall back to the built-in defaults, so a manifest that only sets
// endpoints (no `shape`) keeps working.

import type { BrokerEndpoints, ConnectorShape } from "./types";

// The gather-logic contract version baked into each installed userscript loader.
// The loader fetches its broker config (endpoints + shape) from the app at run
// time, so endpoint/shape changes need no reinstall — but the gather ALGORITHM
// itself lives in the installed loader. Bump this ONLY when that algorithm changes
// in a way that needs a reinstall; the runtime endpoint reports the current value
// and the loader nudges the user to reinstall when its baked version is older.
// v2: outcome-driven retries — throttle only after a successful sync, and retry
// transient failures in-page with backoff (so a not-logged-in attempt no longer
// blocks the post-login sync for 5 minutes).
export const COLLECTOR_PROTOCOL_VERSION = 2;

// The collector-side default response shape (the reference broker the defaults
// were modeled on). The parser owns its own order/value defaults; these are only
// the bits the gather (client) reads.
const DEFAULT_COLLECTOR_SHAPE = {
  plan: {
    accountsPath: "data.accounts",
    accountCode: "agent_account_id",
    accountName: "plan_name",
    accountType: "plan_type",
    labelPaths: [
      "data.customer_name",
      "data.full_name",
      "data.name",
      "data.email",
      "data.customer.name",
      "data.customer.full_name",
      "data.customer.email",
    ],
  },
  history: {
    accountParam: "account_code",
    cursorParam: "current_cursor",
    itemsPath: "data",
    nextCursorPath: "pagination.next_cursor",
    hasNextPath: "pagination.has_next",
    maxPages: 200,
  },
  pending: { accountParam: "account_code", itemsPath: "data" },
};

/**
 * Merge the connector's plan/history/pending over the built-in defaults into the
 * complete collector shape the loader reads at run time. Exported so the app's
 * `/runtime` endpoint can hand the loader a fully-resolved shape (no gaps).
 */
export function resolveCollectorShape(shape?: ConnectorShape) {
  return {
    plan: { ...DEFAULT_COLLECTOR_SHAPE.plan, ...shape?.plan },
    history: { ...DEFAULT_COLLECTOR_SHAPE.history, ...shape?.history },
    pending: { ...DEFAULT_COLLECTOR_SHAPE.pending, ...shape?.pending },
  };
}

// Dot-path getter used by the gather to read shape-mapped fields off a response.
const COLLECTOR_GETPATH = `var GP=function(o,p){if(p==null)return undefined;var k=(""+p).split("."),i=0;for(;i<k.length&&o!=null;i++)o=o[k[i]];return o};`;

// Macrotide-branded notification cards shown ON the broker page — iOS/Android
// notification style: app icon, "Macrotide Connector" title, body below. Cards
// stack in one fixed, centered container so concurrent ones never overlap.
// `toast(m,bad)` auto-dismisses; `nudge(url)` is a persistent card with an Update
// (→ install URL) + Dismiss action. Message via textContent (no HTML injection);
// the mark mirrors components/BrandMark.tsx (ink square + teal wave).
const COLLECTOR_TOAST = `var MTMARK='<svg width="30" height="30" viewBox="0 0 22 22" style="display:block;flex-shrink:0"><rect width="22" height="22" rx="6" fill="#0a0a0b"></rect><path d="M 0 11 Q 5.5 5 11 11 T 22 11 L 22 16 A 6 6 0 0 1 16 22 L 6 22 A 6 6 0 0 1 0 16 Z" fill="#0aa694"></path></svg>';
  function card(sticky){var W=document.getElementById("__mt_toasts__");if(!W){W=document.createElement("div");W.id="__mt_toasts__";W.style.cssText="position:fixed;z-index:2147483647;left:50%;top:20px;transform:translateX(-50%);display:flex;flex-direction:column;gap:10px;align-items:center;max-width:92vw;pointer-events:none";document.body.appendChild(W)}var d=document.createElement("div");d.style.cssText="display:flex;gap:11px;align-items:flex-start;width:340px;max-width:92vw;box-sizing:border-box;padding:12px 14px;border-radius:16px;background:#fff;color:#0a0a0b;font:13px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.18);border:1px solid #e6e7ea";if(sticky)d.style.pointerEvents="auto";var ic=document.createElement("div");ic.style.cssText="flex-shrink:0;margin-top:4px";ic.innerHTML=MTMARK;var col=document.createElement("div");col.style.cssText="display:flex;flex-direction:column;gap:3px;min-width:0";var ti=document.createElement("div");ti.textContent="Macrotide Connector";ti.style.cssText="font-weight:700;font-size:13px;letter-spacing:-.01em";col.appendChild(ti);d.appendChild(ic);d.appendChild(col);W.appendChild(d);function close(){d.remove();if(!W.children.length)W.remove()}return{d:d,col:col,close:close}}
  function toast(m,bad){var k=card(false);var bo=document.createElement("div");bo.textContent=m;bo.style.cssText="font-size:12.5px;line-height:1.45;color:"+(bad?"#b00020":"#3a3d43");k.col.appendChild(bo);setTimeout(k.close,6000);return k.d}
  function nudge(url){var k=card(true);var bo=document.createElement("div");bo.textContent="A newer version is available. Update it here, or from Settings → Connections.";bo.style.cssText="font-size:12.5px;line-height:1.45;color:#3a3d43";k.col.appendChild(bo);var ac=document.createElement("div");ac.style.cssText="display:flex;gap:8px;margin-top:9px;align-items:center";var u=document.createElement("button");u.type="button";u.textContent="Update";u.style.cssText="border:0;border-radius:6px;background:#0a0a0b;color:#f8f8f9;font:500 12.5px system-ui;padding:7px 12px;cursor:pointer";u.onclick=function(){try{window.open(url,"_blank")}catch(e){}};var x=document.createElement("button");x.type="button";x.textContent="Dismiss";x.style.cssText="border:0;border-radius:9px;background:transparent;color:#5f6368;font:600 12px system-ui;padding:7px 11px;cursor:pointer";x.onclick=k.close;ac.appendChild(u);ac.appendChild(x);k.col.appendChild(ac)}`;

// JSON fetch that rides the page's own cookies.
const COLLECTOR_FETCH = `var J=function(u){return fetch(u,{credentials:"include",headers:{"Content-Type":"application/json"}}).then(function(r){return r.json()})};`;

// The gather: list portfolios, paginate every history + pending list, build the
// export object. Every broker-specific field path is read from SH (the injected
// shape) via GP. Assumes H/PLAN/HIST/PEND/SRC/SH, GP(), toast() and J() in scope.
const COLLECTOR_GATHER = `if(location.hostname!==H){toast("Open "+H+" (your orders page), then run this again.",true);return "host"}
  var busy=toast("Collecting your history…");
  var PL=SH.plan,HS=SH.history,PD=SH.pending;
  var plan=await J(PLAN);
  var LABEL="";for(var li=0;li<PL.labelPaths.length;li++){var lv=GP(plan,PL.labelPaths[li]);if(lv){LABEL=""+lv;break}}
  var accts=(GP(plan,PL.accountsPath)||[]).map(function(a){return{account_code:GP(a,PL.accountCode),name:GP(a,PL.accountName),type:GP(a,PL.accountType)}});
  if(!accts.length){busy.remove();toast("Log in to your broker and it'll sync automatically.",true);return "noauth"}
  for(var i=0;i<accts.length;i++){
    var a=accts[i],cur=null,hist=[],g=0;
    do{var u=HIST+"?"+HS.accountParam+"="+a.account_code+(cur?("&"+HS.cursorParam+"="+cur):"");var j=await J(u);hist=hist.concat(GP(j,HS.itemsPath)||[]);cur=GP(j,HS.hasNextPath)?GP(j,HS.nextCursorPath):null;g++}while(cur&&g<HS.maxPages);
    var pj=await J(PEND+"?"+PD.accountParam+"="+a.account_code);
    a.history=hist;a.pending=GP(pj,PD.itemsPath)||[]
  }
  var n=accts.reduce(function(s,a){return s+a.history.length},0);
  var payload={source:SRC,exportedAt:new Date().toISOString(),accountLabel:LABEL,accounts:accts};`;

// Userscript wrapper — a THIN, SELF-UPDATING LOADER. Bakes only the app origin,
// the per-user token, and this loader's protocol version. On each broker page load
// it fetches the live broker config (endpoints + resolved shape + the current
// protocol version) from the app over GM_xmlhttpRequest (token in a header, never
// a URL), caching the last-good config so a brief app outage still syncs.
// Endpoint/shape changes apply with no reinstall; a bump of the gather ALGORITHM
// (COLLECTOR_PROTOCOL_VERSION) nudges a reinstall.
//
// Retries are OUTCOME-DRIVEN, so a failure never causes a long dead zone:
//   • The 5-min throttle is stamped ONLY after a successful sync — so a
//     not-logged-in attempt leaves no throttle, and the next page load (right
//     after you log in and get redirected) syncs immediately.
//   • Transient errors (broker API / app unreachable) retry in-page with jittered
//     exponential backoff, then stop and let the next page load try.
//   • A short attempt-dedupe collapses rapid in-site navigations (and the toast).
const USERSCRIPT_TEMPLATE = `(function(){
  ${COLLECTOR_GETPATH}
  var T=__TOKEN__,O=__ORIGIN__,LV=__LOADER_VERSION__,SKEY="__macrotide_last_sync__",AKEY="__macrotide_last_try__",NKEY="__macrotide_nag__",CFGKEY="__macrotide_cfg__",MIN=300000,DEDUPE=4000,NAGMIN=86400000;
  ${COLLECTOR_TOAST}
  ${COLLECTOR_FETCH}
  function cfg(){return new Promise(function(res,rej){try{GM_xmlhttpRequest({method:"GET",url:O+"/api/import/broker/runtime",headers:{"X-Import-Token":T},onload:function(r){if(r.status>=200&&r.status<300){try{res(JSON.parse(r.responseText))}catch(e){rej(e)}}else rej(new Error("status "+r.status))},onerror:function(){rej(new Error("network"))},ontimeout:function(){rej(new Error("timeout"))}})}catch(e){rej(e)}})}
  function send(s){return new Promise(function(res){try{GM_xmlhttpRequest({method:"POST",url:O+"/api/import/broker/ingest",headers:{"Content-Type":"application/json","X-Import-Token":T},data:s,onload:function(r){res(r.status>=200&&r.status<300)},onerror:function(){res(false)},ontimeout:function(){res(false)}})}catch(e){res(false)}})}
  // One collection attempt against resolved config C. Returns an outcome:
  //   "ok" | "noauth" (not logged in) | "host" (wrong page) | "transient" (retry).
  async function attempt(C){
    try{
      var H=C.host,PLAN=C.planPath,HIST=C.historyPath,PEND=C.pendingPath,SRC=C.source,SH=C.shape;
      ${COLLECTOR_GATHER}
      var ok=await send(JSON.stringify(payload));
      busy.remove();
      if(ok){toast("Synced "+n+" orders ✓");return "ok"}
      return "transient"
    }catch(e){
      try{busy&&busy.remove()}catch(_){}
      return "transient"
    }
  }
  async function start(){
    var C;
    try{C=await cfg();try{localStorage.setItem(CFGKEY,JSON.stringify(C))}catch(e){}}
    catch(e){try{C=JSON.parse(localStorage.getItem(CFGKEY)||"null")}catch(e2){C=null}}
    if(!C){toast("Open Macrotide once to finish connecting your broker.",true);return}
    if(C.collectorVersion>LV){try{var ng=(localStorage.getItem(NKEY)||"").split("|");if(ng[0]!==(""+C.collectorVersion)||Date.now()-(+ng[1]||0)>NAGMIN){localStorage.setItem(NKEY,C.collectorVersion+"|"+Date.now());nudge(C.installUrl||O)}}catch(e){nudge(C.installUrl||O)}}
    var BACKOFF=[3000,8000,20000];
    var drive=async function(i){
      var r=await attempt(C);
      if(r==="ok"){try{localStorage.setItem(SKEY,""+Date.now())}catch(e){}return}
      if(r==="transient"&&i<BACKOFF.length){var d=Math.round(BACKOFF[i]*(0.8+0.4*Math.random()));setTimeout(function(){drive(i+1)},d);return}
      if(r==="transient")toast("Couldn't reach Macrotide. Reopen this page to retry.",true)
    };
    drive(0);
  }
  try{
    var ls=+(localStorage.getItem(SKEY)||0);if(Date.now()-ls<MIN)return;
    var la=+(localStorage.getItem(AKEY)||0);if(Date.now()-la<DEDUPE)return;
    localStorage.setItem(AKEY,""+Date.now());
  }catch(e){}
  start();
})();`;

/**
 * Build a userscript (the `// ==UserScript==` text a manager installs from a
 * `.user.js` URL). A thin self-updating loader: only the app `macrotideOrigin`,
 * the per-user `token`, and this loader's protocol version are baked in; the
 * broker endpoints + shape are fetched from the app at run time (so they need no
 * reinstall to change). The host is still baked into the `@match` line. Returns
 * the full script text.
 */
export function buildUserscript(
  endpoints: BrokerEndpoints,
  macrotideOrigin: string,
  token: string,
): string {
  const body = USERSCRIPT_TEMPLATE.replace("__TOKEN__", JSON.stringify(token))
    .replace("__ORIGIN__", JSON.stringify(macrotideOrigin))
    .replace("__LOADER_VERSION__", JSON.stringify(COLLECTOR_PROTOCOL_VERSION));
  let connectHost = macrotideOrigin;
  try {
    connectHost = new URL(macrotideOrigin).hostname;
  } catch {
    // leave as-is if origin isn't a full URL (e.g. empty in tests)
  }
  const header = [
    "// ==UserScript==",
    "// @name         Macrotide Connector",
    "// @namespace    macrotide",
    "// @version      1.0.0",
    "// @description  Sync your broker order history into Macrotide automatically",
    `// @match        https://${endpoints.host}/*`,
    `// @connect      ${connectHost}`,
    "// @grant        GM_xmlhttpRequest",
    "// @run-at       document-idle",
    "// ==/UserScript==",
    "",
  ].join("\n");
  return header + body;
}
