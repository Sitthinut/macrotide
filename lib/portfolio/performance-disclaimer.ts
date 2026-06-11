// Pure copy helper for the caveat under the Portfolio total-balance graph.
//
// The benchmark overlay is now TOTAL RETURN (the `benchmark_tr` series reinvests
// dividends), in the base currency — matched to the portfolio line for an
// accumulating portfolio. The only remaining gap is the portfolio's own
// distributing funds: their payouts LEAVE the balance, so the line slightly
// understates total return. So the disclaimer depends on:
//   - the user holds a dividend-paying fund (its payouts leave the balance), and
//   - whether a benchmark is selected (frames the gap as "vs the benchmark").
// A benchmark selected with no distributing fund means both lines are total
// return → nothing to disclaim.
//
// Returns the exact sentence for the active combination, or null when nothing
// applies. Copy is verbatim per the product spec; do not paraphrase.

export function performanceDisclaimer(
  benchmarkSelected: boolean,
  hasDividendFund: boolean,
): string | null {
  if (benchmarkSelected && hasDividendFund) {
    return "Your funds pay dividends as cash, so your line may run slightly below this total-return benchmark.";
  }
  if (hasDividendFund) {
    return "Some of your funds pay dividends as cash. Your total return is a little higher than this line shows.";
  }
  return null;
}
