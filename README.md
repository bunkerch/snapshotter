# Restic App

A native macOS menu bar backup manager powered by restic.

## Project layout

- `app/` — React and TypeScript interface
- `macos/` — native Swift menu bar host and system integration
- `engine/` — Go backup-domain service and restic integration boundary

## Development

```sh
pnpm install
pnpm dev
```

In another terminal, launch the native host with `swift run --package-path macos`.
The host loads the Vite server in debug builds and bundled assets in release builds.

## Architecture

The app never shells out to the restic executable. The Go engine is linked into the
native application and exposes a small asynchronous API. Credentials are stored in
the macOS Keychain by the native layer and are never persisted in the UI state.

