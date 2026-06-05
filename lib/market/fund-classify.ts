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
  ["ตราสารหนี้", "bond"], // fixed income
  ["ตราสารทุน", "equity"], // equity
  ["ทรัพย์สินทางเลือก", "alternative"], // alternatives (REITs, gold, etc.)
];

/**
 * Normalized asset class from the SEC's coarse `policy_desc` label, refined by
 * the fund name.
 *
 * Money market is a distinct cash-equivalent bucket the screener filters on, but
 * the v2 `policy_desc` field has no money-market value — every money-market fund
 * is labelled `ตราสารหนี้` (fixed income), so a `cash` class derived from
 * `policy_desc` alone is empty by construction. The fund NAME reliably carries
 * `ตลาดเงิน` (money market) and nothing else does (verified: every name match is
 * otherwise a bond, zero equity/mixed false positives), so we recover `cash`
 * from the name before falling back to the policy label.
 */
export function inferAssetClass(
  policyDescTh: string | null | undefined,
  nameTh?: string | null | undefined,
): string | null {
  if (nameTh?.includes("ตลาดเงิน")) return "cash"; // money market → cash-equivalent
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

// fund_class_detail (Thai) → investor audience. Drives the screener's
// retail-default + ranking: some classes have NAV but the general public can't
// (or wouldn't) subscribe to them directly.
//   สำหรับผู้ลงทุนทั่วไป              → retail (general public)
//   ผู้ลงทุนกลุ่ม / ผู้ลงทุนพิเศษ      → restricted (provident/private/special-group)
//   ควบประกัน / กรมธรรม์ประกันชีวิต    → insurance (unit-linked policy)
//   สำหรับผู้ลงทุนสถาบัน             → institutional
// A bare/absent detail (single-class "main" funds) is retail by default.
//
// Precedence matters:
//  - **ทั่วไป (general public) wins first.** A dual-purpose class offered to the
//    general public AND via an insurance/group channel (e.g. an "RU" class) is
//    retail-buyable, so it must not be mislabeled insurance/restricted.
//  - **Insurance keys on "ควบประกัน" / "กรมธรรม์ประกันชีวิต", never bare "ประกัน"**
//    — some details say "…ไม่มีสิทธิประโยชน์ประกัน" (explicitly *without* insurance).
export function classifyInvestorType(detail: string | null | undefined): string | null {
  if (!detail) return "retail";
  if (detail.includes("ทั่วไป")) return "retail";
  if (detail.includes("ควบประกัน") || detail.includes("กรมธรรม์ประกันชีวิต")) return "insurance";
  if (detail.includes("สถาบัน")) return "institutional";
  // Provident-fund / private-fund / special-group classes: have NAV but aren't
  // sold to the general public. Kept visible in the screener but DOWN-RANKED
  // below retail (not hidden) — unlike institutional/insurance, which are hidden.
  if (detail.includes("ผู้ลงทุนกลุ่ม") || detail.includes("ผู้ลงทุนพิเศษ")) return "restricted";
  // Anything unrecognized: leave null so the screener neither hides nor mislabels.
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
