---
name: mobile-prototype
description: Scaffold a new Expo mobile app prototype from scratch with a minimal, unopinionated blank screen, pinned to the Expo SDK that matches the latest Expo Go shipping on the App Store. Use this whenever the user wants to start a new Expo app, a new React Native prototype, a mobile prototype, a "blank Expo app", or asks to "spin up", "scaffold", "bootstrap", or "create" anything that runs in Expo Go — even if they don't say the word "Expo" but clearly mean a quick iOS/Android prototype that uses Expo Go for previews.
---

# Mobile Prototype Scaffold

Bootstraps a fresh Expo app intended for **prototyping**. The output is intentionally minimal: a blank screen, no styling system, no navigation, no state management. The SDK and React Native versions are pinned to whatever the currently-shipping Expo Go on the iOS App Store supports, so the user can immediately scan the QR code and run the app on their phone without seeing the "this project requires a newer/older version of Expo Go" error.

## Why pin to Expo Go's App Store version

Expo regularly releases new SDKs on npm before the matching Expo Go binary ships to the App Store, and Apple review can add days of delay. If you scaffold with `create-expo-app@latest` blindly, you may end up with an SDK that the user's installed Expo Go can't load. For prototyping (where the user is iterating fast and won't build a dev client), this is the most common failure mode — so check first.

## Workflow

### 1. Gather inputs

Confirm with the user (one short message — don't make it a multi-question form):
- **Project name** in kebab-case (e.g. `my-cool-app`).
- **Where to create it** — default to the current working directory unless the user implied otherwise.

If the user has already given you a name and location in their prompt, skip the question and proceed.

### 2. Look up the latest Expo Go version on the App Store

The iTunes Search API exposes the current App Store version of any app. Expo Go's app ID is `982107779`.

```bash
curl -s "https://itunes.apple.com/lookup?id=982107779&country=us" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['results'][0]['version'])"
```

Call the result `EXPO_GO_VERSION` (e.g. `54.0.2`). Tell the user what you found, briefly.

### 3. Determine the matching Expo SDK

Modern Expo Go releases use major-version alignment: **the major version of Expo Go equals the Expo SDK version it targets.** So `54.0.2` → SDK `54`. Extract the major version and call it `SDK_VERSION`.

If the major version somehow doesn't look like a plausible SDK number (e.g. it's `2.x`, which was the old pre-2025 scheme), fall back to fetching the Expo Go App Store page release notes and reading which SDK is mentioned, or check https://docs.expo.dev/versions/latest/ for the latest SDK and confirm with the user.

### 4. Scaffold with a blank template, pinned to that SDK

Use `create-expo-app` with an explicit version of the blank template that matches the SDK:

```bash
cd <target-directory>
npx create-expo-app@latest <project-name> --template blank --no-install
cd <project-name>
```

The `blank` template is the minimal JavaScript template — a single screen, one `<Text>` element, a `StyleSheet`, and nothing else. (There's also `blank-typescript` if the user asked for TypeScript; default to plain JS for a prototype unless they say otherwise.)

Then pin to the right SDK. If `create-expo-app@latest` happens to install a newer SDK than `SDK_VERSION`, fix the versions:

```bash
# Check what got installed
cat package.json | grep '"expo"'

# If the major version doesn't match SDK_VERSION, pin it:
npm install expo@~<SDK_VERSION>.0.0
npx expo install --fix
```

`npx expo install --fix` reconciles `react-native`, `react`, and all `expo-*` peer dependencies to versions compatible with the installed `expo` SDK — this is the right tool for the job rather than picking versions by hand.

Finally, install:

```bash
npm install
```

### 5. Verify it runs

Don't actually launch the dev server (it would block and the user hasn't asked you to). Just confirm `package.json` looks right and report back.

### 6. Report to the user

End with a short, friendly handoff that gets them from "scaffolded" to "running on my phone". Keep it plain — no SDK / React Native / peer dep talk. Shape it roughly like this:

> Your app `<project-name>` is ready. Here's how to see it on your phone:
>
> 1. Install **Expo Go** on your phone from the App Store (iOS) or Play Store (Android). If you already have it, open the store and update it to the latest version.
> 2. Make sure your phone and your computer are on the **same Wi-Fi network**.
> 3. In the project folder, run `npx expo start`. A QR code will appear in the terminal.
> 4. Scan the QR code:
>    - **iPhone:** open the built-in Camera app and point it at the QR code, then tap the banner that appears.
>    - **Android:** open Expo Go and tap "Scan QR code".
>
> If the QR code scan hangs or never connects (common on guest or corporate Wi-Fi that blocks devices from talking to each other), stop the server and run `npx expo start --tunnel` instead.

## Defaults and what *not* to add

Unless the user explicitly asks, do NOT add any of these to the scaffold — they're all stylistic choices that should be left to the user as they build out the prototype:

- A styling library (NativeWind, styled-components, Tamagui, restyle, etc.)
- A navigation library (`@react-navigation/*`, Expo Router, etc.)
- State management (Zustand, Redux, Jotai, etc.)
- A UI kit (React Native Paper, NativeBase, Gluestack, etc.)
- ESLint / Prettier configs beyond what `create-expo-app` puts there by default
- Sample components, sample assets, or example screens
- A `src/` directory or any folder structure beyond what the template gives you

The point of this skill is to get the user from zero to "blank screen running in Expo Go" as fast as possible. They'll add the rest themselves.

## When the user starts building

This skill ends at "blank screen on phone". Once the user starts adding real UI, the following practices punch above their weight even in throwaway prototype code. They're the prototype-relevant slice of a larger guide; treat the advice itself as load-bearing, not the source.

- **Images / media** — use `expo-image` instead of `Image` from `react-native` (better caching, transitions, and remote-image handling). For image galleries / lightboxes, `Galeria` gives a native feel with almost no setup. In any list of images, set explicit `width`/`height` so the list doesn't re-layout as images load.
- **Smooth animations** — with Reanimated, animate only `transform` and `opacity` — these run on the UI thread without re-rendering. Use `useDerivedValue` for animations computed from other shared values. For tap interactions that need to feel native (immediate feedback, no JS-thread jank), use `Gesture.Tap` from `react-native-gesture-handler` instead of `Pressable`.
- **Lists that scroll** — for anything beyond a handful of items, use **FlashList** (`@shopify/flash-list`) rather than `FlatList` or `ScrollView`. Even at prototype scale, swapping in FlashList early avoids a painful migration later.
- **Touch targets and layout** — prefer `Pressable` over `TouchableOpacity` (more flexible, better-behaved). In any `ScrollView` or list, use `SafeAreaView` / `useSafeAreaInsets` so content doesn't sit under the notch or home indicator.

Richer references (optional — the bullets above stand on their own; consult these when available for deeper guidance and code examples):

- **Expo's official "building native UI" skill** — `https://github.com/expo/skills/tree/main/plugins/expo/skills/building-native-ui`. First-party guidance from the Expo team on assembling native-feeling UI in an Expo app. The most authoritative source for the touch-target, layout, and image bullets above.
- **`vercel-react-native-skills`** — published at `https://www.skills.sh/vercel-labs/agent-skills/vercel-react-native-skills`, and if installed locally also at `~/.claude/skills/vercel-react-native-skills/`. Covers the rules above with code examples plus a longer catalogue (list-performance internals, navigation, state).

## Common pitfalls

- **`npx create-expo-app@latest` may install a newer SDK than Expo Go supports.** Always check `package.json` after scaffolding and downgrade if `SDK_VERSION` doesn't match. This is the whole reason this skill exists.
- **Don't mix npm and yarn.** `create-expo-app` defaults to npm — stick with it for the prototype.
- **The user's installed Expo Go may be out of date.** This skill pins to the latest App Store version, but if the user hasn't updated their phone's Expo Go app in a while, they may still see a version mismatch. If they report this, the fix is to update Expo Go from the App Store, not to downgrade the project further.
- **Don't run `npx expo start` for the user.** It's a long-running process that ties up the terminal. Just hand them the command.
