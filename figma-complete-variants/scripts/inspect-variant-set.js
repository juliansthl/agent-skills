// inspect-variant-set.js — paste into use_figma (read-only).
// Single-call replacement for the old inspect + check-matrix two-step.
// Returns: real types, variant axes, per-variant structure, missing combos,
// local text styles (for breakpoint axis swapping), and grid info.
//
// Set SET_ID to the component set's node id, or leave empty to use the current selection.
const SET_ID = '';

// Resolve the target: explicit ID or walk up from the current selection.
let setPromise;
if (SET_ID) {
  setPromise = figma.getNodeByIdAsync(SET_ID);
} else {
  let node = figma.currentPage.selection[0];
  while (node && node.type !== 'COMPONENT_SET') node = node.parent;
  if (!node) return { error: 'No COMPONENT_SET found. Select a component set or one of its variants, or provide a node URL.' };
  setPromise = Promise.resolve(node);
}

// Fetch the set and all local text styles in parallel — no reason to serialize.
const [set, textStyles] = await Promise.all([setPromise, figma.getLocalTextStylesAsync()]);

if (set.type !== 'COMPONENT_SET') {
  return { error: `Node ${set.id} is ${set.type}, not COMPONENT_SET` };
}

function describe(n, depth) {
  const o = { id: n.id, type: n.type, name: n.name };
  if ('layoutMode' in n) {
    o.layout = {
      mode: n.layoutMode,
      itemSpacing: n.itemSpacing,
      padding: [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft],
    };
  }
  if ('fills' in n && Array.isArray(n.fills)) {
    o.fills = n.fills.map((f) => ({ type: f.type, color: f.color, opacity: f.opacity, boundVariables: f.boundVariables }));
  }
  if (n.boundVariables && Object.keys(n.boundVariables).length) o.boundVariables = n.boundVariables;
  if (n.type === 'TEXT') {
    o.characters = n.characters;
    o.fontName = n.fontName;
    o.fontSize = n.fontSize;
    o.textStyleId = n.textStyleId || null; // needed for breakpoint axis swapping
  }
  if ('gridRowAnchorIndex' in n) o.grid = { r: n.gridRowAnchorIndex, col: n.gridColumnAnchorIndex };
  if ('children' in n) {
    o.children = depth > 0 ? n.children.map((c) => describe(c, depth - 1)) : n.children.length;
  }
  return o;
}

// Matrix computation (merged from check-matrix.js)
const defs = set.componentPropertyDefinitions;
const axes = Object.entries(defs)
  .filter(([, d]) => d.type === 'VARIANT')
  .map(([name, d]) => ({ name, options: d.variantOptions }));
let combos = [[]];
for (const axis of axes) combos = combos.flatMap((c) => axis.options.map((o) => [...c, [axis.name, o]]));
const allNames = combos.map((c) => c.map(([k, v]) => `${k}=${v}`).join(', '));
const nameSet = new Set(set.children.map((c) => c.name));
const missing = allNames.filter((n) => !nameSet.has(n));
const seen = {};
const duplicates = [...new Set(
  set.children.map((c) => c.name).filter((n) => (seen[n] = (seen[n] || 0) + 1) > 1)
)];

return {
  // Set-level metadata
  setType: set.type,
  name: set.name,
  layoutMode: set.layoutMode,
  grid: set.layoutMode === 'GRID'
    ? { rows: set.gridRowCount, cols: set.gridColumnCount }
    : null,
  width: set.width,
  height: set.height,
  // Variant axes + options
  propertyDefinitions: defs,
  // Matrix gaps
  variantCount: set.children.length,
  expected: allNames.length,
  missing,
  duplicates,
  // Deep per-variant structure (child order, fills, bound variables, text styles)
  variants: set.children.map((v) => describe(v, 4)),
  // Local text styles — use to build Mobile→Desktop style ID map for breakpoint axis
  textStyles: textStyles.map((s) => ({ id: s.id, name: s.name, fontSize: s.fontSize, fontName: s.fontName })),
};
