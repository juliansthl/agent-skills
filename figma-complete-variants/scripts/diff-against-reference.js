// diff-against-reference.js — paste into use_figma (read-only).
// Compares all layout-related bound variables between an existing reference variant
// and one or more new variants, reporting three categories of mismatch:
//   - wrong token  : node has a binding, but to a different variable than reference
//   - missing token: reference has a binding, new variant has none
//   - sizing diff  : layoutSizingHorizontal / layoutSizingVertical differs
//
// Run this after all instance swaps are complete to catch any remaining
// Frame-level overrides (spacing tokens, sizing) that swapComponent doesn't fix.
//
// Set REF_ID to an existing hand-authored variant of the target breakpoint.
// Set NEW_IDS to the newly-created variant IDs to audit.

const REF_ID  = 'REPLACE_WITH_REFERENCE_ID';
const NEW_IDS = ['REPLACE_WITH_NEW_VARIANT_ID'];

// All spacing/layout properties that carry variable bindings.
// Includes GRID-specific keys — layout="GRID" nodes have gridRowGap + gridColumnGap
// in addition to itemSpacing. Checking only itemSpacing misses those two.
const LAYOUT_KEYS = [
  'itemSpacing', 'counterAxisSpacing',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'gridRowGap', 'gridColumnGap',
  'width', 'height',
];

function collectNodes(node, out = []) {
  const entry = { name: node.name, type: node.type };
  let hasData = false;

  // Bound variables on layout properties
  if (node.boundVariables) {
    const bv = {};
    for (const k of LAYOUT_KEYS) {
      const v = node.boundVariables[k];
      if (v) { bv[k] = Array.isArray(v) ? v.map(x => x?.id) : v?.id; hasData = true; }
    }
    if (hasData) entry.bv = bv;
  }

  // Sizing mode (only on nodes that support it)
  if ('layoutSizingHorizontal' in node) {
    entry.sizingH = node.layoutSizingHorizontal;
    entry.sizingV = node.layoutSizingVertical;
    hasData = true;
  }

  // Visibility — hidden slots/frames in the reference must be replicated.
  // Cloning from a different breakpoint won't carry over intentional hide/show.
  if ('visible' in node) {
    entry.visible = node.visible;
    hasData = true;
  }

  if (hasData) out.push(entry);
  if ('children' in node) node.children.forEach(c => collectNodes(c, out));
  return out;
}

function buildIndex(nodes) {
  const map = new Map();
  for (const n of nodes) {
    const key = `${n.type}::${n.name}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(n);
  }
  return map;
}

const ref = await figma.getNodeByIdAsync(REF_ID);
const refNodes = collectNodes(ref);
const refIndex = buildIndex(refNodes);

const results = {};

for (const newId of NEW_IDS) {
  const newNode = await figma.getNodeByIdAsync(newId);
  const newNodes = collectNodes(newNode);
  const newIndex = buildIndex(newNodes);

  const wrongToken    = [];
  const missingToken  = [];
  const sizingDiffs   = [];
  const visibilityDiffs = [];

  for (const [key, refItems] of refIndex) {
    const newItems = newIndex.get(key) || [];

    for (let i = 0; i < refItems.length; i++) {
      const r = refItems[i];
      const n = newItems[i]; // positional match within same name+type

      if (!n) continue;

      // Bound variable diffs
      if (r.bv || n.bv) {
        const allKeys = new Set([...Object.keys(r.bv || {}), ...Object.keys(n.bv || {})]);
        for (const k of allKeys) {
          const rv = (r.bv || {})[k];
          const nv = (n.bv || {})[k];
          if (rv && !nv) {
            missingToken.push({ node: r.name, type: r.type, field: k, refVar: rv });
          } else if (rv && nv && JSON.stringify(rv) !== JSON.stringify(nv)) {
            wrongToken.push({ node: r.name, type: r.type, field: k, refVar: rv, newVar: nv });
          }
        }
      }

      // Sizing diffs
      if (r.sizingH && (r.sizingH !== n.sizingH || r.sizingV !== n.sizingV)) {
        sizingDiffs.push({
          node: r.name, type: r.type,
          ref: `${r.sizingH}×${r.sizingV}`,
          new: `${n?.sizingH}×${n?.sizingV}`,
        });
      }

      // Visibility diffs — catches slots/frames the reference intentionally hides
      if (r.visible !== undefined && n?.visible !== undefined && r.visible !== n.visible) {
        visibilityDiffs.push({
          node: r.name, type: r.type,
          ref: r.visible, new: n.visible,
        });
      }
    }
  }

  results[newId] = {
    clean: wrongToken.length === 0 && missingToken.length === 0 &&
           sizingDiffs.length === 0 && visibilityDiffs.length === 0,
    wrongToken,
    missingToken,
    sizingDiffs,
    visibilityDiffs,
  };
}

return results;
