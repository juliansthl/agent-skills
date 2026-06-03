---
name: figma-plugin-setup
description: Scaffolds and styles a new Figma plugin using a preferred stack — TypeScript + Vite + esbuild for the build, @create-figma-plugin/ui (Preact, UI3) for the settings UI, plus the layout, icon, and section-styling conventions. Trigger when the user asks to create, scaffold, start, or build a new Figma plugin (private/local plugin or one intended for publishing). Also trigger when the user is working on the UI of an existing Figma plugin and would benefit from these conventions ("make this plugin's UI look like Figma's", "use Figma UI3 components", "match my other plugins"). Skip when the task is purely about Figma file manipulation (use figma-implement-design or figma-use instead).
---

# figma-plugin-setup

Reference for building Figma plugins in this style. The first plugin built this way lives at https://github.com/juliansthl/figma-plugin-create-library-component — use it as a concrete example if you need to see the patterns wired up end-to-end.

## Stack

| Concern | Choice |
|---|---|
| Sandbox language | TypeScript |
| Sandbox bundler | `esbuild` (single-file IIFE → `dist/code.js`) |
| UI framework | Preact (via `@create-figma-plugin/ui` — UI3-styled, ~Figma-native) |
| UI bundler | Vite + `vite-plugin-singlefile` (inlines JS/CSS into `dist/ui.html`) |
| Preact JSX | `@preact/preset-vite` |
| Plugin types | `@figma/plugin-typings` |
| Config persistence | `figma.root.setPluginData` (per-file) — survives collaborators |

Don't pull in `@create-figma-plugin/build` or the whole framework — only use `@create-figma-plugin/ui` for components. Keep our own Vite + esbuild setup.

## File structure

```
<plugin-folder>/
├── manifest.json
├── package.json
├── tsconfig.json
├── vite.config.ts
├── README.md             # Install + use + dev (commit dist/)
├── .gitignore            # exclude node_modules, NOT dist/
├── dist/                 # committed so users can import without building
└── src/
    ├── code.ts           # sandbox entry
    ├── shared/
    │   ├── config.ts     # Config type + DEFAULT_CONFIG + mergeWithDefaults + cloneConfig
    │   └── messages.ts   # UiToCodeMessage / CodeToUiMessage discriminated unions
    └── ui/
        ├── ui.html
        ├── main.tsx      # mounts Preact + imports base.css + styles.css
        ├── app.tsx       # the actual settings UI
        └── styles.css    # minimal overrides only
```

Commit `dist/` — users install via "Import plugin from manifest…" without running a build.

## Manifest

```json
{
  "name": "Plugin name",
  "id": "kebab-case-id",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html",
  "editorType": ["figma"],
  "menu": [
    { "name": "Main action", "command": "run" },
    { "name": "Settings…", "command": "settings" }
  ],
  "networkAccess": { "allowedDomains": ["none"] }
}
```

- No `icon` field exists for local dev plugins — icons only apply at Community / private-team publish time. If asked for an icon early, prepare assets but explain it won't appear in the menu until publishing.
- Don't add `documentAccess: "dynamic-page"` unless you need it — it forces async page loads everywhere.

## Vite config gotcha

`@create-figma-plugin/ui`'s `render.js` uses webpack-style `import '!../css/base.css'` syntax. Vite/Rollup can't resolve the `!` prefix. Add this plugin to `vite.config.ts`:

```ts
function stripBangPrefix(): Plugin {
  return {
    name: "strip-bang-prefix",
    enforce: "pre",
    async resolveId(source, importer) {
      if (source.startsWith("!")) {
        return this.resolve(source.slice(1), importer, { skipSelf: true });
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [stripBangPrefix(), preact(), viteSingleFile()],
  root: "src/ui",
  build: {
    outDir: "../../dist",
    emptyOutDir: false,
    rollupOptions: { input: "src/ui/ui.html" },
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
  },
});
```

Mount Preact yourself (don't use the lib's `render` helper); import the CSS directly:

```ts
// main.tsx
import { render } from "preact";
import "@create-figma-plugin/ui/css/base.css";
import "./styles.css";
import { App } from "./app";
render(<App />, document.getElementById("app")!);
```

## Package scripts

```json
{
  "scripts": {
    "build": "npm run clean && npm run build:code && npm run build:ui && npm run copy:manifest",
    "build:code": "esbuild src/code.ts --bundle --target=es2017 --format=iife --outfile=dist/code.js",
    "build:ui": "vite build",
    "copy:manifest": "cp manifest.json dist/manifest.json",
    "clean": "rm -rf dist",
    "watch": "npm run clean && npm run copy:manifest && concurrently -k -n code,ui \"npm:watch:code\" \"npm:watch:ui\"",
    "watch:code": "esbuild src/code.ts --bundle --target=es2017 --format=iife --outfile=dist/code.js --watch",
    "watch:ui": "vite build --watch",
    "typecheck": "tsc --noEmit"
  }
}
```

`tsconfig.json` essentials: `"jsx": "react-jsx"`, `"jsxImportSource": "preact"`, `"types": ["@figma/plugin-typings"]`.

## UI conventions

Apply these patterns by default.

### Section headings

Each section title is **a `<Divider>` + `<VerticalSpace space="medium">` + bold heading**. The first section in the panel skips the divider.

```tsx
function SectionHeading({ children, first = false }: { children: string; first?: boolean }) {
  return (
    <>
      {first ? null : (
        <>
          <VerticalSpace space="medium" />
          <Divider />
          <VerticalSpace space="medium" />
        </>
      )}
      <Text><Bold>{children}</Bold></Text>
      <VerticalSpace space="small" />
    </>
  );
}
```

This matches Figma's right-panel section style.

### Layout helpers

- `<Container space="medium">` for the main scrolling area.
- `<Columns space="extraSmall">` for side-by-side input pairs (gives the right spacing).
- `<Stack space="extraSmall">` for vertical lists of similar items.
- `<VerticalSpace space="extraSmall">` between input rows in the same section, `space="small"` after a heading.

## Sandbox patterns

### Message protocol

Discriminated unions in `src/shared/messages.ts`:

```ts
export type UiToCodeMessage =
  | { type: "ui-ready" }
  | { type: "save"; config: Config }
  | { type: "reset" }
  | { type: "cancel" };

export type CodeToUiMessage = { type: "init"; config: Config; /* extras */ };
```

Use a `"ui-ready"` handshake — the sandbox sends `init` only after the UI mounts and signals readiness. Lets the sandbox load expensive state (e.g. variables) just-in-time.

### Config

```ts
export const CONFIG_KEY = "<plugin-id>.config.v1";

export function loadConfig(): Config {
  const raw = figma.root.getPluginData(CONFIG_KEY);
  if (!raw) return cloneConfig(DEFAULT_CONFIG);
  try { return mergeWithDefaults(JSON.parse(raw)); }
  catch { return cloneConfig(DEFAULT_CONFIG); }
}
```

Always have a `mergeWithDefaults(partial)` that's tolerant of old schemas (renamed keys, removed fields). Never invalidate users' saved config; migrate it.

### Command routing

```ts
if (figma.command === "settings") openSettings();
else mainAction();
```

## Git / publishing

- Initial commit should include `dist/` so users can install without building.
- README sections: **Install in Figma** (clone → Import plugin from manifest → pick `dist/manifest.json`), **Use**, **Develop** (`npm install` + `npm run watch`).
- `.gitignore`: exclude `node_modules/`, logs, env files, IDE folders, OS junk. **Do NOT exclude `dist/`** for plugins distributed via repo clone.
- Co-author commits with Claude as per repo convention.

## Things to ask vs assume

Default behavior — apply these without asking:

- TypeScript + Vite + esbuild stack.
- `@create-figma-plugin/ui` for the settings UI.
- Per-file config storage via `figma.root.setPluginData`.
- Section heading + icon-input patterns above.

Ask the user about:

- Plugin name and what it should do at the high level.
- Whether they want a settings UI at all (or just a silent action).
- Default values for any domain-specific config (padding sizes, default variant props, etc.).

Don't ask about:

- Build tool choice. The answer is always Vite + esbuild.
- UI library choice. The answer is always `@create-figma-plugin/ui`.
