// Classification of raw SEC fund-profile fields into the catalog's normalized
// columns. This is the shared contract between the ingestion job (which maps
// each `/v2/fund/general-info/profiles` row through these helpers) and the
// catalog schema.
//
// IMPORTANT: the v2 profiles endpoint does NOT return `fund_type_en`/`fund_type_th`
// (they 404 / are absent). Asset class is derived from `policy_desc` (a short
// Thai asset-type label) instead. See the data-inventory findings.

/** Raw SEC `fund_status` values, and the rule for "currently offered". */
export const ACTIVE_SEC_STATUSES = ["Registered", "IPO"] as const;

export function statusFromSec(secStatus: string | null | undefined): "active" | "inactive" {
  return secStatus && (ACTIVE_SEC_STATUSES as readonly string[]).includes(secStatus)
    ? "active"
    : "inactive";
}

/**
 * Whether to spend an API call fetching this fund's fees. Only `Registered`
 * funds have meaningful fee data: inactive funds are dead, and `IPO` funds
 * return truncated/unparseable fee JSON until they transition to Registered.
 */
export function shouldFetchFees(secStatus: string | null | undefined): boolean {
  return secStatus === "Registered";
}

/** Index/passive funds are the `PN` (and `PM`) management styles. */
export function isIndexStyle(managementStyle: string | null | undefined): boolean {
  return managementStyle === "PN" || managementStyle === "PM";
}

// policy_desc (Thai short label) → normalized asset class. `ผสม` (mixed) and
// anything unrecognized stay NULL so allocation math doesn't bucket a balanced
// fund into one class. Matched by substring to tolerate trailing qualifiers.
const ASSET_CLASS_BY_POLICY: ReadonlyArray<readonly [string, string]> = [
  ["ตลาดเงิน", "cash"], // money market — check before ตราสารหนี้
  ["ตราสารหนี้", "bond"], // fixed income
  ["ตราสารทุน", "equity"], // equity
  ["ทรัพย์สินทางเลือก", "alternative"], // alternatives (REITs, gold, etc.)
];

export function inferAssetClass(policyDescTh: string | null | undefined): string | null {
  if (!policyDescTh) return null;
  for (const [needle, cls] of ASSET_CLASS_BY_POLICY) {
    if (policyDescTh.includes(needle)) return cls;
  }
  return null; // ผสม (mixed) and unknowns
}

// fund_class_tax_incentive_type (Thai) → wrapper code.
const TAX_INCENTIVE_BY_LABEL: ReadonlyArray<readonly [string, string]> = [
  ["เพื่อการออม", "SSF"], // กองทุนรวมเพื่อการออม
  ["ไทยเพื่อความยั่งยืน", "ThaiESG"], // กองทุนรวมไทยเพื่อความยั่งยืน
  ["เพื่อการเลี้ยงชีพ", "RMF"], // กองทุนรวมเพื่อการเลี้ยงชีพ
];

export function classifyTaxIncentive(label: string | null | undefined): string | null {
  if (!label) return null;
  for (const [needle, code] of TAX_INCENTIVE_BY_LABEL) {
    if (label.includes(needle)) return code;
  }
  return null;
}

// fund_class_detail (Thai) → distribution policy.
export function classifyDistribution(detail: string | null | undefined): string | null {
  if (!detail) return null;
  if (detail.includes("จ่ายเงินปันผล")) return "dividend";
  if (detail.includes("สะสมมูลค่า")) return "accumulating";
  return null;
}

// invest_country_flag → geographic mandate.
export function classifyInvestRegion(flag: string | null | undefined): string | null {
  switch (flag) {
    case "1":
      return "foreign";
    case "3":
      return "mixed";
    case "4":
      return "domestic";
    default:
      return null;
  }
}
