// Pure share-class selection helpers — no DB/network, safe to unit-test and to
// import on either side. A fund (parent) has one or more priceable share
// classes; these pick a sensible default when the caller didn't specify one.

export interface ClassLike {
  ticker: string;
  className: string;
  investorType: string | null;
  distributionPolicy: string | null;
}

/**
 * The default class to show when none is specified (decision D6). Per-class AUM
 * isn't pre-cached, so we approximate "flagship" with a retail-first heuristic:
 * prefer retail classes, then the one whose ticker is the parent abbr (usually
 * the primary/oldest class), then an accumulating class, else the first. Callers
 * that DO know the intended class (a click from the screener/search) pass it
 * directly and skip this.
 */
export function pickDefaultClass<T extends ClassLike>(
  classes: T[],
  abbr?: string | null,
): T | undefined {
  if (classes.length === 0) return undefined;
  const retail = classes.filter((c) => c.investorType === "retail");
  const pool = retail.length > 0 ? retail : classes;
  return (
    (abbr ? pool.find((c) => c.ticker === abbr) : undefined) ??
    pool.find((c) => c.distributionPolicy === "accumulating") ??
    pool[0]
  );
}
