# Repository Guidelines

## Project Structure & Module Organization

- `app/` contains the React and TypeScript interface, including colocated tests in `app/src/`.
- `macos/` is a Swift Package containing the native `NSStatusItem`, popover, WKWebView host, Keychain access, and macOS lifecycle integration.
- `engine/` is the Go module. Domain types are in `domain/`, persistence in `config/`, scheduling in `schedule/`, application contracts in `service/`, and embedded restic code in `resticadapter/`.
- `docs/architecture/` records important design decisions.
- `dist/` and `.build/` are generated outputs and must not be committed.

## Build, Test, and Development Commands

Use the `pnpm` resolved by interactive zsh; it includes the local safe-chain protection layer.

```sh
zsh -ic 'pnpm install'       # install JavaScript dependencies
zsh -ic 'pnpm dev'           # run Vite on localhost:4173
zsh -ic 'pnpm build'         # type-check and build production assets
zsh -ic 'pnpm test'          # run Vitest with jsdom
zsh -ic 'pnpm lint'          # run Biome checks
make engine                  # build the embedded Go dynamic library
swift run --package-path macos
cd engine && go test -race ./...
```

Run Vite before the Swift host during debug development.

## Coding Style & Naming Conventions

Biome is authoritative for JavaScript, TypeScript, JSON, and Markdown: four-space indentation, double quotes, and semicolons only when required. Run `pnpm format` before committing. Use PascalCase for React components and Swift types, camelCase for functions and variables, and lowercase Go package names. Format Go with `gofmt`; follow standard Swift formatting and concurrency rules.

## Testing Guidelines

Place TypeScript tests beside their subject as `*.test.ts(x)` and Go tests as `*_test.go`. New repository behavior should use temporary real restic repositories rather than CLI mocks. Run frontend tests, the production build, and `go test -race ./...` before opening a pull request. Native changes must pass `swift build --package-path macos`.

## Commit & Pull Request Guidelines

Use short Conventional Commit subjects matching history, such as `feat: list embedded restic snapshots` or `fix: resolve Swift package entry point`. Keep commits focused and allow the Husky/lint-staged hook to run. Pull requests should explain behavior and architecture changes, list verification commands, link relevant issues, and include screenshots for visible UI changes.

## Security & Architecture

Never persist repository passwords outside macOS Keychain or log secrets. Do not invoke the restic CLI. Restic is pinned and embedded as a Go module; keep its internal types contained within `engine/resticadapter/`. Review `docs/architecture/restic-embedding.md` before changing the module path or dependency version.
