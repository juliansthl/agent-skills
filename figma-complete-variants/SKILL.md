---
name: figma-complete-variants
description: Fills in the missing variants of an existing Figma COMPONENT_SET, following the set's own conventions (variable bindings, child order, sizing, naming). Trigger when the user asks to "add the missing variants", "complete the variant matrix", "fill out this component set", "create the remaining states/sizes", or extend an existing Figma variant set following its conventions. Scoped to completing an existing set — for creating a component or design system from scratch use figma-generate-library; for general canvas writes use figma-use. Requires the Figma MCP server (use_figma).
---

# figma-complete-variants

Complete the variant matrix of an **existing** Figma `COMPONENT_SET` by cloning the nearest existing variant and applying only the per-axis delta. This preserves every variable binding, component-property reference, nested instance, and font — far more robust than rebuilding variants by hand.

**Prerequisite:** load the [`figma-use`](../figma-use/SKILL.md) skill first (it owns the Plugin API rules). Always pass `skillNames: "figma-use,figma-complete-variants"` to `use_figma`.

## The recipe (do these in order)

1. **Inspect deeply — programmatically, not via `get_metadata`.** `get_metadata` mislabels a `COMPONENT_SET` as a `<frame>` and its variants as `<symbol>`. Run [`scripts/inspect-variant-set.js`](scripts/inspect-variant-set.js) via `use_figma`. This single call returns the real types, `componentPropertyDefinitions`, per-variant structure, child order, `fills`, `boundVariables`, `fontSize`, `textStyleId`, the **missing combos** (cartesian product minus existing names), and all local text styles — everything needed to plan the deltas. `check-matrix.js` is no longer needed as a separate step. **If the user hasn't provided a URL, leave `SET_ID = ''`** — the script walks up from `figma.currentPage.selection[0]` to find the enclosing `COMPONENT_SET` automatically (selecting any variant or the set itself works).
2. **Diff the axes.** For each variant axis, determine the *minimal delta* between two adjacent variants. This is the whole game — see the table below. Pick, for each missing combo, the **nearest existing source** (ideally differing by exactly one axis).
3. **Clone + apply the delta.** Batch-fetch all source nodes first with `parallelGetNodes()`, then loop synchronously with `addVariant()`. See the helpers in [`scripts/helpers.js`](scripts/helpers.js).
4. **Position by `layoutMode`** (the #1 footgun — see below).
5. **Validate by structure AND inline screenshot.** A correct count is not proof. Run [`scripts/validate.js`](scripts/validate.js) — it checks completeness, position uniqueness, and calls `await set.screenshot()` inline. No separate `get_screenshot` / curl / Read calls needed.
6. **Diff against the reference variant.** Instance swaps fix instance-level viewport but leave Frame-level overrides exactly as they were in the source clone. Run [`scripts/diff-against-reference.js`](scripts/diff-against-reference.js) with the hand-authored Desktop variant as `REF_ID` — it reports four categories of mismatch across the full subtree: wrong tokens, missing tokens, sizing mode differences, and **visibility differences** (slots or frames the reference intentionally hides that the clone has visible). Also covers `gridRowGap`/`gridColumnGap` on `layoutMode: "GRID"` nodes, which `itemSpacing`-only checks miss.

## Diffing the axes — common deltas

Before changing anything, classify what each axis actually changes between two neighboring variants:

| Axis kind | Typical delta | How to apply |
|---|---|---|
| Color state (Default/Hover/Active, etc.) | Rebind text + icon fills to a different **token variable** | `rebindFillsToVariable(node, variable)` — rebind, don't set raw RGB. Building a fill/stroke from scratch? Use `solidPaintBoundToVariable(variable, node)`, never a hand-rolled black paint + `setBoundVariableForPaint` (leaves a black raw fallback that some render paths display — see Pitfalls). |
| Position/order (icon Left/Right, leading/trailing) | Reorder children | `comp.appendChild(child)` moves it last; `comp.insertChild(0, child)` moves it first |
| Size/breakpoint (Mobile/Desktop, sm/lg) | Different spacing/height/width **variables** + text style swap + component resize + inner instance swaps | Rebind padding/spacing/height variables; swap `textStyleId` on each text node (no font load needed — see Fonts section); resize the component to the target width; set `layoutSizingVertical` if it differs (e.g. `FIXED` → `HUG`). Clone from the same-row sibling so you inherit structure for free. **Then** check all nested instances for a `Viewport` axis and swap them too — see "Inner instances with breakpoint axes" below. |
| Boolean (with/without icon, etc.) | Toggle `visible` on a node | `node.visible = false` |

Choosing the source variant by "differs by one axis" means you inherit everything else for free and only touch the one thing that changes.

## Positioning: ALWAYS branch on the set's `layoutMode`

Cloned variants do **not** position themselves. How you place them depends entirely on the component set's `layoutMode` — and getting this wrong fails *silently* (clones stack on top of their source; the variant count still looks right).

| `set.layoutMode` | Positioning API | Notes |
|---|---|---|
| `"GRID"` | `child.setGridChildPosition(rowIndex, colIndex)` | **`child.x` / `child.y` are ignored.** Map each axis-value to a row/col. This is the common case for tidy variant tables. |
| `"HORIZONTAL"` / `"VERTICAL"` | Control by **child order** | x/y ignored; auto-layout flows children. |
| `"NONE"` | Set `child.x` / `child.y` | Then resize the set to fit: `set.resizeWithoutConstraints(maxX+pad, maxY+pad)`. |

**Always read `set.layoutMode` (and for GRID, `gridRowCount`/`gridColumnCount` and the existing children's `gridRowAnchorIndex`/`gridColumnAnchorIndex`) before placing anything.** Use the existing variants' anchors to learn the row/column → axis-value mapping, then slot the new ones into the empty cells.

## Fonts: prefer `textStyleId` over `fontSize`

Assigning `node.textStyleId = styleId` applies the full style (including font size, family, and weight) **without requiring `loadFontAsync`** — even for trial fonts that `listAvailableFontsAsync()` does not list. When a breakpoint axis changes font size (e.g. Mobile 14px → Desktop 13px), swap `textStyleId` rather than setting `fontSize` directly: it's font-load-free, preserves the style link, and updates size in one step.

## Text style sweep — for any axis that changes text styles

**After any axis delta that changes text styles (typically size/breakpoint axes), sweep every TEXT node in the clone and remap source style IDs to target equivalents.** This is a required step that is easy to forget because it is silent — no error is thrown, the text renders at the wrong size, and `diff-against-reference` won't catch it unless the reference happens to share a node with the same name.

**Why `setProperties` alone is not enough:** Calling `instance.setProperties({ Viewport: 'Desktop' })` on a nested instance correctly updates that instance's own text nodes (they now render via the target component's native styles). But TEXT nodes that live in the **component's own frame tree** — not inside any instance — are never touched by instance swaps. They carry the source `textStyleId` from the clone and silently stay there.

Build the style map from the local styles returned by `inspect-variant-set.js` using the axis values being transitioned (match on name substring: `"MM Mobile Capitals"` → `"MM Desktop Capitals"`, `"Type/sm"` → `"Type/lg"`, etc.), then run this sweep on every clone before validating. Both helpers are in [`scripts/helpers.js`](scripts/helpers.js).

```js
// Build map once, outside the loop.
// fromValue/toValue are the axis values being transitioned — derive from the
// variant name being created (e.g. source is 'Viewport=Mobile', target is
// 'Viewport=Desktop' → fromValue='Mobile', toValue='Desktop').
// textStyles comes from inspect-variant-set.js output; no extra API call needed.
const styleMap = buildTextStyleMap(textStyles, fromValue, toValue);

// Call on each clone after applying the axis delta.
swapTextStyles(clone, styleMap);
```

**Important:** recurse into instance children too (don't stop at `node.type === 'INSTANCE'`). Explicit source-value style overrides on TEXT nodes inside instances also persist through `setProperties` and need the same fix.

## Inner instances with matching axes

After applying any axis delta, check whether instances nested inside the new variant also have that axis — they need to be swapped too. The helper `swapInnerInstances(variant, fromValue, toValue)` in [`scripts/helpers.js`](scripts/helpers.js) detects the right axis automatically: it looks for any axis whose current value equals `fromValue` and whose options include `toValue`. No axis name list needed — works for any axis kind.

**How to call (single pass):**
```js
// fromValue/toValue are the same axis values used for the outer delta.
swapInnerInstances(variant, fromValue, toValue);
```

**Why `mainComponent` instead of `getMainComponentAsync`:** `getMainComponentAsync` reliably fails on compound-ID nodes (those nested inside other instances). The synchronous `mainComponent` property works for most compound-ID nodes but throws for instances that are so deeply nested they're owned by another component's internals — those get fixed automatically when their parent is swapped, so the throw is the right signal to skip them.

**Run the swap loop until convergence (`remaining = 0`).** A single pass is never guaranteed to be enough. Each swap pass can expose a new layer of slot-content overrides: once a parent instance is swapped to its target variant, its children's compound IDs change and previously-inaccessible instances become reachable. The pass count is unpredictable — it depends on nesting depth, not just component count. Always loop until zero remain:

```js
// Keep swapping until no instances with fromValue remain.
while (true) {
  let swappedThisPass = 0;
  for (const variantId of newVariantIds) {
    const variant = await figma.getNodeByIdAsync(variantId);
    swappedThisPass += swapInnerInstances(variant, fromValue, toValue);
  }
  if (swappedThisPass === 0) break;
}
```

**`swapComponent` resets instance sizing** — after swapping, any instance whose main component uses `FILL` horizontal sizing will revert to the component's native (smaller) width instead of filling its parent. Always restore it:
```js
if (instance.layoutSizingHorizontal !== 'FILL') {
  instance.layoutSizingHorizontal = 'FILL';
}
```
Check the reference variant for the target value to see what sizing each swapped instance should have.

## Performance rules of thumb

| Pattern | Instead of | Why |
|---|---|---|
| `parallelGetNodes(ids)` — `Promise.all` | `for...of` with `await getNodeByIdAsync` inside | Sequential awaits multiply latency by N |
| `findAllWithCriteria({ types: ['INSTANCE'] })` | `findAll(n => n.type === 'INSTANCE')` | Indexed type lookup vs full-tree callback scan |
| `await set.screenshot()` inline in validate script | `get_screenshot` → `curl` → `Read` | Eliminates 2 extra tool calls + permission prompts per visual check |
| One `use_figma` call for all post-processing | Separate calls for text styles / instance swaps / sizing | Each call has round-trip overhead; independent operations on the same nodes can share a script |

## Pitfalls (learned the hard way)

- **`get_metadata` types lie for component sets** — verify `node.type` with `use_figma`.
- **Silent positioning failure on GRID sets** — `x`/`y` no-op; you only catch it in the screenshot. Branch on `layoutMode`.
- **`setBoundVariableForPaint` returns a NEW paint** — map over `fills` and reassign the array; don't mutate in place. Fetch the variable object via `figma.variables.getVariableByIdAsync(id)`.
- **A correct token binding can still render the WRONG color — sync the paint's raw `color` fallback.** `setBoundVariableForPaint` binds the variable but leaves the paint's raw `color` untouched. Component-set/variant thumbnails, exports, and other non-variable-aware render paths display that **raw fallback**, not the resolved variable — so a label bound to the right token (e.g. `Content/OnDark/Primary`) still paints black `{0,0,0}` if that's the raw color, which is invisible on a dark button. This is silent: `boundVar` looks right, `resolveForConsumer(node)` returns the right value, only the screenshot reveals it. The trap is building a fill/stroke from a hand-rolled `{ type:'SOLID', color:{r:0,g:0,b:0} }` and binding it — the black fallback survives. Fixes: (1) construct fresh paints with `solidPaintBoundToVariable(variable, node)`; (2) rebind via `rebindFillsToVariable(node, variable)` — both sync the raw color to `variable.resolveForConsumer(node).value`; (3) as a final pass over every new variant before validating, run `await syncBoundPaintRawColors(variant)` (all in [`scripts/helpers.js`](scripts/helpers.js)). When validating, eyeball low-contrast cells (light-text-on-dark, dark-text-on-light) specifically — that's where a black fallback hides.
- **Count ≠ correct.** "12 variants exist" hid 6 overlapping clones. Validate distinct positions + screenshot.
- **Clone the nearest source**, not the default variant — minimizes the delta and inherits all bindings.
- **In GRID sets, always clone from a source in the same row as the target.** Cloning from a different row and calling `setGridChildPosition` correctly sets `gridRowAnchorIndex`, but the grid engine may leave the rendered `y` coordinate stale (at the source's row position) when another variant already occupies the target column in the source's row. The symptom: `gridRowAnchorIndex` looks right in code but the variant visually renders in the wrong row. Fix: pick a source that is already in the correct row and only differs on another axis, so `setGridChildPosition` only needs to move the clone within its row.
- **`swapComponent` does not fix Frame-level bound variables.** Swapping an instance to its target-breakpoint variant updates the instance's own component but leaves all Frame-level overrides on the clone unchanged — spacing tokens, sizing modes, `gridRowGap`/`gridColumnGap`. These came from the source variant and need explicit correction. `layoutMode: "GRID"` nodes carry three distinct spacing properties (`itemSpacing`, `gridRowGap`, `gridColumnGap`) and all three may need rebinding; checking only `itemSpacing` misses the grid-specific ones. Use [`scripts/diff-against-reference.js`](scripts/diff-against-reference.js) after all swaps to find everything that still differs from the reference.
- **Direct TEXT nodes retain source text styles after an instance swap.** `setProperties(...)` updates text inside *instances* (they render via the new component's native styles), but TEXT nodes that live directly in the component's own frame tree are never touched. They silently keep the source `textStyleId`. Fix: run `swapTextStyles(clone, styleMap)` — a full-tree TEXT sweep using the style map built from the axis values being transitioned — **after any axis delta that changes text styles**, before validating. See the "Text style sweep" section above for the pattern.
- **Guard `componentPropertyDefinitions` as well as `mainComponent`.** Some component sets can be in an error state that throws on `componentPropertyDefinitions` access — wrap it in `try/catch { continue; }` alongside the `mainComponent` guard, or the entire swap loop will abort mid-pass.
