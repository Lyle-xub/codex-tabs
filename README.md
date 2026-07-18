<div align="center">
  <img src="docs/images/app-icon.png" width="128" height="128" alt="Codex Tabs icon">
  <h1>Codex Tabs</h1>
  <p><strong>Browser-style tabs, live usage previews, and split conversations for Codex on macOS.</strong></p>
  <p>
    <a href="README.md">English</a> ·
    <a href="README.zh-CN.md">简体中文</a>
  </p>
  <p>
    <a href="https://github.com/Lyle-xub/codex-tabs/stargazers"><img src="https://img.shields.io/github/stars/Lyle-xub/codex-tabs?style=flat-square&logo=github" alt="GitHub stars"></a>
    <a href="https://github.com/Lyle-xub/codex-tabs/releases/latest"><img src="https://img.shields.io/github/v/release/Lyle-xub/codex-tabs?style=flat-square&label=release" alt="Latest release"></a>
    <a href="https://github.com/Lyle-xub/codex-tabs/releases"><img src="https://img.shields.io/github/downloads/Lyle-xub/codex-tabs/total?style=flat-square&label=downloads" alt="Total downloads"></a>
    <img src="https://img.shields.io/badge/macOS-14%2B-black?style=flat-square&logo=apple" alt="macOS 14 or later">
    <img src="https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 22 or later">
  </p>
</div>

Codex Tabs is a small runtime UI hack for the Codex macOS desktop app. It adds a native menu bar manager and mirrors your Codex tasks into horizontal or vertical tabs without modifying `Codex.app`, `app.asar`, or the official app signature.

It connects through a randomly selected Chromium DevTools port bound to `127.0.0.1`, then injects a reversible JavaScript/CSS layer. As long as Codex does not completely replace its task DOM and frontend protocol, the adapter can be updated without patching the official application bundle.

## Preview

<table>
  <tr>
    <th width="33.33%">Vertical sidebar</th>
    <th width="33.33%">Split conversations</th>
    <th width="33.33%">Top tab bar</th>
  </tr>
  <tr>
    <td><img src="docs/images/vertical-sidebar.png" alt="Vertical task tabs with the native sidebar collapsed" width="100%"></td>
    <td><img src="docs/images/inline-dual-task.png" alt="Two live conversations in one Codex window" width="100%"></td>
    <td><img src="docs/images/top-tab-bar.png" alt="Horizontal task tabs above the conversation" width="100%"></td>
  </tr>
</table>

> [!IMPORTANT]
> This is an unofficial experimental project and is not affiliated with or endorsed by OpenAI. Use it only on devices and Codex sessions you are authorized to control. It does not bypass account permissions, subscriptions, quotas, or server-side security.

## How the hack works

1. **Launch or attach locally.** The launcher identifies Codex by bundle ID `com.openai.codex`, chooses an unused local port, and starts or attaches to its Chromium renderer through CDP.
2. **Inject a reversible UI patch.** [`src/injected.js`](src/injected.js) is evaluated with `Runtime.evaluate`. It creates isolated DOM, styles, observers, and event handlers; `destroy()` removes the entire patch without quitting Codex.
3. **Reuse native navigation.** Tabs are discovered from stable `data-testid`, thread IDs, links, and ARIA semantics. Selecting a custom tab activates the original Codex task entry, so routing, session state, and permissions remain owned by Codex.
4. **Persist UI state only.** `MutationObserver` keeps the mirror in sync, while `localStorage` stores tab order, closed tabs, panel width, and other presentation preferences.
5. **Read usage locally.** [`src/usage.mjs`](src/usage.mjs) reads the tail of matching JSONL files in `~/.codex/sessions` and `~/.codex/archived_sessions` to display tokens, cached input, context usage, activity, and quota snapshots. Conversation contents are not uploaded.

The inline conversation panel is the most experimental component. It creates a same-origin iframe inside the current renderer, loads a second Codex frontend, and forwards the parent preload messages. This avoids opening a second `BrowserWindow`, but depends more heavily on Codex's current frontend entry point and message protocol.

## Features

- Horizontal task tabs when the native sidebar is visible
- Automatic vertical task panel when the native sidebar is collapsed
- Single-click switching, close without archive, recently closed tabs, and `Control+Shift+T`
- Hold-and-drag ordering with a live drag ghost and edge auto-scroll
- `Control+1` through `Control+9` task switching and `Control+W` tab closing
- Persistent titles, order, active tab, closed state, panel size, and appearance
- Active-tab color, background, border, shadow, opacity, radius, and sizing controls
- Hover preview for task state, elapsed time, current step, tokens, cached input, context, and quota change
- Local usage synchronization even when the native sidebar task nodes are unmounted
- Automatic hiding outside task pages and while a project/directory preview overlaps the vertical panel
- Experimental live split conversation in the same Codex renderer
- Resizable split panel with remembered width and double-click reset
- Chinese and English UI for the menu bar app and injected interface
- Menu bar-only SwiftUI manager with no Dock icon
- Safe cleanup on `Control-C` without quitting Codex

## Install

1. Download the latest `Codex-Tabs-*-macOS.zip` from [GitHub Releases](https://github.com/Lyle-xub/codex-tabs/releases/latest).
2. Extract `Codex Tabs.app`.
3. Quit Codex normally with `⌘Q` before the first launch.
4. Because current builds use an ad-hoc signature and are not notarized, right-click the app in Finder, choose **Open**, and confirm the system prompt.
5. Click the Codex Tabs menu bar icon and choose **Start Codex Tabs**.

The app bundles its Node.js runtime. Settings are saved to `~/Library/Application Support/Codex Tabs/config.json`.

## Run from source

Node.js 22 or later is required. The project has no third-party npm dependencies.

```bash
git clone https://github.com/Lyle-xub/codex-tabs.git
cd codex-tabs
npm start
```

If Codex is already running, quit it normally first. Electron's single-instance behavior cannot add a debugging flag to an existing process.

Useful commands:

```bash
npm run demo
npm run check
npm test
npm run build:mac
```

To attach to a Codex instance already using a fixed local debugging port:

```bash
npm run attach -- 9229
```

## Project layout

- [`src/cli.mjs`](src/cli.mjs) — discovers, launches, and attaches to Codex; synchronizes config and usage
- [`src/cdp.mjs`](src/cdp.mjs) — minimal CDP WebSocket client
- [`src/injected.js`](src/injected.js) — tab UI, drag behavior, previews, vertical mode, and split conversations
- [`src/usage.mjs`](src/usage.mjs) — read-only local session usage parser
- [`macos/CodexTabsManager`](macos/CodexTabsManager) — native SwiftUI menu bar manager
- [`scripts/build-macos-app.sh`](scripts/build-macos-app.sh) — release build and ad-hoc app signing

## Security and compatibility

The debugging port controls the renderer. Codex Tabs binds it explicitly to `127.0.0.1`; do not change it to `0.0.0.0` or forward it to a LAN or the public internet.

Task discovery is centralized in `findTabs()` inside [`src/injected.js`](src/injected.js). If a Codex update breaks discovery, adapt the stable thread attributes and ARIA selectors instead of depending on minified CSS class names.

## Support development

If Codex Tabs saves you time, you can support continued development through [Buy Me a Coffee](https://buymeacoffee.com/lylexub) or scan one of the payment codes below. Starring the repository and sharing feedback also helps a lot.

<table>
  <tr>
    <th width="50%">Alipay</th>
    <th width="50%">WeChat Pay</th>
  </tr>
  <tr>
    <td align="center"><img src="macos/Assets/AlipayQR.png" alt="Alipay donation QR code" width="240"></td>
    <td align="center"><img src="macos/Assets/WeChatQR.png" alt="WeChat Pay donation QR code" width="240"></td>
  </tr>
</table>

<div align="center">
  <a href="https://buymeacoffee.com/lylexub"><strong>☕ Buy Me a Coffee</strong></a>
</div>

<p align="center"><sub>Thanks to the <a href="https://linux.do/">Linux.do</a> community for its support and inspiration.</sub></p>
