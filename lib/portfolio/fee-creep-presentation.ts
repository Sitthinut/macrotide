// Pure presentation logic for the Portfolio fee-check list (#74 §5). With ~10
// findings a flat amber wall is its own alert-fatigue surface, so we lead with a
// calm summary, show the top few in priority order, and tuck the rest behind a
// "N more" expander. No clock, no DB, no React — just ordering + slicing, so the
// screen and the tests share one source of truth.

export interface FeeCheckLike {
  /** The held fund's ticker — the stable identity for ordering ties. */
  heldTicker: string;
  /** Annual saving of the cheapest comparable alternative (pp/yr). Higher = worse. */
  savingsPp: number;
}

/** How many findings render as full cards before the "N more" expander. */
export const FEE_CHECK_TOP_N = 3;

/**
 * Order findings by severity — biggest annual saving (most wasted fee) first.
 * Ties break on ticker so the order is stable across renders. Pure; returns a
 * new array.
 */
export function orderFeeChecks<T extends FeeCheckLike>(findings: readonly T[]): T[] {
  return [...findings].sort((a, b) => {
    if (b.savingsPp !== a.savingsPp) return b.savingsPp - a.savingsPp;
    return a.heldTicker.localeCompare(b.heldTicker);
  });
}

export interface FeeCheckPresentation<T extends FeeCheckLike> {
  /** Severity-ordered findings shown as full cards (up to `topN`). */
  top: T[];
  /** The lower-severity tail, default-collapsed behind a "N more" expander. */
  rest: T[];
  /** Count of the collapsed tail (`rest.length`) — the "N more" number. */
  moreCount: number;
  /**
   * A calm, no-deadline one-line summary. Empty string when there are no
   * findings (the caller renders nothing). Singular/plural aware.
   */
  summary: string;
}

/**
 * Split severity-ordered findings into a top-N head + collapsed tail and build
 * the calm summary line. The tone is deliberately no-nag — a passive investor
 * has no deadline on a fee flag, so the copy says "review when you have time",
 * never "N to-dos".
 */
export function presentFeeChecks<T extends FeeCheckLike>(
  findings: readonly T[],
  topN: number = FEE_CHECK_TOP_N,
): FeeCheckPresentation<T> {
  const ordered = orderFeeChecks(findings);
  const top = ordered.slice(0, Math.max(0, topN));
  const rest = ordered.slice(Math.max(0, topN));
  return {
    top,
    rest,
    moreCount: rest.length,
    summary: feeCheckSummary(ordered.length),
  };
}

/** The calm one-line summary for `n` fee checks. Empty when there are none. */
export function feeCheckSummary(n: number): string {
  if (n <= 0) return "";
  if (n === 1) {
    return "One fund has a cheaper equivalent — review when you have time.";
  }
  return `${n} funds have cheaper equivalents — review when you have time.`;
}
