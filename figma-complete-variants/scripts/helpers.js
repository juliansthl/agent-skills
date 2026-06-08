// helpers.js — reusable building blocks for cloning + applying per-axis deltas.
// Copy the functions you need into a use_figma call. They assume the figma global.

// --- Batch-fetch multiple nodes in parallel. --------------------------------
// Always call this before the clone loop — collect all source nodes up front
// instead of awaiting getNodeByIdAsync sequentially inside the loop.
async function parallelGetNodes(ids) {
  return Promise.all(ids.map((id) => figma.getNodeByIdAsync(id)));
}

// --- Bind a variable to a SOLID paint AND sync its raw `color` fallback. --------
// CRITICAL: setBoundVariableForPaint returns a NEW paint but does NOT touch the
// paint's raw `color`. Some render paths (component-set / variant thumbnails,
// exports, and other non-variable-aware contexts) display that raw fallback
// instead of the resolved variable — so a paint bound to the CORRECT token can
// still render the WRONG color (classically black {0,0,0} from a freshly-built
// paint). Always overwrite the raw color with the variable's resolved value via
// resolveForConsumer(node). `variable` is a Variable object from
// figma.variables.getVariableByIdAsync(id); `node` is the paint's owner.
function bindPaintToVariable(paint, variable, node) {
  if (paint.type !== 'SOLID') return paint;
  const bound = figma.variables.setBoundVariableForPaint(paint, 'color', variable);
  const resolved = variable.resolveForConsumer(node);
  if (resolved && resolved.value) {
    const c = resolved.value;
    return { ...bound, color: { r: c.r, g: c.g, b: c.b } };
  }
  return bound;
}

// Build a fresh SOLID paint already bound to `variable` with a correct raw
// fallback. Use this whenever you construct a new fill/stroke from scratch
// (e.g. adding a disabled-state border) — never hand-roll
// { type:'SOLID', color:{r:0,g:0,b:0} } + setBoundVariableForPaint, which leaves
// the black fallback behind.
function solidPaintBoundToVariable(variable, node) {
  return bindPaintToVariable({ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }, variable, node);
}

// --- Rebind all SOLID fills of a node to a token VARIABLE (not a raw color). ---
// Use for color-state axes (Default/Hover/Active). Reassigns the array (paints
// are immutable) and syncs each paint's raw fallback — see bindPaintToVariable.
function rebindFillsToVariable(node, variable) {
  node.fills = node.fills.map((p) => bindPaintToVariable(p, variable, node));
}

// --- Final-pass sweep: sync EVERY bound paint's raw color to its resolved value. ---
// Run this over each newly-created variant subtree before validating. It repairs
// any paint whose binding is correct but whose raw fallback is stale/black —
// regardless of how the paint was built. Cheap insurance; idempotent.
async function syncBoundPaintRawColors(node) {
  for (const key of ['fills', 'strokes']) {
    const arr = node[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    let changed = false;
    const next = [];
    for (const p of arr) {
      const id = p.type === 'SOLID' && p.boundVariables && p.boundVariables.color && p.boundVariables.color.id;
      if (id) {
        const v = await figma.variables.getVariableByIdAsync(id);
        const r = v && v.resolveForConsumer(node);
        if (r && r.value) { changed = true; next.push({ ...p, color: { r: r.value.r, g: r.value.g, b: r.value.b } }); continue; }
      }
      next.push(p);
    }
    if (changed) node[key] = next;
  }
  if ('children' in node) for (const c of node.children) await syncBoundPaintRawColors(c);
}

// --- Move a child to the end (e.g. icon → right / trailing). ---
function moveToEnd(parent, child) { parent.appendChild(child); }
// --- Move a child to the front (e.g. icon → left / leading). ---
function moveToFront(parent, child) { parent.insertChild(0, child); }

// --- Position a freshly-appended variant, branching on the set's layoutMode. ---
function placeVariant(set, child, { row, col, x, y }) {
  if (set.layoutMode === 'GRID') {
    child.setGridChildPosition(row, col);
  } else if (set.layoutMode === 'NONE') {
    child.x = x; child.y = y;
  }
  // HORIZONTAL/VERTICAL: child order controls layout — nothing to set.
}

// --- Clone a pre-fetched source, name it, place it, apply a delta. ----------
// Always use with parallelGetNodes() — fetch all sources first, then call this
// in a plain synchronous loop. Never call getNodeByIdAsync inside a for loop.
function addVariant(set, source, name, place, delta) {
  const clone = source.clone();
  set.appendChild(clone);
  clone.name = name; // exact "Prop=Value, ..." string — this sets the variant
  if (delta) delta(clone);
  placeVariant(set, clone, place);
  return clone.id;
}

// --- Canonical usage pattern ------------------------------------------------
//
//   const plan = [
//     { sourceId: '123:1', name: 'Viewport=Desktop, State=Hover',   place: { row: 1, col: 1 }, delta: applyHover },
//     { sourceId: '123:2', name: 'Viewport=Desktop, State=Focused', place: { row: 2, col: 1 }, delta: applyFocused },
//   ];
//
//   const sources = await parallelGetNodes(plan.map(p => p.sourceId));
//   const createdNodeIds = plan.map((p, i) =>
//     addVariant(set, sources[i], p.name, p.place, p.delta)
//   );
//
//   return { createdNodeIds };

// --- Build a text-style ID map for any axis that changes text styles. -------
// fromValue/toValue are the axis values being transitioned (e.g. 'Mobile'→'Desktop',
// 'Small'→'Large'). textStyles is the array from inspect-variant-set.js output.
// Matches by substring replacement, so partial names work: "Type/sm" → "Type/lg".
function buildTextStyleMap(textStyles, fromValue, toValue) {
  const map = new Map();
  for (const s of textStyles) {
    if (s.name.includes(fromValue)) {
      const targetName = s.name.replace(fromValue, toValue);
      const dst = textStyles.find(t => t.name === targetName);
      if (dst) map.set(s.id, dst.id);
    }
  }
  return map;
}

// --- Sweep all TEXT nodes in a subtree and remap style IDs via the map. -----
// Recurses into instances too — explicit style overrides on TEXT nodes inside
// instances persist through setProperties() and need the same fix.
function swapTextStyles(node, styleMap) {
  if (node.type === 'TEXT') {
    const sid = node.textStyleId;
    if (typeof sid === 'string' && styleMap.has(sid)) {
      try { node.textStyleId = styleMap.get(sid); } catch(e) {}
    }
  }
  if ('children' in node) {
    for (const child of node.children) swapTextStyles(child, styleMap);
  }
}

// --- Swap inner instances whose axis value matches fromValue → toValue. ------
// Works for any axis kind (Viewport, Size, State, etc.) — no axis name needed.
// Detects the right axis by finding one whose current value equals fromValue
// and whose options include toValue. Call in a convergence loop until it
// returns 0 — each pass can expose newly-reachable instances as parents swap.
function swapInnerInstances(variant, fromValue, toValue) {
  let swapped = 0;
  for (const instance of variant.findAllWithCriteria({ types: ['INSTANCE'] })) {
    let mc;
    try { mc = instance.mainComponent; } catch { continue; }
    if (!mc) continue;

    const set = mc.parent;
    if (!set || set.type !== 'COMPONENT_SET') continue;
    let defs; try { defs = set.componentPropertyDefinitions; } catch { continue; }

    const props = {};
    mc.name.split(', ').forEach(p => { const eq = p.indexOf('='); props[p.slice(0, eq)] = p.slice(eq + 1); });
    const axisName = Object.keys(props).find(
      k => props[k] === fromValue && defs[k]?.variantOptions?.includes(toValue)
    );
    if (!axisName) continue;

    props[axisName] = toValue;
    const targetName = Object.entries(props).map(([k, v]) => `${k}=${v}`).join(', ');
    const target = set.children.find(c => c.name === targetName);
    if (!target) continue;

    instance.swapComponent(target);
    if (instance.layoutSizingHorizontal !== 'FILL' && target.layoutSizingHorizontal === 'FILL') {
      instance.layoutSizingHorizontal = 'FILL';
    }
    swapped++;
  }
  return swapped;
}

// --- Finding instances efficiently ------------------------------------------
// Prefer findAllWithCriteria over findAll with a type predicate:
//   node.findAllWithCriteria({ types: ['INSTANCE'] })   // indexed — fast
//   node.findAll(n => n.type === 'INSTANCE')            // full-tree scan — slow
