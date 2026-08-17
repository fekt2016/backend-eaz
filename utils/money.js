/**
 * Money helpers. Money is stored throughout EazWorld as integer minor units
 * (pesewas): GH₵1.00 === 100. Never store floats. Convert only at the edges.
 */

/** GH₵ amount (float, e.g. 12.5) → integer pesewas (1250). Rounds to nearest pesewa. */
function toPesewas(ghs) {
  return Math.round(Number(ghs || 0) * 100);
}

/** Integer pesewas (1250) → GH₵ amount as a number (12.5). */
function fromPesewas(pesewas) {
  return Number(pesewas || 0) / 100;
}

/** Integer pesewas → display string, e.g. `GH₵1,250.00`. */
function formatGhs(pesewas) {
  const amount = fromPesewas(pesewas);
  return `GH₵${amount.toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

module.exports = { toPesewas, fromPesewas, formatGhs };
