// Broker order-history import — moved to the brand-free @macrotide/connector-sdk
// package. This module is a thin re-export so existing imports
// (`@/lib/portfolio/broker-import`) keep working; new code should import from
// `@macrotide/connector-sdk` directly.

export type {
  BrokerAccount,
  BrokerEndpoints,
  BrokerExport,
  BrokerImportResult,
  BrokerImportStats,
  BrokerOrder,
  ExtractedTxnRow,
} from "@macrotide/connector-sdk";
export {
  buildUserscript,
  looksLikeBrokerExport,
  parseBrokerExport,
} from "@macrotide/connector-sdk";
