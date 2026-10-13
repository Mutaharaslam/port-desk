# Port desk

Lists the TCP ports that are listening on this Mac and lets you stop your own project servers.

## As a Mac app

```sh
npm run app
```

Runs the tests, builds the menu bar app and installs it to `~/Applications/Port desk.app`. Open it from Spotlight or Launchpad; it lives in the menu bar (no Dock icon). Click the icon to open the list, right-click for Refresh, Open at login and Quit. Opening it again while it runs just shows the list.

The app bundles a copy of the `node` that built it, so it keeps working if you switch Node versions. Rebuild with `npm run app` after changing the code. It is signed ad hoc for this Mac only and is Apple silicon only.

## In a browser

```sh
npm start
```

Prints the address (`http://127.0.0.1:3999`, or the next free port up to 4010).

## Tests

```sh
npm test
```
