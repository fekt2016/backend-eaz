/**
 * Escape a string so it can be used literally inside a `new RegExp(...)`,
 * e.g. for case-insensitive `$regex` search on user-supplied input.
 * Consolidated from copies previously inlined in several controllers.
 */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { escapeRegex };
