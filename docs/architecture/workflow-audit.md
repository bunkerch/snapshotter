# Workflow audit

## Findings and fixes

- Backup status and scheduling now use snapshots from this hostname with the current enabled source paths. Adding a folder makes the new source set due; snapshots from another Mac do not satisfy the schedule.
- Disabled sources cannot trigger backups. Migrating an old hourly schedule preserves its disabled state. Partial schedule edits preserve other fields.
- Background failures reach the interface. Scheduled completion refreshes snapshots and clears activity even if the progress timer misses the final tick.
- Competing cancellable native operations are rejected instead of queued behind a restore.
- Folder errors remain visible; failed exclusion saves retain the draft. Failed snapshot browsing clears stale entries and offers Retry.
- Restore and maintenance keep their active view mounted. Selected restore files can be deselected.
- Update checks report network failures. Stable releases correctly supersede their release candidates.
- Update installation stages the replacement beside the running app, waits for normal shutdown, and retains the old bundle for rollback if replacement or launch fails. A successful launch command does not prove the new process remains healthy.
- Copy uses factual backup status and shorter action labels. Duplicate Settings navigation and redundant explanations were removed. The time editor now fits its value and wraps on narrow layouts.

## Verification

- 26 frontend tests and production build passed.
- 8 native tests passed with warnings treated as errors, including competing restores and filesystem installer success/rollback.
- Full Go race suite passed; source/hostname scheduling uses a real temporary restic repository.
- Setup, overview, snapshots, and settings were visually inspected at 390×540 with a simulated native bridge. This verifies layout, not WKWebView event delivery.

## Remaining acceptance checks

- Restore from the actual remote repository on the destination Mac.
- Live 1Password authorization and scheduled backup after login without opening the popover.
- Signed app update/relaunch on macOS and notarized release delivery. Release publication remains blocked by the previously reported Apple credential rejection.
