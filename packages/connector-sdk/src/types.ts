// The import-format + connector-manifest types — the brand-free contract shared
// by the parser, the collector builders, and the host app.

/**
 * One normalized row in Macrotide's import format — what a broker export, a
 * screenshot OCR, or a paste all reduce to (the editable confirmation row).
 */
export interface ExtractedTxnRow {
  ticker: string;
  englishName?: string;
  /** "buy" / "sell" / "dividend" / … as printed; normalized by the host. */
  kind?: string;
  /** Trade date as printed; normalized to ISO by the host. */
  tradeDate?: string;
  units?: number;
  pricePerUnit?: number;
  /** The baht amount of the transaction (unsigned magnitude). */
  amount?: number;
  fee?: number;
  /** Stable per-order identity from a broker import — the dedup anchor. */
  externalId?: string;
  /** The broker account this row came from (account_code) — the "real structure". */
  externalAccount?: string;
}

/** One order as the broker's history/pending endpoints return it. Only the
 *  fields the parser reads are typed; the wire payload carries many more. */
export interface BrokerOrder {
  /** The broker's own stable order id — the dedup anchor. Absent → content hash. */
  ref?: string;
  order_type?: string;
  fund_name?: string;
  status?: string;
  trade_date?: string;
  net_transaction_amount?: number | null;
  net_transaction_unit?: number | null;
  unit?: number | null;
  amount?: number | null;
  sw_to_fund?: string;
  sw_in_net_transaction_amount?: number | null;
  sw_in_net_transaction_unit?: number | null;
}

/** One portfolio in a multi-account export (what the collector POSTs). */
export interface BrokerAccount {
  account_code?: string;
  name?: string;
  type?: string;
  history?: BrokerOrder[];
  pending?: BrokerOrder[];
}

/** The collector's top-level payload. */
export interface BrokerExport {
  source?: string;
  exportedAt?: string;
  /** Best-effort human identifier of the broker LOGIN (name/email), if exposed. */
  accountLabel?: string;
  accounts?: BrokerAccount[];
}

export interface BrokerImportStats {
  accounts: number;
  imported: number;
  switches: number;
  dividends: number;
  skippedCancel: number;
  skippedPending: number;
  skippedUnknown: number;
}

export interface BrokerImportResult {
  rows: ExtractedTxnRow[];
  stats: BrokerImportStats;
  warnings: string[];
}

/** The location half of a connector — where to read the broker's order data.
 *  All brand-specific; supplied by the manifest, never hardcoded. */
export interface BrokerEndpoints {
  /** Host the collector must run on (same-origin requirement). */
  host: string;
  /** Path returning the customer's portfolios. */
  planPath: string;
  /** Path returning one portfolio's order history (cursor-paginated). */
  historyPath: string;
  /** Path returning one portfolio's pending orders. */
  pendingPath: string;
  /** Free-text tag stamped on the export so the source is recorded. */
  sourceTag: string;
  /** The broker's order-history page (the UI's "Open broker" / sync link). */
  openUrl?: string;
}

/** A field name, or a list of candidates tried in order (first present wins). */
export type FieldRef = string | string[];

/**
 * Describes a broker's RESPONSE field paths so the parser/collector stay
 * broker-agnostic. Every field is optional; omitted → the built-in default
 * (so a manifest that only sets endpoints keeps working). `plan`/`history`/`pending` drive the
 * collector (client); `order`/`values` drive the parser (server).
 */
export interface ConnectorShape {
  plan?: {
    accountsPath?: string;
    accountCode?: string;
    accountName?: string;
    accountType?: string;
    labelPaths?: string[];
  };
  history?: {
    accountParam?: string;
    cursorParam?: string;
    itemsPath?: string;
    nextCursorPath?: string;
    hasNextPath?: string;
    maxPages?: number;
  };
  pending?: { accountParam?: string; itemsPath?: string };
  order?: {
    type?: FieldRef;
    ticker?: FieldRef;
    status?: FieldRef;
    tradeDate?: FieldRef;
    amount?: FieldRef;
    units?: FieldRef;
    dividendAmount?: FieldRef;
    ref?: FieldRef;
    switch?: { toTicker?: FieldRef; inAmount?: FieldRef; inUnits?: FieldRef };
  };
  values?: {
    success?: string[];
    cancel?: string[];
    pending?: string[];
    buy?: string[];
    sell?: string[];
    switch?: string[];
    dividend?: string[];
  };
}

/** A connector manifest — DATA describing one broker. */
export interface Connector extends BrokerEndpoints {
  /** Stable connector id (defaults to sourceTag). */
  id: string;
  /** Human broker name shown in the UI (e.g. "Acme Securities"). */
  displayName: string;
  /** Where to send a first-time user to log in (optional; defaults to openUrl). */
  loginUrl?: string;
  /** Response field-path map (optional; defaults to the built-in shape). */
  shape?: ConnectorShape;
}
