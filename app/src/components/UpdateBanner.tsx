import type { UpdateStatus } from "../model"

export function UpdateBanner({
    update,
    onInstall,
    onDismiss,
}: {
    update: UpdateStatus
    onInstall: () => void
    onDismiss: () => void
}) {
    if (update.installing) {
        return (
            <div className="update-banner" role="status">
                <span className="update-banner-text">
                    <strong>Updating Snapshotter…</strong>
                    <small>The app will restart when the update is ready</small>
                </span>
            </div>
        )
    }
    return (
        <div className="update-banner" role="status">
            <div className="update-banner-text">
                <strong>Snapshotter {update.latestVersion} is available</strong>
                <small>Current version: {update.currentVersion}</small>
            </div>
            <div className="update-banner-actions">
                <button
                    type="button"
                    className="primary-button"
                    onClick={onInstall}
                >
                    Update now
                </button>
                <button type="button" onClick={onDismiss}>
                    Later
                </button>
            </div>
        </div>
    )
}
