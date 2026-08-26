# Repository Guidelines

## Project Structure & Module Organization

- `app/` contains the React and TypeScript interface, including colocated tests in `app/src/`.
- `macos/` is a Swift Package containing the native `NSStatusItem`, popover, WKWebView host, Keychain access, and macOS lifecycle integration. The Go engine integrates with 1Password.
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

Place TypeScript tests beside their subject as `*.test.ts(x)` and Go tests as `*_test.go`. New repository behavior should use temporary real restic repositories rather than CLI mocks. Run frontend tests, the production build, and `go test -race ./...` before opening a pull request. Native changes must pass `swift build --package-path macos`. Run `make verify` before a release; it also assembles and validates the signed application and installer image.

## Commit & Pull Request Guidelines

Use short Conventional Commit subjects matching history, such as `feat: list embedded restic snapshots` or `fix: resolve Swift package entry point`. Keep commits focused and allow the Husky/lint-staged hook to run. Pull requests should explain behavior and architecture changes, list verification commands, link relevant issues, and include screenshots for visible UI changes. Every pull request description must state whether AI assistance was used: name the model and agent harness when it was (for example, "OpenCode with Anthropic Claude Opus 5"), or explicitly state the change was made manually.

## Releases (GitHub Actions)

Releases are built, signed, notarized, and published automatically by the
`.github/workflows/release.yml` workflow, which also generates an AI release
summary and a changelog-driven promotional banner. You only create and push a
tag; the workflow does the rest.

### Versioning

- Use Semantic Versioning and always increment from the last release.
- Version formats:
  - Stable: `vX.Y.Z` (for example `v1.0.1`).
  - Release candidate: `vX.Y.Z-rc.N` (for example `v1.0.2-rc.1`). RCs are marked
    as pre-releases. Any tag with a `-...` pre-release suffix is a pre-release.
- The changelog for a release diffs against the previous tag in semantic-version
  order: an RC diffs against the prior RC (or the last stable), and a stable
  release diffs against the last stable (skipping RCs of the same version) so it
  recapises the whole release line.

### Cutting a release

1. On `main`, ensure the intended changes are merged and the pipeline is green:
   `make verify`.
2. Create a tag for the version and push it (the workflow triggers on `v*` tags):
   ```sh
   git checkout main && git pull --ff-only origin main
   git tag v1.0.2-rc.1
   git push origin v1.0.2-rc.1
   ```
3. Watch the workflow run and wait for it to finish:
   ```sh
   gh run list --repo bunkerch/snapshotter --workflow release.yml
   gh run watch <run-id> --repo bunkerch/snapshotter
   ```
4. Verify the published release and its assets (DMG, zip, banner, AI summary):
   ```sh
   gh release view <tag> --repo bunkerch/snapshotter
   ```
5. To correct or re-test a release, push any fixes to `main`, then force-move the
   tag to the new `main` and re-push it to trigger a fresh run:
   ```sh
   git tag -f <tag> origin/main && git push -f origin <tag>
   ```

### Notes

- Pushing a `v1.2.3` tag creates a stable (non-pre) release; a
  `v1.2.3-rc.N` tag creates a pre-release. Publish RCs first, then the stable
  tag once they're validated.
- The build and release jobs need the signing/notarization and `OPENCODE_*`
  repository secrets configured; see the README "Releases" section.

## Security & Architecture

Persist repository passwords only in macOS Keychain or a user-selected 1Password vault, and never log secrets. Do not invoke the restic CLI. Restic is pinned and embedded as a Go module; keep its internal types contained within `engine/resticadapter/`. Review `docs/architecture/restic-embedding.md` before changing the module path or dependency version.
