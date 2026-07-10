# Snapshotter

A native macOS menu bar backup manager powered by restic.

## Project layout

- `app/` — React and TypeScript interface
- `macos/` — native Swift menu bar host and system integration
- `engine/` — Go backup-domain service and restic integration boundary

## Development

Install dependencies once:

```sh
zsh -ic 'pnpm install'
```

Then run the app from the repository root using two terminals.

Terminal 1 starts the React development server:

```sh
zsh -ic 'pnpm dev'
```

Wait until Vite prints `http://localhost:4173/`. Terminal 2 starts the native
menu-bar host:

```sh
make engine
swift run --package-path macos
```

A shield icon appears in the macOS menu bar. Click it to open the app. No Dock
icon or regular window appears because Snapshotter runs as a menu-bar accessory.
Stop the native process with **Control-C**, or click **Quit** in the popover.

If the shield is not visible, check the menu-bar overflow area and confirm the
Vite terminal is still running. Build each layer independently with:

```sh
zsh -ic 'pnpm build'
make engine
swift build --package-path macos
cd engine && go test -race ./...
```

The host loads the Vite server in debug builds. Release packaging will bundle the
generated web assets into the application.

## Architecture

The app never shells out to the restic executable. The Go engine is linked into the
native application and exposes a small asynchronous API. Credentials are stored in
the macOS Keychain by the native layer and are never persisted in the UI state.
