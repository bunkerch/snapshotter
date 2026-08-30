import {
    ChevronRight,
    Folder,
    Play,
    Plus,
    ShieldCheck,
    Square,
    Trash2,
} from "lucide-react"
import { useState } from "react"
import { requestNative } from "../bridge"
import {
    basename,
    compactPresetPath,
    formatBytes,
    formatCount,
    formatDate,
    formatRelative,
    message,
    normalizeState,
    scheduleLabel,
} from "../lib/utils"
import type { ApplicationState, BackupProgress } from "../model"
import { SectionTitle } from "./SectionTitle"

export function Overview({
    state,
    running,
    progress,
    onBackup,
    onCancel,
    onAddSources,
    onAddSourcePath,
    onSnapshots,
    onState,
}: {
    state: ApplicationState
    running: boolean
    progress?: BackupProgress
    onBackup: () => void
    onCancel: () => void
    onAddSources: () => Promise<void>
    onAddSourcePath: (path: string) => Promise<void>
    onSnapshots: () => void
    onState: (state: ApplicationState) => void
}) {
    const latest = state.snapshots[0]
    const [sourceEditorOpen, setSourceEditorOpen] = useState(false)
    const [sourcePath, setSourcePath] = useState("")
    const [sourceError, setSourceError] = useState<string>()
    const [addingSource, setAddingSource] = useState(false)
    const [busySourceID, setBusySourceID] = useState<string>()

    const addTypedSource = async () => {
        setAddingSource(true)
        try {
            await onAddSourcePath(sourcePath)
            setSourcePath("")
            setSourceError(undefined)
            setSourceEditorOpen(false)
        } catch (error) {
            setSourceError(message(error))
        } finally {
            setAddingSource(false)
        }
    }
    const setSourceEnabled = async (id: string, enabled: boolean) => {
        setBusySourceID(id)
        try {
            onState(
                await requestNative<ApplicationState>("source.setEnabled", {
                    id,
                    enabled,
                }),
            )
            setSourceError(undefined)
        } catch (error) {
            setSourceError(message(error))
        } finally {
            setBusySourceID(undefined)
        }
    }
    const removeSource = async (id: string) => {
        setBusySourceID(id)
        try {
            onState(
                await requestNative<ApplicationState>("source.remove", { id }),
            )
            setSourceError(undefined)
        } catch (error) {
            setSourceError(message(error))
        } finally {
            setBusySourceID(undefined)
        }
    }
    return (
        <>
            <section className="hero-card">
                <div className={`status-orb ${running ? "working" : ""}`}>
                    <ShieldCheck />
                </div>
                <div className="hero-copy">
                    <h1>
                        {running
                            ? "Backing up…"
                            : latest
                              ? "Protected"
                              : "Ready for first backup"}
                    </h1>
                    <p>
                        {running && progress && progress.filesDone > 0
                            ? `${formatCount(progress.filesDone)} files · ${formatBytes(progress.bytesDone)}`
                            : latest
                              ? `Last backup ${formatRelative(latest.time)}`
                              : `${state.preferences.sources.length + state.preferences.selectedApps.length} sources selected`}
                    </p>
                </div>
                <button
                    type="button"
                    className={running ? "cancel-button" : "primary-button"}
                    onClick={running ? onCancel : onBackup}
                    disabled={
                        !running &&
                        state.preferences.sources.length === 0 &&
                        state.preferences.selectedApps.length === 0
                    }
                >
                    {running ? (
                        <Square size={11} fill="currentColor" />
                    ) : (
                        <Play size={13} fill="currentColor" />
                    )}
                    {running ? "Cancel" : "Back up"}
                </button>
                {running && (
                    <div className="progress">
                        <span />
                    </div>
                )}
            </section>
            <div className="summary-strip">
                <span>{state.preferences.repository?.name}</span>
                <i />
                <span>
                    {state.preferences.schedule.enabled
                        ? scheduleLabel(state)
                        : "Manual backups"}
                </span>
            </div>
            <SectionTitle
                title="Folders"
                action="Add"
                icon={<Plus size={12} />}
                onAction={() => setSourceEditorOpen((open) => !open)}
            />
            {sourceEditorOpen && (
                <div className="source-editor">
                    <input
                        aria-label="Folder path"
                        placeholder="~/Documents or /Users/you/Projects"
                        value={sourcePath}
                        onChange={(event) => setSourcePath(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && sourcePath.trim()) {
                                void addTypedSource()
                            }
                        }}
                    />
                    <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void onAddSources()}
                    >
                        Browse…
                    </button>
                    <button
                        type="button"
                        className="primary-button"
                        disabled={!sourcePath.trim() || addingSource}
                        onClick={() => void addTypedSource()}
                    >
                        Add
                    </button>
                    {sourceError && (
                        <span className="form-error" role="alert">
                            {sourceError}
                        </span>
                    )}
                </div>
            )}
            <section className="list-card source-list">
                {state.preferences.sources.length === 0 && (
                    <div className="empty-row">Add a folder to back it up</div>
                )}
                {state.preferences.sources.map((source) => (
                    <div className="source-row" key={source.id}>
                        <div className="folder-icon">
                            <Folder />
                        </div>
                        <div className="row-copy">
                            <strong>{basename(source.path)}</strong>
                            <small>{source.path}</small>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={source.enabled}
                            className={`switch source-switch ${source.enabled ? "on" : ""}`}
                            aria-label={`${source.enabled ? "Disable" : "Enable"} ${basename(source.path)}`}
                            disabled={busySourceID === source.id}
                            onClick={() =>
                                void setSourceEnabled(
                                    source.id,
                                    !source.enabled,
                                )
                            }
                        >
                            <span />
                        </button>
                        <button
                            type="button"
                            className="icon-button source-remove"
                            aria-label={`Remove ${basename(source.path)}`}
                            disabled={busySourceID === source.id}
                            onClick={() => void removeSource(source.id)}
                        >
                            <Trash2 size={13} />
                        </button>
                    </div>
                ))}
            </section>
            <BackupContentControls state={state} onState={onState} />
            <SectionTitle
                title="Recent"
                action="All snapshots"
                onAction={onSnapshots}
            />
            <section className="list-card snapshot-list">
                {state.snapshots.length === 0 && (
                    <div className="empty-row">
                        No snapshots yet — your first backup is one click away
                    </div>
                )}
                {state.snapshots.slice(0, 2).map((snapshot) => (
                    <button
                        type="button"
                        className="snapshot-row"
                        key={snapshot.id}
                        onClick={onSnapshots}
                    >
                        <div className="snapshot-dot" />
                        <div className="row-copy">
                            <strong>{formatDate(snapshot.time)}</strong>
                            <small>{formatRelative(snapshot.time)}</small>
                        </div>
                        <ChevronRight size={15} />
                    </button>
                ))}
            </section>
        </>
    )
}

export function BackupContentControls({
    state,
    onState,
}: {
    state: ApplicationState
    onState: (state: ApplicationState) => void
}) {
    const [applicationsOpen, setApplicationsOpen] = useState(false)
    const [exclusionsOpen, setExclusionsOpen] = useState(false)
    const [customExclusion, setCustomExclusion] = useState("")
    const [contentError, setContentError] = useState<string>()
    const [pending, setPending] = useState(false)

    const update = async (type: string, payload: object) => {
        setPending(true)
        try {
            onState(
                normalizeState(
                    await requestNative<ApplicationState>(type, payload),
                ),
            )
            setContentError(undefined)
        } catch (error) {
            setContentError(message(error))
        } finally {
            setPending(false)
        }
    }

    const addExclusion = async () => {
        if (!customExclusion.trim()) return
        await update("exclusion.add", { pattern: customExclusion })
        setCustomExclusion("")
    }

    return (
        <section className="backup-content">
            <SectionTitle
                title="Applications"
                action={applicationsOpen ? "Hide" : "Choose"}
                onAction={() => setApplicationsOpen((open) => !open)}
            />
            {!applicationsOpen &&
                state.applicationPresets.some(
                    (application) => application.enabled,
                ) && (
                    <div className="selected-apps">
                        {state.applicationPresets
                            .filter((application) => application.enabled)
                            .map((application) => application.name)
                            .join(", ")}
                    </div>
                )}
            {applicationsOpen && (
                <div className="choice-editor">
                    {state.applicationPresets.map((application) => (
                        <label
                            key={application.id}
                            className={
                                !application.available ? "unavailable" : ""
                            }
                        >
                            <span>
                                <strong>{application.name}</strong>
                                <small title={application.paths.join("\n")}>
                                    {application.available
                                        ? application.paths
                                              .map(compactPresetPath)
                                              .join(", ")
                                        : "Not installed"}
                                </small>
                            </span>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={application.enabled}
                                className={`switch ${application.enabled ? "on" : ""}`}
                                aria-label={`Back up ${application.name}`}
                                disabled={!application.available || pending}
                                onClick={() =>
                                    void update("application.setEnabled", {
                                        id: application.id,
                                        enabled: !application.enabled,
                                    })
                                }
                            >
                                <span />
                            </button>
                        </label>
                    ))}
                </div>
            )}
            <SectionTitle
                title="Exclusions"
                action={exclusionsOpen ? "Hide" : "Manage"}
                onAction={() => setExclusionsOpen((open) => !open)}
            />
            {!exclusionsOpen && (
                <div className="exclusion-summary">
                    {
                        state.preferences.exclusions.filter(
                            (rule) => rule.enabled,
                        ).length
                    }{" "}
                    active rules
                </div>
            )}
            {exclusionsOpen && (
                <div className="choice-editor exclusions-editor">
                    <p>
                        Skips reproducible dependencies, build output, and
                        caches inside every selected source.
                    </p>
                    {state.preferences.exclusions.map((exclusion) => (
                        <label key={exclusion.id}>
                            <span>
                                <strong className="pattern-label">
                                    {exclusion.pattern}
                                </strong>
                                <small>
                                    {exclusion.builtin ? "Built in" : "Custom"}
                                </small>
                            </span>
                            {!exclusion.builtin && (
                                <button
                                    type="button"
                                    className="row-action"
                                    aria-label={`Remove ${exclusion.pattern}`}
                                    disabled={pending}
                                    onClick={() =>
                                        void update("exclusion.remove", {
                                            id: exclusion.id,
                                        })
                                    }
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                            <button
                                type="button"
                                role="switch"
                                aria-checked={exclusion.enabled}
                                className={`switch ${exclusion.enabled ? "on" : ""}`}
                                aria-label={`${exclusion.enabled ? "Disable" : "Enable"} ${exclusion.pattern}`}
                                disabled={pending}
                                onClick={() =>
                                    void update("exclusion.setEnabled", {
                                        id: exclusion.id,
                                        enabled: !exclusion.enabled,
                                    })
                                }
                            >
                                <span />
                            </button>
                        </label>
                    ))}
                    <form
                        className="exclusion-form"
                        onSubmit={(event) => {
                            event.preventDefault()
                            void addExclusion()
                        }}
                    >
                        <input
                            aria-label="Custom exclusion pattern"
                            value={customExclusion}
                            placeholder="**/.generated"
                            onChange={(event) =>
                                setCustomExclusion(event.target.value)
                            }
                        />
                        <button
                            type="submit"
                            disabled={!customExclusion.trim() || pending}
                        >
                            Add
                        </button>
                    </form>
                </div>
            )}
            {contentError && (
                <div className="form-error" role="alert">
                    {contentError}
                </div>
            )}
        </section>
    )
}
