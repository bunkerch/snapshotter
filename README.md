# Snapshotter

A native macOS menu bar backup manager powered by restic.

Snapshotter supports local folders, S3-compatible object storage, SFTP, and
rest-server destinations. Repository encryption passwords and remote service
credentials can be stored in macOS Keychain or a synced 1Password vault. SFTP uses the system SSH agent,
configuration, and keys.

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
Stop the native process with **Control-C**. In a packaged build, right-click the
menu-bar icon and choose **Quit Snapshotter**.

Debug builds enable WKWebView inspection. Right-click inside the popover and
choose **Inspect Element**, or attach through Safari's **Develop** menu.

If the shield is not visible, check the menu-bar overflow area and confirm the
Vite terminal is still running. Build each layer independently with:

```sh
zsh -ic 'pnpm build'
make engine
swift build --package-path macos
cd engine && go test -race ./...
```

Before publishing a change, run the complete release gate:

```sh
make verify
```

This checks Biome, UI tests, the production frontend, Go race tests, strict
Swift compilation, app signing, the bundle plist, and DMG integrity.

Remote backends have an opt-in live lifecycle test. Supply a unique test
repository location and credentials through `SNAPSHOTTER_TEST_REPOSITORY_*`
environment variables, then run:

```sh
cd engine
go test ./resticadapter -run '^TestLiveRemoteRepository$' -count=1
```

The test creates an encrypted repository, backs up and restores a file, checks
the repository, then deletes the snapshot and prunes its data. Never target a
production repository.

The host loads the Vite server in debug builds. Release packaging will bundle the
generated web assets into the application.

## Packaging

Create a signed application bundle at `build/Snapshotter.app`:

```sh
make app
open build/Snapshotter.app
```

Packaging automatically uses the first valid identity in the login Keychain. A
specific identity can be selected for a distributable build:

```sh
CODESIGN_IDENTITY="Developer ID Application: Example (TEAMID)" make app
```

Use `CODESIGN_IDENTITY=- make app` only for a throwaway build. Ad-hoc signatures
change when the application changes, so macOS cannot persist Keychain access for
them across builds.

Create a compressed installer image at `build/Snapshotter.dmg`:

```sh
make dmg
```

For release distribution, configure an Apple notary profile and sign with your
Developer ID. The disk image is submitted, stapled, and verified automatically:

```sh
CODESIGN_IDENTITY="Developer ID Application: Example (TEAMID)" \
NOTARY_PROFILE="snapshotter-notary" make dmg
```

## Architecture

The app never shells out to the restic executable. The Go engine is linked into the
native application and exposes a small asynchronous API. Credentials are never
persisted in UI state. Keychain storage is handled by the native layer; optional
1Password storage uses the official Go SDK and the 1Password desktop app.

To use 1Password storage, install and sign in to 1Password for Mac, then enable
**Settings > Developer > Integrate with other apps**. Enable Touch ID under
**Settings > Security** to authorize Snapshotter with biometrics. During repository
setup, select 1Password, enter the account name shown in the app, authorize access,
and choose a vault. Snapshotter stores only the account, vault ID, and item ID in its
preferences. The repository password and remote-backend credentials remain in the
synced 1Password item. On another Mac, choose **Open existing**, select the same
vault, and use the synced Snapshotter item instead of entering the secrets again.
Disconnecting a repository leaves its synced item in 1Password so other devices do
not lose access; remove that item manually when it is no longer needed anywhere.

The official SDK loads 1Password's signed IPC client library from the desktop app.
Because that library is signed by 1Password rather than Snapshotter, packaged builds
use the hardened-runtime library-validation exception required for this integration.
