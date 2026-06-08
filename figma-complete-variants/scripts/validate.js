// validate.js — paste into use_figma after creating variants.
// Validates matrix completeness + position uniqueness, then takes an inline
// screenshot via `await set.screenshot()` — no separate get_screenshot,
// curl, or Read calls needed.
//
// Set SET_ID to the component set's node id, or leave empty to use the current selection.
const SET_ID = '';

let set;
if (SET_ID) {
  set = await figma.getNodeByIdAsync(SET_ID);
} else {
  let node = figma.currentPage.selection[0];
  while (node && node.type !== 'COMPONENT_SET') node = node.parent;
  if (!node) return { error: 'No COMPONENT_SET found. Select a component set or one of its variants, or provide a node URL.' };
  set = node;
}
const defs = set.componentPropertyDefinitions;

const axes = Object.entries(defs)
  .filter(([, d]) => d.type === 'VARIANT')
  .map(([name, d]) => ({ name, options: d.variantOptions }));
let combos = [[]];
for (const axis of axes) combos = combos.flatMap((c) => axis.options.map((o) => [...c, [axis.name, o]]));
const allNames = combos.map((c) => c.map(([k, v]) => `${k}=${v}`).join(', '));

const names = set.children.map((c) => c.name);
const nameSet = new Set(names);
const missing = allNames.filter((n) => !nameSet.has(n));

// Position uniqueness — copy to array first (children is read-only)
const posKey = (c) =>
  set.layoutMode === 'GRID'
    ? `r${c.gridRowAnchorIndex}c${c.gridColumnAnchorIndex}`
    : `${Math.round(c.x)},${Math.round(c.y)}`;
const posCount = {};
for (const c of set.children) posCount[posKey(c)] = (posCount[posKey(c)] || 0) + 1;
const overlaps = set.children
  .filter((c) => posCount[posKey(c)] > 1)
  .map((c) => ({ name: c.name, pos: posKey(c) }));

// Inline screenshot — returned directly in the tool response.
// No separate get_screenshot / curl / Read needed.
await set.screenshot();

return {
  complete: missing.length === 0,
  missing,
  noOverlaps: overlaps.length === 0,
  overlaps,
  variantCount: names.length,
  expected: allNames.length,
};
