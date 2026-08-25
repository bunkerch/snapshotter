# ADR: GitHub Release Auto-Updater

## Status

Accepted

## Context

Snapshotter ships as a signed, notarized macOS app released on GitHub under
`bunkerch/snapshotter`. Users had to manually discover and install new builds.
We want to check for new releases once a day, offer to update in-app, and be
able to update automatically without being asked.

## Decisions

### Where the work runs
All networking and the install/relaunch live in the **Swift host** (`Updater.swift`),
not the Go engine. Reasons:

- The Go engine's `handle` holds a mutex across the whole request; a long
  download would block backups. Swift runs the updater on its own serial
  queue alongside the existing 60s schedule timer.
- The host already owns the WKWebView and can push JS events, and it owns the
  release bundle path used for the in-place swap/relaunch.

### Release source
The updater queries `GET /repos/bunkerch/snapshotter/releases/latest` and, when
a newer version exists, downloads the `Snapshotter-<version>-macOS.zip` asset.
Only stable releases appear on the `latest` endpoint; prereleases are excluded.

### Preferences and cadence
The user-facing setting lives in the shared preferences file as a new
`alwaysUpdate` boolean in `domain.Preferences` (so the settings screen reads
and writes it through the normal `state.get` / `alwaysUpdate.set` flow). The
internal `lastUpdateCheck` timestamp is stored in Swift `UserDefaults`; the
weekly-ish daily check is throttled to 24h from the existing 60s timer and runs
early on launch.

### Prompt vs. automatic install
- `alwaysUpdate` off: the host streams an `__snapshotterUpdate` event and the
  web interface shows an in-app banner with **Update now** / **Later**.
- `alwaysUpdate` on: the host downloads and installs silently and relaunches.

The frontend also reads `update.status` when the popover mounts so the banner
appears even if the check happened before the popover opened.

### Install safety
- The update is only installed when no engine operation is running, to avoid
  relaunching mid-backup.
- The downloaded bundle is code-signature verified (`codesign --verify --deep
  --strict`) before swapping; an unsigned development build is refused.
- The swap is performed by a detached helper script that waits for the running
  app to exit, replaces the bundle, and `open`s the new build.

## Consequences
- Releases must be signed and notarized by CI (already true) and must publish
  the `Snapshotter-<version>-macOS.zip` asset (already true).
- A pre-release or development build is never auto-installed; if signature
  verification fails the app falls back to asking the user.
- The repo owner/name is hardcoded in `Updater.swift` and must be updated if
  the project moves.
