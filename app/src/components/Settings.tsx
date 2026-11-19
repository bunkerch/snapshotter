import {
    ChevronRight,
    Clock3,
    Download,
    HardDrive,
    Info,
    LoaderCircle,
    Square,
    Wrench,
} from "lucide-react"
import { useState } from "react"
import { isPackagedHost, requestNative } from "../bridge"
import { message, scheduleLabel, weekdays } from "../lib/utils"
import type { ApplicationState, UpdateStatus } from "../model"

export function Settings({
    state,
    onState,
    onUpdateStatus,
    updateStatus,
    onInstall,
}: {
    state: ApplicationState
    onState: (state: ApplicationState) => void
    onUpdateStatus: (status: UpdateStatus) => void
    updateStatus?: UpdateStatus
    onInstall?: () => void
}) {
    const preferences = state.preferences
    const [retentionOpen, setRetentionOpen] = useState(false)
    const [retention, setRetention] = useState(preferences.retention)
    const [checking, setChecking] = useState(false)
    const [repairing, setRepairing] = useState(false)
    const [checkResult, setCheckResult] = useState<string>()
    const [acknowledgementsOpen, setAcknowledgementsOpen] = useState(false)
    const [disconnectOpen, setDisconnectOpen] = useState(false)
    const [disconnecting, setDisconnecting] = useState(false)
    const [savingRetention, setSavingRetention] = useState(false)
    const [settingsError, setSettingsError] = useState<string>()
    const [checkingUpdate, setCheckingUpdate] = useState(false)
    const [updateMessage, setUpdateMessage] = useState<string>()
    const packaged = isPackagedHost()

    const updateSchedule = async (
        changes: Partial<typeof preferences.schedule>,
    ) => {
        try {
            onState(
                await requestNative<ApplicationState>("schedule.set", {
                    ...preferences.schedule,
                    ...changes,
                }),
            )
            setSettingsError(undefined)
        } catch (error) {
            setSettingsError(message(error))
        }
    }

    const updateLaunchAtLogin = async () => {
        try {
            onState(
                await requestNative<ApplicationState>("launchAtLogin.set", {
                    enabled: !preferences.launchAtLogin,
                }),
            )
            setSettingsError(undefined)
        } catch (error) {
            setSettingsError(message(error))
        }
    }

    const updateAlwaysUpdate = async () => {
        try {
            onState(
                await requestNative<ApplicationState>("alwaysUpdate.set", {
                    enabled: !preferences.alwaysUpdate,
                }),
            )
            setSettingsError(undefined)
        } catch (error) {
            setSettingsError(message(error))
        }
    }

    const checkForUpdate = async () => {
        setCheckingUpdate(true)
        setUpdateMessage(undefined)
        try {
            const update = await requestNative<UpdateStatus>("update.check")
            onUpdateStatus(update)
            setUpdateMessage(
                update.available
                    ? `Update ${update.latestVersion} is available`
                    : "You're up to date",
            )
        } catch (error) {
            setUpdateMessage(message(error))
        } finally {
            setCheckingUpdate(false)
        }
    }

    const saveRetention = async () => {
        setSavingRetention(true)
        try {
            onState(
                await requestNative<ApplicationState>(
                    "retention.set",
                    retention,
                ),
            )
            setSettingsError(undefined)
            setRetentionOpen(false)
        } catch (error) {
            setSettingsError(message(error))
        } finally {
            setSavingRetention(false)
        }
    }

    const checkRepository = async () => {
        setChecking(true)
        setCheckResult(undefined)
        try {
            onState(await requestNative<ApplicationState>("repository.check"))
            setCheckResult("No issues found")
        } catch (error) {
            setCheckResult(message(error))
        } finally {
            setChecking(false)
        }
    }

    const repairRepositoryIndex = async () => {
        setRepairing(true)
        setCheckResult(undefined)
        try {
            onState(
                await requestNative<ApplicationState>("repository.repairIndex"),
            )
            setCheckResult("Index repaired and verified")
        } catch (error) {
            setCheckResult(message(error))
        } finally {
            setRepairing(false)
        }
    }

    const cancelMaintenance = async () => {
        setCheckResult("Cancelling…")
        try {
            await requestNative<boolean>("operation.cancel")
        } catch (error) {
            setCheckResult(message(error))
        }
    }

    const disconnectRepository = async () => {
        const repositoryID = preferences.repository?.id
        if (!repositoryID) return
        setDisconnecting(true)
        try {
            onState(
                await requestNative<ApplicationState>("repository.disconnect", {
                    repositoryID,
                    secretStorage: preferences.repository?.secretStorage,
                }),
            )
        } catch (error) {
            setSettingsError(message(error))
            setDisconnectOpen(false)
        } finally {
            setDisconnecting(false)
        }
    }

    const timeValue = `${String(preferences.schedule.hour).padStart(2, "0")}:${String(preferences.schedule.minute).padStart(2, "0")}`
    return (
        <section className="page settings-page">
            {settingsError && (
                <div className="error-banner" role="alert">
                    {settingsError}
                </div>
            )}
            <h3>Repository</h3>
            <div className="settings-group">
                <div className="setting-row">
                    <HardDrive size={17} />
                    <span>
                        <strong>{preferences.repository?.name}</strong>
                        <small>{preferences.repository?.location}</small>
                    </span>
                </div>
                {!disconnectOpen ? (
                    <button
                        type="button"
                        className="setting-row"
                        onClick={() => setDisconnectOpen(true)}
                    >
                        <span>
                            <strong>Change repository</strong>
                            <small>Your backup data will not be deleted</small>
                        </span>
                        <ChevronRight size={15} />
                    </button>
                ) : (
                    <div className="disconnect-confirmation">
                        <span>
                            Disconnect this repository? Stored snapshots remain
                            untouched.
                        </span>
                        <button
                            type="button"
                            onClick={() => setDisconnectOpen(false)}
                            disabled={disconnecting}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="destructive-button"
                            onClick={() => void disconnectRepository()}
                            disabled={disconnecting}
                        >
                            {disconnecting ? "Disconnecting…" : "Disconnect"}
                        </button>
                    </div>
                )}
            </div>
            <h3>Schedule</h3>
            <div className="settings-group">
                <label>
                    <span>
                        <strong>Automatic backups</strong>
                        <small>{scheduleLabel(state)}</small>
                    </span>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={preferences.schedule.enabled}
                        className={`switch ${preferences.schedule.enabled ? "on" : ""}`}
                        aria-label="Automatic backups"
                        onClick={() =>
                            void updateSchedule({
                                enabled: !preferences.schedule.enabled,
                            })
                        }
                    >
                        <span />
                    </button>
                </label>
                <label>
                    <span>
                        <strong>Start at login</strong>
                        {!packaged && (
                            <small>Available in the packaged app</small>
                        )}
                    </span>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={preferences.launchAtLogin}
                        className={`switch ${preferences.launchAtLogin ? "on" : ""}`}
                        aria-label="Start at login"
                        disabled={!packaged}
                        onClick={() => void updateLaunchAtLogin()}
                    >
                        <span />
                    </button>
                </label>
                {preferences.schedule.enabled && (
                    <div className="schedule-editor">
                        <div className="schedule-kind">
                            <button
                                type="button"
                                className={
                                    preferences.schedule.kind === "daily"
                                        ? "selected"
                                        : ""
                                }
                                aria-pressed={
                                    preferences.schedule.kind === "daily"
                                }
                                onClick={() =>
                                    void updateSchedule({ kind: "daily" })
                                }
                            >
                                Daily
                            </button>
                            <button
                                type="button"
                                className={
                                    preferences.schedule.kind === "weekly"
                                        ? "selected"
                                        : ""
                                }
                                aria-pressed={
                                    preferences.schedule.kind === "weekly"
                                }
                                onClick={() =>
                                    void updateSchedule({ kind: "weekly" })
                                }
                            >
                                Weekly
                            </button>
                        </div>
                        {preferences.schedule.kind === "weekly" && (
                            <select
                                aria-label="Backup weekday"
                                value={preferences.schedule.weekday}
                                onChange={(event) =>
                                    void updateSchedule({
                                        weekday: Number(event.target.value),
                                    })
                                }
                            >
                                {weekdays.map((day, index) => (
                                    <option value={index} key={day}>
                                        {day}
                                    </option>
                                ))}
                            </select>
                        )}
                        <input
                            aria-label="Backup time"
                            type="time"
                            value={timeValue}
                            onChange={(event) => {
                                const [hour, minute] = event.target.value
                                    .split(":")
                                    .map(Number)
                                void updateSchedule({ hour, minute })
                            }}
                        />
                    </div>
                )}
            </div>
            <h3>Retention</h3>
            <div className="settings-group">
                <button
                    type="button"
                    className="setting-row"
                    onClick={() => setRetentionOpen((open) => !open)}
                >
                    <Clock3 size={17} />
                    <span>
                        <strong>Smart retention</strong>
                        <small>
                            {preferences.retention.daily} daily ·{" "}
                            {preferences.retention.weekly} weekly ·{" "}
                            {preferences.retention.monthly} monthly
                        </small>
                    </span>
                    <ChevronRight
                        className={retentionOpen ? "expanded" : ""}
                        size={15}
                    />
                </button>
                {retentionOpen && (
                    <div className="retention-editor">
                        <p>
                            Keep one snapshot for each period. Applied after
                            every successful backup; the newest snapshot is
                            always kept.
                        </p>
                        {(["daily", "weekly", "monthly"] as const).map(
                            (period) => (
                                <label key={period}>
                                    <span>
                                        {period[0].toUpperCase() +
                                            period.slice(1)}
                                    </span>
                                    <input
                                        type="number"
                                        min="0"
                                        max="999"
                                        value={retention[period]}
                                        onChange={(event) =>
                                            setRetention((current) => ({
                                                ...current,
                                                [period]: Number(
                                                    event.target.value,
                                                ),
                                            }))
                                        }
                                    />
                                </label>
                            ),
                        )}
                        <button
                            type="button"
                            className="primary-button"
                            disabled={savingRetention}
                            onClick={() => void saveRetention()}
                        >
                            {savingRetention ? "Applying…" : "Apply"}
                        </button>
                    </div>
                )}
            </div>
            <h3>Maintenance</h3>
            <div className="settings-group">
                <button
                    type="button"
                    className="setting-row"
                    onClick={() =>
                        void (checking
                            ? cancelMaintenance()
                            : checkRepository())
                    }
                    disabled={repairing}
                >
                    {checking ? (
                        <Square size={15} fill="currentColor" />
                    ) : (
                        <Wrench size={17} />
                    )}
                    <span>
                        <strong>
                            {checking ? "Cancel check" : "Check repository"}
                        </strong>
                        {checkResult && <small>{checkResult}</small>}
                    </span>
                </button>
                <button
                    type="button"
                    className="setting-row"
                    onClick={() =>
                        void (repairing
                            ? cancelMaintenance()
                            : repairRepositoryIndex())
                    }
                    disabled={checking}
                >
                    {repairing ? (
                        <Square size={15} fill="currentColor" />
                    ) : (
                        <Wrench size={17} />
                    )}
                    <span>
                        <strong>
                            {repairing ? "Cancel repair" : "Repair index"}
                        </strong>
                        <small>
                            Rebuild repository metadata from stored packs
                        </small>
                    </span>
                </button>
            </div>
            <h3>Updates</h3>
            <div className="settings-group">
                <label>
                    <span>
                        <strong>Automatically install updates</strong>
                        <small>
                            Check once a day and update without asking
                        </small>
                    </span>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={preferences.alwaysUpdate}
                        className={`switch ${preferences.alwaysUpdate ? "on" : ""}`}
                        aria-label="Automatically install updates"
                        onClick={() => void updateAlwaysUpdate()}
                    >
                        <span />
                    </button>
                </label>
                <button
                    type="button"
                    className="setting-row"
                    onClick={() => void checkForUpdate()}
                    disabled={checkingUpdate}
                >
                    {checkingUpdate ? (
                        <LoaderCircle className="spinner" size={17} />
                    ) : (
                        <Download size={17} />
                    )}
                    <span>
                        <strong>
                            {checkingUpdate
                                ? "Checking for updates…"
                                : "Check for updates"}
                        </strong>
                        {updateMessage && <small>{updateMessage}</small>}
                    </span>
                </button>
                {updateStatus?.available && !updateStatus.installing && (
                    <button
                        type="button"
                        className="setting-row"
                        onClick={onInstall}
                    >
                        <Download size={17} />
                        <span>
                            <strong>
                                Update now to {updateStatus.latestVersion}
                            </strong>
                            <small>
                                Download, install, and relaunch automatically
                            </small>
                        </span>
                    </button>
                )}
                {updateStatus?.installing && (
                    <div className="setting-row" role="status">
                        <LoaderCircle className="spinner" size={17} />
                        <span>
                            <strong>Installing update…</strong>
                            <small>
                                The app will restart when the update is ready
                            </small>
                        </span>
                    </div>
                )}
            </div>
            <h3>About</h3>
            <div className="settings-group">
                <button
                    type="button"
                    className="setting-row"
                    onClick={() => setAcknowledgementsOpen((open) => !open)}
                >
                    <Info size={17} />
                    <span>
                        <strong>Open Source Acknowledgements</strong>
                        <small>Software that makes Snapshotter possible</small>
                    </span>
                    <ChevronRight
                        className={acknowledgementsOpen ? "expanded" : ""}
                        size={15}
                    />
                </button>
                {acknowledgementsOpen && (
                    <div className="acknowledgements">
                        <strong>restic 0.19.1</strong>
                        <span>
                            Fast, secure backup engine · BSD 2-Clause License
                        </span>
                        <span>
                            Copyright © 2014 Alexander Neumann and contributors
                        </span>
                        <button
                            type="button"
                            onClick={async () => {
                                try {
                                    await requestNative("url.open", {
                                        url: "https://github.com/restic/restic/blob/v0.19.1/LICENSE",
                                    })
                                    setSettingsError(undefined)
                                } catch (error) {
                                    setSettingsError(message(error))
                                }
                            }}
                        >
                            View license
                        </button>
                    </div>
                )}
            </div>
        </section>
    )
}
