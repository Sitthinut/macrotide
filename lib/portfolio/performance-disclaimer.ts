// Pure copy helper for the caveat under the Portfolio total-balance graph.
//
// The portfolio line and (optional) benchmark overlay both plot PRICE return,
// not total return — neither reinvests dividends. So the disclaimer's wording
// depends on which of the two sources actually drops dividends:
//   - a benchmark is selected (the index series excludes dividends), and/or
//   - the user holds a dividend-paying fund (its payouts leave the balance).
//
// Returns the exact sentence for the active combination, or null when neither
// applies (nothing to disclaim → render nothing). Copy is verbatim per the
// product spec; do not paraphrase.

export function performanceDisclaimer(
  benchmarkSelected: boolean,
  hasDividendFund: boolean,
): string | null {
  if (benchmarkSelected && hasDividendFund) {
    return "Dividends are excluded from both the benchmark and your dividend-paying funds, so actual returns are slightly higher than the lines shown.";
  }
  if (benchmarkSelected) {
    return "The benchmark excludes dividends, so the index's real return is slightly higher than the line shown.";
  }
  if (hasDividendFund) {
    return "Your balance does not include dividends paid out by dividend-paying funds, so your actual total return is slightly higher.";
  }
  return null;
}
