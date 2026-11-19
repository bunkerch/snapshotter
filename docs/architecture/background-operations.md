# Background operations and restore lifecycle

The native backend starts at application launch, independently of popover or
WKWebView creation. It unlocks the configured repository using Keychain or
1Password before the scheduler's first check. Unlock is idempotent: opening the
UI during startup must not request authorization twice. Secrets remain in the
engine's existing in-memory connection for the process lifetime.

Authorization and scheduled-operation failures must surface through the native
attention indicator, tooltip, and status menu. A locked repository is not a
successful scheduled backup. Quitting cancels work and waits for the engine queue
to finish before closing the engine, allowing repository locks to be released.

Restore destination selection is a separate bridge request from restoration.
Cancelling selection closes the native panel; it must not cancel an unrelated
engine operation. Once a destination is selected, restore reports preparation
and file/byte progress. A restore cannot start behind another cancellable
operation, and snapshot navigation/deletion is disabled during restoration.
Restic preserves the original path hierarchy beneath the selected destination
and uses its `OverwriteIfChanged` behavior.

Backup and restore hold shared restic locks; destructive maintenance holds an
exclusive lock. On lock contention, recovery removes only locks classified as
stale by the pinned restic implementation, then retries acquisition. Active and
invalid locks are never force-removed. No restic CLI subprocess is involved.

Legacy 1Password items may contain only password and backend credentials. Their
missing destination cannot be inferred from those secrets. Setup explains this
and saves the supplied location after connecting. Existing configured machines
also backfill this metadata on unlock. Failure to update recovery metadata warns
the user but does not disable otherwise functional backups.

## Verification

- `pnpm test`: real JavaScript bridge lifecycle, repeated restores, progress,
  picker cancellation, restore failures, and recovery form behavior.
- `go test -race ./...` in `engine`: temporary real restic repositories, repeated
  directory restores, cancellation/failure recovery, expired versus active
  locks, and scheduled backups after a single secret-store authorization.
- `swift test --package-path macos`: native startup authorization and scheduling
  without a web view, surfaced startup failures, and repeated native restores.
  Included in `make test`, `make verify`, and release checks.

Before releasing, also exercise the signed app with the actual 1Password desktop
integration: launch without opening the popover, authorize, verify an overdue
scheduled backup, then restore two directories from a remote repository. Repeat
with denied authorization and confirm the attention indicator and retry flow.
Automated native tests substitute the engine transport; they do not exercise
1Password's authorization dialog or a live remote backend.
