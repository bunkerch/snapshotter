import {
    Archive,
    ArrowLeft,
    ChevronRight,
    Clock3,
    Download,
    File,
    Folder,
    HardDrive,
    Info,
    LoaderCircle,
    Play,
    Plus,
    Search,
    Settings2,
    ShieldCheck,
    Trash2,
    Wrench,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { isPackagedHost, requestNative } from "./bridge"
import type { ApplicationState, Snapshot, SnapshotEntry } from "./model"

type View = "overview" | "snapshots" | "settings"

export function App() {
    const [view, setView] = useState<View>("overview")
    const [state, setState] = useState<ApplicationState>()
    const [error, setError] = useState<string>()
    const [running, setRunning] = useState(false)

    const refresh = useCallback(async () => {
        try {
            setState(
                normalizeState(
                    await requestNative<ApplicationState>("state.get"),
                ),
            )
            setError(undefined)
        } catch (requestError) {
            setError(message(requestError))
        }
    }, [])

    useEffect(() => {
        void refresh()
    }, [refresh])

    const backupNow = async () => {
        setRunning(true)
        try {
            setState(
                normalizeState(
                    await requestNative<ApplicationState>("backup.start"),
                ),
            )
            setError(undefined)
        } catch (requestError) {
            setError(message(requestError))
        } finally {
            setRunning(false)
        }
    }

    const addSources = async () => {
        try {
            setState(
                normalizeState(
                    await requestNative<ApplicationState>("source.choose"),
                ),
            )
        } catch (requestError) {
            setError(message(requestError))
        }
    }

    const addSourcePath = async (path: string) => {
        setState(
            normalizeState(
                await requestNative<ApplicationState>("source.add", {
                    paths: [path],
                }),
            ),
        )
        setError(undefined)
    }

    return (
        <main className="app-shell">
            <Header
                view={view}
                onView={setView}
                showNavigation={state?.status === "ready"}
            />
            <div className="app-content">
                {error && <div className="error-banner">{error}</div>}
                {!state && <Loading />}
                {state?.status === "unconfigured" && (
                    <Setup
                        onComplete={(next) => setState(normalizeState(next))}
                    />
                )}
                {state?.status === "locked" && (
                    <Locked
                        state={state}
                        onComplete={(next) => setState(normalizeState(next))}
                    />
                )}
                {state?.status === "ready" && view === "overview" && (
                    <Overview
                        state={state}
                        running={running}
                        onBackup={backupNow}
                        onAddSources={addSources}
                        onAddSourcePath={addSourcePath}
                        onSnapshots={() => setView("snapshots")}
                        onState={(next) => setState(normalizeState(next))}
                    />
                )}
                {state?.status === "ready" && view === "snapshots" && (
                    <Snapshots
                        snapshots={state.snapshots}
                        onState={(next) => setState(normalizeState(next))}
                    />
                )}
                {state?.status === "ready" && view === "settings" && (
                    <Settings
                        state={state}
                        onState={(next) => setState(normalizeState(next))}
                    />
                )}
            </div>
        </main>
    )
}

function Header({
    view,
    onView,
    showNavigation,
}: {
    view: View
    onView: (view: View) => void
    showNavigation: boolean
}) {
    return (
        <>
            <header className="titlebar">
                <div className="brand">
                    <div className="brand-mark">
                        <ShieldCheck />
                    </div>
                    <span>Snapshotter</span>
                </div>
                {showNavigation && (
                    <button
                        type="button"
                        className="icon-button"
                        aria-label="Settings"
                        onClick={() => onView("settings")}
                    >
                        <Settings2 size={17} />
                    </button>
                )}
            </header>
            {showNavigation && (
                <nav className="segmented" aria-label="Main navigation">
                    {(["overview", "snapshots", "settings"] as const).map(
                        (item) => (
                            <button
                                type="button"
                                key={item}
                                className={view === item ? "selected" : ""}
                                onClick={() => onView(item)}
                            >
                                {item[0].toUpperCase() + item.slice(1)}
                            </button>
                        ),
                    )}
                </nav>
            )}
        </>
    )
}

function Loading() {
    return (
        <div className="center-state">
            <LoaderCircle className="spinner" />
            <span>Loading</span>
        </div>
    )
}

function Setup({
    onComplete,
}: {
    onComplete: (state: ApplicationState) => void
}) {
    const [name, setName] = useState("My Backup")
    const [password, setPassword] = useState("")
    const [kind, setKind] = useState<"local" | "s3" | "sftp" | "rest">("local")
    const [repositoryMode, setRepositoryMode] = useState<"create" | "open">(
        "create",
    )
    const [location, setLocation] = useState("")
    const [username, setUsername] = useState("")
    const [backendPassword, setBackendPassword] = useState("")
    const [accessKey, setAccessKey] = useState("")
    const [secretKey, setSecretKey] = useState("")
    const [region, setRegion] = useState("")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string>()

    const create = async () => {
        setBusy(true)
        try {
            onComplete(
                await requestNative<ApplicationState>(
                    kind === "local"
                        ? repositoryMode === "create"
                            ? "repository.create.choose"
                            : "repository.open.choose"
                        : repositoryMode === "create"
                          ? "repository.create.remote"
                          : "repository.open.remote",
                    {
                        name,
                        password,
                        kind,
                        location,
                        credentials: {
                            username,
                            password: backendPassword,
                            accessKey,
                            secretKey,
                            region,
                        },
                    },
                ),
            )
        } catch (requestError) {
            setError(message(requestError))
        } finally {
            setBusy(false)
        }
    }

    return (
        <section className="setup-state">
            <div className="setup-icon">
                <HardDrive />
            </div>
            <h1>Set up your backup</h1>
            <p>Choose a destination and encryption password.</p>
            <fieldset
                className="repository-mode"
                aria-label="Repository action"
            >
                <button
                    type="button"
                    className={repositoryMode === "create" ? "selected" : ""}
                    onClick={() => setRepositoryMode("create")}
                >
                    New repository
                </button>
                <button
                    type="button"
                    className={repositoryMode === "open" ? "selected" : ""}
                    onClick={() => setRepositoryMode("open")}
                >
                    Open existing
                </button>
            </fieldset>
            <fieldset
                className="destination-kind"
                aria-label="Destination type"
            >
                {(["local", "s3", "sftp", "rest"] as const).map((option) => (
                    <button
                        type="button"
                        className={kind === option ? "selected" : ""}
                        key={option}
                        onClick={() => setKind(option)}
                    >
                        {option === "local" ? "Folder" : option.toUpperCase()}
                    </button>
                ))}
            </fieldset>
            <label>
                Name
                <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                />
            </label>
            <label>
                Password
                <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                />
            </label>
            {kind !== "local" && (
                <label>
                    Destination
                    <input
                        value={location}
                        placeholder={destinationPlaceholder(kind)}
                        onChange={(event) => setLocation(event.target.value)}
                        spellCheck={false}
                    />
                </label>
            )}
            {kind === "s3" && (
                <div className="remote-credentials">
                    <label>
                        Access key
                        <input
                            value={accessKey}
                            onChange={(event) =>
                                setAccessKey(event.target.value)
                            }
                            autoComplete="off"
                        />
                    </label>
                    <label>
                        Secret key
                        <input
                            type="password"
                            value={secretKey}
                            onChange={(event) =>
                                setSecretKey(event.target.value)
                            }
                            autoComplete="off"
                        />
                    </label>
                    <label>
                        Region <small>Optional</small>
                        <input
                            value={region}
                            onChange={(event) => setRegion(event.target.value)}
                            placeholder="us-east-1"
                        />
                    </label>
                </div>
            )}
            {kind === "rest" && (
                <div className="remote-credentials">
                    <label>
                        Username <small>Optional</small>
                        <input
                            value={username}
                            onChange={(event) =>
                                setUsername(event.target.value)
                            }
                            autoComplete="off"
                        />
                    </label>
                    <label>
                        Server password <small>Optional</small>
                        <input
                            type="password"
                            value={backendPassword}
                            onChange={(event) =>
                                setBackendPassword(event.target.value)
                            }
                            autoComplete="off"
                        />
                    </label>
                </div>
            )}
            {kind === "sftp" && (
                <small className="setup-hint">
                    Uses your macOS SSH configuration, agent, and keys.
                </small>
            )}
            {error && <span className="form-error">{error}</span>}
            <button
                type="button"
                className="primary-button setup-button"
                disabled={
                    !name ||
                    !password ||
                    busy ||
                    (kind !== "local" && !location)
                }
                onClick={create}
            >
                {busy
                    ? repositoryMode === "create"
                        ? "Creating…"
                        : "Opening…"
                    : kind === "local"
                      ? repositoryMode === "create"
                          ? "Choose destination…"
                          : "Choose repository…"
                      : repositoryMode === "create"
                        ? "Create repository"
                        : "Open repository"}
            </button>
        </section>
    )
}

function Locked({
    state,
    onComplete,
}: {
    state: ApplicationState
    onComplete: (state: ApplicationState) => void
}) {
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string>()
    const unlock = async () => {
        setBusy(true)
        try {
            onComplete(
                await requestNative<ApplicationState>("repository.unlock", {
                    repositoryID: state.preferences.repository?.id,
                }),
            )
        } catch (requestError) {
            setError(message(requestError))
        } finally {
            setBusy(false)
        }
    }

    useEffect(() => {
        void unlock()
    }, [])

    return (
        <div className="center-state">
            <HardDrive />
            <strong>{state.preferences.repository?.name}</strong>
            <span>{busy ? "Unlocking…" : (error ?? "Repository locked")}</span>
            {error && (
                <button
                    type="button"
                    className="primary-button"
                    onClick={unlock}
                    disabled={busy}
                >
                    Try again
                </button>
            )}
        </div>
    )
}

function Overview({
    state,
    running,
    onBackup,
    onAddSources,
    onAddSourcePath,
    onSnapshots,
    onState,
}: {
    state: ApplicationState
    running: boolean
    onBackup: () => void
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
        }
    }
    const removeSource = async (id: string) => {
        try {
            onState(
                await requestNative<ApplicationState>("source.remove", { id }),
            )
            setSourceError(undefined)
        } catch (error) {
            setSourceError(message(error))
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
                        {latest
                            ? `Last backup ${formatRelative(latest.time)}`
                            : `${state.preferences.sources.length + state.preferences.selectedApps.length} sources selected`}
                    </p>
                </div>
                <button
                    type="button"
                    className="primary-button"
                    onClick={onBackup}
                    disabled={
                        running ||
                        (state.preferences.sources.length === 0 &&
                            state.preferences.selectedApps.length === 0)
                    }
                >
                    <Play size={13} fill="currentColor" />
                    {running ? "Running" : "Back up"}
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
                        <span className="form-error">{sourceError}</span>
                    )}
                </div>
            )}
            <section className="list-card source-list">
                {state.preferences.sources.length === 0 && (
                    <div className="empty-row">No folders selected</div>
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
                            className={`switch source-switch ${source.enabled ? "on" : ""}`}
                            aria-label={`${source.enabled ? "Disable" : "Enable"} ${basename(source.path)}`}
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
                            onClick={() => void removeSource(source.id)}
                        >
                            <Trash2 size={13} />
                        </button>
                    </div>
                ))}
            </section>
            <SectionTitle
                title="Recent"
                action="All snapshots"
                onAction={onSnapshots}
            />
            <section className="list-card snapshot-list">
                {state.snapshots.length === 0 && (
                    <div className="empty-row">No snapshots yet</div>
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

function SectionTitle({
    title,
    action,
    icon,
    onAction,
}: {
    title: string
    action: string
    icon?: React.ReactNode
    onAction: () => void
}) {
    return (
        <div className="section-title">
            <h2>{title}</h2>
            <button type="button" onClick={onAction}>
                {icon}
                {action}
            </button>
        </div>
    )
}

function Snapshots({
    snapshots,
    onState,
}: {
    snapshots: Snapshot[]
    onState: (state: ApplicationState) => void
}) {
    const [query, setQuery] = useState("")
    const [selectedSnapshot, setSelectedSnapshot] = useState<Snapshot>()
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const visibleSnapshots = snapshots.filter((snapshot) =>
        [snapshot.id, snapshot.hostname, formatDate(snapshot.time)]
            .join(" ")
            .toLocaleLowerCase()
            .includes(normalizedQuery),
    )
    if (selectedSnapshot) {
        return (
            <SnapshotBrowser
                snapshot={selectedSnapshot}
                onBack={() => setSelectedSnapshot(undefined)}
                onDeleted={(state) => {
                    setSelectedSnapshot(undefined)
                    onState(state)
                }}
            />
        )
    }

    return (
        <section className="page">
            <div className="search">
                <Search size={15} />
                <input
                    aria-label="Search backup files"
                    placeholder="Find a file…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                />
            </div>
            <div className="timeline">
                {visibleSnapshots.length === 0 && (
                    <div className="empty-row">No snapshots yet</div>
                )}
                {visibleSnapshots.map((snapshot) => (
                    <button
                        type="button"
                        className="timeline-row"
                        key={snapshot.id}
                        onClick={() => setSelectedSnapshot(snapshot)}
                    >
                        <div className="snapshot-symbol">
                            <Archive size={16} />
                        </div>
                        <div className="row-copy">
                            <strong>{formatDate(snapshot.time)}</strong>
                            <small>
                                {snapshot.paths.map(basename).join(", ") ||
                                    "No source paths"}
                            </small>
                            <div className="snapshot-metadata">
                                <span>
                                    {formatCount(snapshot.fileCount)} files
                                </span>
                                <span>{formatBytes(snapshot.totalSize)}</span>
                                <span>{snapshot.hostname}</span>
                                <code>{snapshot.id.slice(0, 8)}</code>
                            </div>
                        </div>
                        <ChevronRight size={15} />
                    </button>
                ))}
            </div>
        </section>
    )
}

function SnapshotBrowser({
    snapshot,
    onBack,
    onDeleted,
}: {
    snapshot: Snapshot
    onBack: () => void
    onDeleted: (state: ApplicationState) => void
}) {
    const [path, setPath] = useState("/")
    const [entries, setEntries] = useState<SnapshotEntry[]>([])
    const [selected, setSelected] = useState<SnapshotEntry>()
    const [loading, setLoading] = useState(true)
    const [status, setStatus] = useState<string>()
    const [confirmDelete, setConfirmDelete] = useState(false)
    const [deleting, setDeleting] = useState(false)

    useEffect(() => {
        let active = true
        setLoading(true)
        setSelected(undefined)
        requestNative<SnapshotEntry[]>("snapshot.list", {
            snapshotID: snapshot.id,
            path,
        })
            .then((items) => {
                if (active) setEntries(items ?? [])
            })
            .catch((error) => {
                if (active) setStatus(message(error))
            })
            .finally(() => {
                if (active) setLoading(false)
            })
        return () => {
            active = false
        }
    }, [path, snapshot.id])

    const restore = async () => {
        const restorePath = selected?.path ?? path
        setStatus("Choose where to restore…")
        try {
            const result = await requestNative<{ restoredFiles: number }>(
                "snapshot.restore.choose",
                { snapshotID: snapshot.id, path: restorePath },
            )
            setStatus(
                `Restored ${formatCount(result.restoredFiles)} ${result.restoredFiles === 1 ? "file" : "files"}`,
            )
        } catch (error) {
            setStatus(message(error))
        }
    }

    const deleteSnapshot = async () => {
        setDeleting(true)
        setStatus(undefined)
        try {
            onDeleted(
                await requestNative<ApplicationState>("snapshot.delete", {
                    snapshotID: snapshot.id,
                }),
            )
        } catch (error) {
            setStatus(message(error))
            setConfirmDelete(false)
            setDeleting(false)
        }
    }

    const parent =
        path === "/" ? "/" : path.split("/").slice(0, -1).join("/") || "/"
    return (
        <section className="page snapshot-browser">
            <div className="browser-toolbar">
                <button
                    type="button"
                    className="icon-button"
                    aria-label="Back to snapshots"
                    onClick={onBack}
                >
                    <ArrowLeft size={15} />
                </button>
                <div>
                    <strong>{formatDate(snapshot.time)}</strong>
                    <small>{path}</small>
                </div>
                <button
                    type="button"
                    className="primary-button"
                    onClick={() => void restore()}
                    disabled={loading}
                >
                    <Download size={13} />
                    Restore
                </button>
            </div>
            {path !== "/" && (
                <button
                    type="button"
                    className="entry-row parent-entry"
                    onClick={() => setPath(parent)}
                >
                    <Folder size={16} />
                    <span>..</span>
                </button>
            )}
            <div className="entry-list">
                {loading && <div className="empty-row">Loading…</div>}
                {!loading && entries.length === 0 && (
                    <div className="empty-row">This folder is empty</div>
                )}
                {!loading &&
                    entries.map((entry) => (
                        <button
                            type="button"
                            className={`entry-row ${selected?.path === entry.path ? "selected" : ""}`}
                            key={entry.path}
                            onClick={() => {
                                if (entry.type === "dir") setPath(entry.path)
                                else setSelected(entry)
                            }}
                        >
                            {entry.type === "dir" ? (
                                <Folder size={16} />
                            ) : (
                                <File size={16} />
                            )}
                            <span>
                                <strong>{entry.name}</strong>
                                <small>
                                    {entry.type === "dir"
                                        ? "Folder"
                                        : formatBytes(entry.size)}
                                </small>
                            </span>
                            {entry.type === "dir" && <ChevronRight size={14} />}
                        </button>
                    ))}
            </div>
            <div className="snapshot-actions">
                {!confirmDelete ? (
                    <button
                        type="button"
                        className="destructive-button"
                        onClick={() => setConfirmDelete(true)}
                    >
                        <Trash2 size={13} />
                        Delete snapshot
                    </button>
                ) : (
                    <div className="delete-confirmation">
                        <span>Delete this snapshot and reclaim its space?</span>
                        <button
                            type="button"
                            onClick={() => setConfirmDelete(false)}
                            disabled={deleting}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="destructive-button"
                            onClick={() => void deleteSnapshot()}
                            disabled={deleting}
                        >
                            {deleting ? "Deleting…" : "Delete"}
                        </button>
                    </div>
                )}
            </div>
            {status && <div className="restore-status">{status}</div>}
        </section>
    )
}

function Settings({
    state,
    onState,
}: {
    state: ApplicationState
    onState: (state: ApplicationState) => void
}) {
    const preferences = state.preferences
    const [retentionOpen, setRetentionOpen] = useState(false)
    const [applicationsOpen, setApplicationsOpen] = useState(false)
    const [exclusionsOpen, setExclusionsOpen] = useState(false)
    const [customExclusion, setCustomExclusion] = useState("")
    const [retention, setRetention] = useState(preferences.retention)
    const [checking, setChecking] = useState(false)
    const [repairing, setRepairing] = useState(false)
    const [checkResult, setCheckResult] = useState<string>()
    const [acknowledgementsOpen, setAcknowledgementsOpen] = useState(false)
    const [disconnectOpen, setDisconnectOpen] = useState(false)
    const [settingsError, setSettingsError] = useState<string>()
    const packaged = isPackagedHost()

    const updateSchedule = async (
        changes: Partial<typeof preferences.schedule>,
    ) => {
        onState(
            await requestNative<ApplicationState>("schedule.set", {
                ...preferences.schedule,
                ...changes,
            }),
        )
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

    const saveRetention = async () => {
        onState(
            await requestNative<ApplicationState>("retention.set", retention),
        )
        setRetentionOpen(false)
    }

    const setApplicationEnabled = async (id: string, enabled: boolean) => {
        try {
            onState(
                normalizeState(
                    await requestNative<ApplicationState>(
                        "application.setEnabled",
                        { id, enabled },
                    ),
                ),
            )
            setSettingsError(undefined)
        } catch (error) {
            setSettingsError(message(error))
        }
    }

    const setExclusionEnabled = async (id: string, enabled: boolean) => {
        try {
            onState(
                normalizeState(
                    await requestNative<ApplicationState>(
                        "exclusion.setEnabled",
                        { id, enabled },
                    ),
                ),
            )
            setSettingsError(undefined)
        } catch (error) {
            setSettingsError(message(error))
        }
    }

    const addExclusion = async () => {
        if (!customExclusion.trim()) return
        try {
            onState(
                normalizeState(
                    await requestNative<ApplicationState>("exclusion.add", {
                        pattern: customExclusion,
                    }),
                ),
            )
            setCustomExclusion("")
            setSettingsError(undefined)
        } catch (error) {
            setSettingsError(message(error))
        }
    }

    const removeExclusion = async (id: string) => {
        try {
            onState(
                normalizeState(
                    await requestNative<ApplicationState>("exclusion.remove", {
                        id,
                    }),
                ),
            )
            setSettingsError(undefined)
        } catch (error) {
            setSettingsError(message(error))
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

    const disconnectRepository = async () => {
        const repositoryID = preferences.repository?.id
        if (!repositoryID) return
        try {
            onState(
                await requestNative<ApplicationState>("repository.disconnect", {
                    repositoryID,
                }),
            )
        } catch (error) {
            setSettingsError(message(error))
            setDisconnectOpen(false)
        }
    }

    const timeValue = `${String(preferences.schedule.hour).padStart(2, "0")}:${String(preferences.schedule.minute).padStart(2, "0")}`
    return (
        <section className="page settings-page">
            {settingsError && (
                <div className="error-banner">{settingsError}</div>
            )}
            <h3>Repository</h3>
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
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="destructive-button"
                        onClick={() => void disconnectRepository()}
                    >
                        Disconnect
                    </button>
                </div>
            )}
            <h3>Schedule</h3>
            <div className="settings-card">
                <label>
                    <span>
                        <strong>Automatic backups</strong>
                        <small>{scheduleLabel(state)}</small>
                    </span>
                    <button
                        type="button"
                        className={`switch ${preferences.schedule.enabled ? "on" : ""}`}
                        aria-label="Toggle automatic backups"
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
                        className={`switch ${preferences.launchAtLogin ? "on" : ""}`}
                        aria-label="Toggle start at login"
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
            <h3>Backup content</h3>
            <button
                type="button"
                className="setting-row"
                onClick={() => setApplicationsOpen((open) => !open)}
            >
                <Archive size={17} />
                <span>
                    <strong>Applications</strong>
                    <small>
                        {state.applicationPresets.filter((app) => app.enabled)
                            .length || "No"}{" "}
                        selected
                    </small>
                </span>
                <ChevronRight
                    className={applicationsOpen ? "expanded" : ""}
                    size={15}
                />
            </button>
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
                                className={`switch ${application.enabled ? "on" : ""}`}
                                aria-label={`Back up ${application.name}`}
                                disabled={!application.available}
                                onClick={() =>
                                    void setApplicationEnabled(
                                        application.id,
                                        !application.enabled,
                                    )
                                }
                            >
                                <span />
                            </button>
                        </label>
                    ))}
                </div>
            )}
            <button
                type="button"
                className="setting-row"
                onClick={() => setExclusionsOpen((open) => !open)}
            >
                <Folder size={17} />
                <span>
                    <strong>Excluded paths</strong>
                    <small>
                        {
                            preferences.exclusions.filter(
                                (rule) => rule.enabled,
                            ).length
                        }{" "}
                        active rules
                    </small>
                </span>
                <ChevronRight
                    className={exclusionsOpen ? "expanded" : ""}
                    size={15}
                />
            </button>
            {exclusionsOpen && (
                <div className="choice-editor exclusions-editor">
                    <p>
                        Matches are skipped in every selected folder. Built-in
                        rules avoid reproducible dependencies, build output, and
                        caches.
                    </p>
                    {preferences.exclusions.map((exclusion) => (
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
                                    onClick={() =>
                                        void removeExclusion(exclusion.id)
                                    }
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                            <button
                                type="button"
                                className={`switch ${exclusion.enabled ? "on" : ""}`}
                                aria-label={`Toggle ${exclusion.pattern}`}
                                onClick={() =>
                                    void setExclusionEnabled(
                                        exclusion.id,
                                        !exclusion.enabled,
                                    )
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
                            disabled={!customExclusion.trim()}
                        >
                            Add
                        </button>
                    </form>
                </div>
            )}
            <h3>Retention</h3>
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
                        Keep one snapshot for each period. Applied after every
                        successful backup; the newest snapshot is always kept.
                    </p>
                    {(["daily", "weekly", "monthly"] as const).map((period) => (
                        <label key={period}>
                            <span>
                                {period[0].toUpperCase() + period.slice(1)}
                            </span>
                            <input
                                type="number"
                                min="0"
                                max="999"
                                value={retention[period]}
                                onChange={(event) =>
                                    setRetention((current) => ({
                                        ...current,
                                        [period]: Number(event.target.value),
                                    }))
                                }
                            />
                        </label>
                    ))}
                    <button
                        type="button"
                        className="primary-button"
                        onClick={() => void saveRetention()}
                    >
                        Apply
                    </button>
                </div>
            )}
            <h3>Maintenance</h3>
            <button
                type="button"
                className="setting-row"
                onClick={() => void checkRepository()}
                disabled={checking}
            >
                <Wrench size={17} />
                <span>
                    <strong>
                        {checking ? "Checking…" : "Check repository"}
                    </strong>
                    {checkResult && <small>{checkResult}</small>}
                </span>
            </button>
            <button
                type="button"
                className="setting-row"
                onClick={() => void repairRepositoryIndex()}
                disabled={checking || repairing}
            >
                <Wrench size={17} />
                <span>
                    <strong>
                        {repairing ? "Repairing index…" : "Repair index"}
                    </strong>
                    <small>Rebuild repository metadata from stored packs</small>
                </span>
            </button>
            <h3>About</h3>
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
        </section>
    )
}

function message(error: unknown) {
    return error instanceof Error ? error.message : "Something went wrong"
}
function destinationPlaceholder(kind: "s3" | "sftp" | "rest") {
    if (kind === "s3") return "s3:s3.amazonaws.com/bucket/snapshotter"
    if (kind === "sftp") return "sftp:user@host:/backups/snapshotter"
    return "rest:https://backup.example.com/snapshotter"
}
function basename(path: string) {
    return path.split("/").filter(Boolean).at(-1) ?? path
}
function formatDate(value: string) {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(value))
}
function formatRelative(value: string) {
    const minutes = Math.max(
        0,
        Math.round((Date.now() - new Date(value).getTime()) / 60000),
    )
    return minutes < 1
        ? "just now"
        : minutes < 60
          ? `${minutes}m ago`
          : minutes < 1440
            ? `${Math.floor(minutes / 60)}h ago`
            : `${Math.floor(minutes / 1440)}d ago`
}
function formatCount(value: number) {
    return new Intl.NumberFormat().format(value ?? 0)
}
function formatBytes(value: number) {
    if (!value) return "0 B"
    const units = ["B", "KB", "MB", "GB", "TB"]
    const exponent = Math.min(
        Math.floor(Math.log(value) / Math.log(1024)),
        units.length - 1,
    )
    return `${(value / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}
function compactPresetPath(path: string) {
    return path.split("/").filter(Boolean).slice(-2).join("/")
}
function scheduleLabel(state: ApplicationState) {
    const schedule = state.preferences.schedule
    if (schedule.kind === "weekly") {
        return `${weekdays[schedule.weekday]} at ${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`
    }
    return schedule.kind === "hourly"
        ? `Every ${schedule.interval === 1 ? "hour" : `${schedule.interval} hours`}`
        : `Daily at ${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`
}

const weekdays = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
]

function normalizeState(state: ApplicationState): ApplicationState {
    return {
        ...state,
        applicationPresets: state.applicationPresets ?? [],
        snapshots: state.snapshots ?? [],
        preferences: {
            ...state.preferences,
            sources: state.preferences.sources ?? [],
            exclusions: state.preferences.exclusions ?? [],
            selectedApps: state.preferences.selectedApps ?? [],
        },
    }
}
