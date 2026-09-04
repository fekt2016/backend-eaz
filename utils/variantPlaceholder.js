/**
 * A distinct placeholder image per variant, so selecting one visibly changes the
 * picture on the product page.
 *
 * The detail page already prefers `variants[].images` over the product gallery
 * (ProductDetail.jsx), but a variant with an empty array falls back to the
 * product hero — so with no images at all, switching Black to Blue changes
 * nothing on screen and the picker looks broken.
 *
 * These are placeholders, not photography: colour-matched to the variant's own
 * `color` attribute where it has one, and labelled with its attribute values.
 * They exist so the mechanism is visible and demoable, and are meant to be
 * replaced with real photos through the item form.
 *
 * placehold.co is already an allowed host in next.config.mjs (remotePatterns and
 * the img-src CSP directive), and lib/shop.js placeholderToPng requests the PNG
 * variant so next/image will optimise it.
 */

// Common colour words → a hex that reads as that colour. Anything unrecognised
// falls back to the brand-neutral slate below, which is still distinct per
// variant because the label differs.
const COLOUR_HEX = {
  black: "111827", white: "f9fafb", grey: "6b7280", gray: "6b7280", silver: "c0c0c0",
  blue: "1d4ed8", navy: "1e3a8a", iceblue: "7dd3fc", lilac: "c4b5fd", purple: "7c3aed",
  red: "dc2626", pink: "ec4899", green: "16a34a", mint: "6ee7b7", gold: "d4af37",
  brown: "92400e", yellow: "eab308", orange: "f97316", titanium: "8a8d8f", natural: "b7a99a",
};

const FALLBACK_BG = "334155";

/** Pick a background from any colour-ish word in the attribute values. */
function backgroundFor(attributes = {}) {
  const values = Object.entries(attributes)
    // A key literally named colour wins; otherwise scan every value for a match.
    .sort(([a], [b]) => (/colou?r/i.test(b) ? 1 : 0) - (/colou?r/i.test(a) ? 1 : 0))
    .map(([, v]) => String(v || "").toLowerCase());

  for (const value of values) {
    for (const word of value.split(/\s+/)) {
      if (COLOUR_HEX[word]) return COLOUR_HEX[word];
    }
  }
  return FALLBACK_BG;
}

/** Dark text on a light background, light on dark — placehold.co needs both. */
function foregroundFor(bg) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(bg.slice(i, i + 2), 16));
  // Rec. 601 luma; the threshold is the usual mid-point.
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "111827" : "ffffff";
}

/** The colour value, if the variant names one. */
function colourValueOf(attributes = {}) {
  const entry = Object.entries(attributes || {}).find(([k]) => /colou?r/i.test(k));
  if (entry) return String(entry[1] || "");
  // No colour-named key: fall back to any value that reads as a colour word.
  for (const value of Object.values(attributes || {})) {
    for (const word of String(value || "").toLowerCase().split(/\s+/)) {
      if (COLOUR_HEX[word]) return String(value);
    }
  }
  return "";
}

/**
 * The caption: the colour, and nothing else.
 *
 * Captioning with every attribute ("Natural Titanium 128GB") gave each variant a
 * different picture, which is untrue — two storages of one colour look the same
 * — and it fed the storefront two different images for the size row, which then
 * tried to show a black phone beside a blue one on a row that chooses neither.
 * Colour is what a photo of a phone actually shows, and it is all that fits.
 */
function labelFor(attributes = {}) {
  const colour = colourValueOf(attributes);
  // Just the colour. The swatch is rendered at 56px on the product page, so a
  // model name on a second line is unreadable clutter — and the product's name
  // is already on the page, a few lines above the picker.
  if (colour) return colour;
  // Nothing colour-ish: fall back to the attribute values so variants of a
  // product sold by grade or capacity are still told apart.
  return Object.values(attributes || {}).map((v) => String(v)).filter(Boolean).join(" ") || "Variant";
}

/** One 800x800 placeholder for a variant. */
function variantPlaceholder(attributes = {}) {
  const bg = backgroundFor(attributes);
  const text = encodeURIComponent(labelFor(attributes));
  return `https://placehold.co/800x800/${bg}/${foregroundFor(bg)}?text=${text}`;
}

/** One for the product itself, used when it has no hero image of its own. */
function productPlaceholder(name) {
  const text = encodeURIComponent(String(name || "Product"));
  return `https://placehold.co/800x800/${FALLBACK_BG}/ffffff?text=${text}`;
}

module.exports = { variantPlaceholder, productPlaceholder, backgroundFor, labelFor, colourValueOf };
