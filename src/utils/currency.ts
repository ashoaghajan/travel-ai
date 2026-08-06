const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** "$2,248" — estimates are whole dollars in Stage 1. */
export function formatCurrency(amount: number): string {
  return USD.format(Math.round(amount));
}

/**
 * "$363" / "$181.50" — cents only when there are any.
 *
 * For a unit price that a total is built from, where rounding would stop the
 * arithmetic making sense: half of a $363 fare is $181.50, and showing it as
 * $182 leaves a reader multiplying by two and getting $364.
 */
export function formatMoney(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}
