# Contributing to Snapshotter

Thanks for your interest in improving Snapshotter, a native macOS menu bar backup
manager powered by restic. This guide explains how to set up the project, make
changes, and get them merged.

## Prerequisites

- [Node.js / pnpm](https://pnpm.io) for the `app/` web interface (use the `pnpm`
  resolved by interactive zsh, which includes the local safe-chain protection
  layer).
- [Go](https://go.dev) for the `engine/` module.
- [Swift](https://www.swift.org) for the `macos/` native host.
- macOS, to run the menu-bar app end to end.

## Getting started

```bash
git clone https://github.com/<you>/snapshotter.git
cd snapshotter
zsh -ic 'pnpm install'
```

Useful commands:

| Command | What it does |
| --- | --- |
| `zsh -ic 'pnpm dev'` | Run Vite on `localhost:4173` |
| `zsh -ic 'pnpm build'` | Type-check and build production assets |
| `zsh -ic 'pnpm test'` | Run Vitest with jsdom |
| `zsh -ic 'pnpm lint'` | Run Biome checks |
| `make engine` | Build the embedded Go dynamic library |
| `swift run --package-path macos` | Run the native menu-bar host |
| `cd engine && go test -race ./...` | Run Go tests with the race detector |
| `make verify` | Full release gate (Biome, UI tests, frontend, Go, Swift, signing, DMG) |

## Project layout

- `app/` — React and TypeScript interface, with colocated tests in `app/src/`.
- `macos/` — Swift package hosting the `NSStatusItem`, popover, WKWebView host,
  Keychain access, and macOS lifecycle integration. The Go engine integrates with
  1Password.
- `engine/` — Go module. Domain types in `domain/`, persistence in `config/`,
  scheduling in `schedule/`, application contracts in `service/`, and embedded
  restic code in `resticadapter/`.
- `docs/architecture/` — design decision records.
- `dist/` and `.build/` — generated outputs, never committed.

## Making changes

1. Create a topic branch from `main`.
2. Make your change, matching the existing style: Biome is authoritative for
   JavaScript, TypeScript, JSON, and Markdown (four-space indentation, double
   quotes); format Go with `gofmt`; follow standard Swift formatting and
   concurrency rules.
3. Add or update tests — behavior changes need regression coverage. Put
   TypeScript tests beside their subject as `*.test.ts(x)` and Go tests as
   `*_test.go`.
4. Run the local gates before opening a pull request:
   `zsh -ic 'pnpm test'`, `zsh -ic 'pnpm build'`, `zsh -ic 'pnpm lint'`, and
   `cd engine && go test -race ./...`. Native changes must pass
   `swift build --package-path macos`. Run `make verify` before a release.
5. Commit with a short Conventional Commit subject matching history, such as
   `feat: list embedded restic snapshots` or `fix: resolve Swift package entry
   point`. Keep commits focused and let the Husky/lint-staged hook run.
6. Open a pull request against `main` describing the problem, the approach, and
   how you verified it. Link the related issue (`Closes #NN`) when one exists,
   and include screenshots for visible UI changes.

### AI attribution

Transparency about how a change was produced helps reviewers, so every pull
request must state whether AI assistance was used. In the pull request
description, always:

- name the model and agent harness used when the change was made with AI (for
  example, "OpenCode with Anthropic Claude", "OpenCode with GPT-5.2", "Cursor",
  "Claude Code"), or
- explicitly state that the change was made manually, with no AI assistance.

## CI and releases

- Every pull request runs the frontend tests, production build, lint, and Go
  race tests via GitHub Actions. All checks must pass before merge.
- Releases are built from tags: `v1.2.3` for stable, `v1.2.3-rc.1` /
  `v1.2.3-beta.1` for pre-releases. The `release.yml` workflow builds a signed
  and notarized `.app` and `.dmg` on a `macos-14` runner and publishes a GitHub
  Release. Merging to `main` does not ship; releases are tag-driven.

## Reporting bugs and requesting features

Open an issue describing the problem. For bugs, include your Snapshotter version,
macOS version, destination type, and reproduction steps. Never include passwords,
credentials, or repository secrets in an issue or pull request — see the Security
section of `AGENTS.md` for how secrets are handled.

For security issues, do not open a public issue. Report the problem to the
maintainers privately through GitHub's private vulnerability reporting.