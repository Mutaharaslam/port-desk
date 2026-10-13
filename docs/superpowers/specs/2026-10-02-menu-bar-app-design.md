# Port desk menu bar app — design

## Goal
Port desk becomes a macOS menu bar app that can be opened at any time without Terminal or `npm start`. The UI and the stop-safety rules stay as they are today.

## Decisions (agreed 2026-10-02)
- Style: menu bar app (icon in the menu bar, popover with the port list, no Dock icon).
- Architecture: a small native Swift shell runs the existing Node server and shows it in a `WKWebView`. The tested JS logic stays the single source of truth.
- A copy of the build machine's `node` binary is bundled so nvm version changes cannot break the app.
- Target: arm64 macOS, built locally and ad-hoc signed. No notarization, no auto-update, no hotkeys, no Dock-window mode.

## Components
- `app/` — Swift package.
  - `AppDelegate` owns an `NSStatusItem` and an `NSPopover` containing a `WKWebView`. Left click toggles the popover. Right click opens a menu: Refresh, Open at login (off by default, `SMAppService`), Quit.
  - `NodeServer` launches the bundled `node server.js`, reads the URL from its first stdout line, restarts it once if it dies, then shows an error state with a Restart button.
  - A second launch activates the running instance and exits.
- `scripts/build-app.sh` — runs the tests, builds with `swift build -c release`, assembles `Port desk.app` (`LSUIElement`, Swift binary, bundled `node`, `server.js`, `lib/`, `public/`), ad-hoc signs it and installs it to `~/Applications`.
- `server.js` — hardened and made testable (below).
- `public/index.html` — sends the token, polls only while active.

## Runtime behaviour
- The server prints `Port desk is running at http://127.0.0.1:<port>`; the Swift side parses that line.
- With `PORT_DESK_EXIT_ON_STDIN_CLOSE=1` the server exits when its stdin closes. The Swift app gives node a stdin pipe, so node never outlives the app, even after a crash.
- The page polls every 4 s only while active. Swift calls `window.portDeskSetActive(true|false)` when the popover opens or closes. Opening the popover triggers an immediate refresh. Without the hook (plain browser use) the page stays active.

## Server hardening
- A random token is generated at startup and embedded in the page served at `/`. Every `/api/*` request must send it in `X-Port-Desk-Token`, otherwise 403.
- Every request must have `Host: 127.0.0.1:<port>`, otherwise 403 (blocks DNS rebinding).
- `POST /api/stop` requires `Content-Type: application/json`, otherwise 415 (closes the cross-origin simple-request path).
- The self-protection check also recognises the app bundle path (`Port desk.app/Contents/Resources/server/`), in addition to the existing `pid === selfPid` and `/port-desk/server.js` checks.

## Testing
- Existing listener tests stay.
- New server tests: token embedded in the page, 403 without or with a wrong token, 403 for a wrong Host, 415 for a non-JSON stop, a valid stop calls the injected kill, the exit-on-stdin-close behaviour and the stdout URL line.
- New listener test: the bundled-app path is protected as "This is Port desk."
- App: build it, launch it, confirm the node child starts and serves the tokenised page, stop a throwaway `python3 -m http.server` through the real API, and confirm Quit leaves no node process. The popover's look is checked by the user.
