import {
    ArchiveRestore,
    ChevronRight,
    Clock3,
    Folder,
    HardDrive,
    LoaderCircle,
    MoreHorizontal,
    Play,
    Plus,
    Search,
    Settings2,
    ShieldCheck,
    Wrench,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { requestNative, sendNative } from "./bridge"
import type { ApplicationState, Snapshot } from "./model"

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

    return (
        <main className="app-shell">
            <Header
                view={view}
                onView={setView}
                showNavigation={state?.status === "ready"}
            />
            {error && <div className="error-banner">{error}</div>}
            {!state && <Loading />}
            {state?.status === "unconfigured" && (
                <Setup onComplete={(next) => setState(normalizeState(next))} />
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
                    onSnapshots={() => setView("snapshots")}
                />
            )}
            {state?.status === "ready" && view === "snapshots" && (
                <Snapshots snapshots={state.snapshots} />
            )}
            {state?.status === "ready" && view === "settings" && (
                <Settings state={state} />
            )}
            <footer className="footer-actions">
                <button type="button" onClick={() => sendNative("app.quit")}>
                    Quit
                </button>
            </footer>
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
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string>()

    const create = async () => {
        setBusy(true)
        try {
            onComplete(
                await requestNative<ApplicationState>(
                    "repository.create.choose",
                    { name, password },
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
            {error && <span className="form-error">{error}</span>}
            <button
                type="button"
                className="primary-button setup-button"
                disabled={!name || !password || busy}
                onClick={create}
            >
                {busy ? "Creating…" : "Choose destination…"}
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
    const unlock = async () => {
        setBusy(true)
        try {
            onComplete(
                await requestNative<ApplicationState>("repository.unlock", {
                    repositoryID: state.preferences.repository?.id,
                }),
            )
        } finally {
            setBusy(false)
        }
    }
    return (
        <div className="center-state">
            <HardDrive />
            <strong>{state.preferences.repository?.name}</strong>
            <span>Repository locked</span>
            <button
                type="button"
                className="primary-button"
                onClick={unlock}
                disabled={busy}
            >
                Unlock
            </button>
        </div>
    )
}

function Overview({
    state,
    running,
    onBackup,
    onAddSources,
    onSnapshots,
}: {
    state: ApplicationState
    running: boolean
    onBackup: () => void
    onAddSources: () => void
    onSnapshots: () => void
}) {
    const latest = state.snapshots[0]
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
                            : `${state.preferences.sources.length} folders selected`}
                    </p>
                </div>
                <button
                    type="button"
                    className="primary-button"
                    onClick={onBackup}
                    disabled={running || state.preferences.sources.length === 0}
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
                onAction={onAddSources}
            />
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
                        <span
                            className={`source-status ${source.enabled ? "enabled" : ""}`}
                        />
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

function Snapshots({ snapshots }: { snapshots: Snapshot[] }) {
    return (
        <section className="page">
            <div className="search">
                <Search size={15} />
                <input
                    aria-label="Search backup files"
                    placeholder="Find a file…"
                />
            </div>
            <div className="page-heading">
                <h1>Snapshots</h1>
                <button type="button" className="secondary-button">
                    <ArchiveRestore size={14} />
                    Recover
                </button>
            </div>
            <div className="timeline">
                {snapshots.length === 0 && (
                    <div className="empty-row">No snapshots yet</div>
                )}
                {snapshots.map((snapshot, index) => (
                    <button
                        type="button"
                        className="timeline-row"
                        key={snapshot.id}
                    >
                        <div className="timeline-rail">
                            <span />
                            {index < snapshots.length - 1 && <i />}
                        </div>
                        <div className="row-copy">
                            <strong>{formatDate(snapshot.time)}</strong>
                            <small>{snapshot.hostname}</small>
                        </div>
                        <MoreHorizontal size={17} />
                    </button>
                ))}
            </div>
        </section>
    )
}

function Settings({ state }: { state: ApplicationState }) {
    const preferences = state.preferences
    return (
        <section className="page settings-page">
            <div className="page-heading">
                <h1>Settings</h1>
            </div>
            <h3>Repository</h3>
            <button type="button" className="setting-row">
                <HardDrive size={17} />
                <span>
                    <strong>{preferences.repository?.name}</strong>
                    <small>{preferences.repository?.location}</small>
                </span>
                <ChevronRight size={15} />
            </button>
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
                    >
                        <span />
                    </button>
                </label>
                <label>
                    <span>
                        <strong>Start at login</strong>
                    </span>
                    <button
                        type="button"
                        className={`switch ${preferences.launchAtLogin ? "on" : ""}`}
                    >
                        <span />
                    </button>
                </label>
            </div>
            <h3>Retention</h3>
            <button type="button" className="setting-row">
                <Clock3 size={17} />
                <span>
                    <strong>Smart retention</strong>
                    <small>
                        {preferences.retention.hourly} hourly ·{" "}
                        {preferences.retention.daily} daily ·{" "}
                        {preferences.retention.weekly} weekly
                    </small>
                </span>
                <ChevronRight size={15} />
            </button>
            <h3>Maintenance</h3>
            <button type="button" className="setting-row">
                <Wrench size={17} />
                <span>
                    <strong>Check repository</strong>
                </span>
                <ChevronRight size={15} />
            </button>
        </section>
    )
}

function message(error: unknown) {
    return error instanceof Error ? error.message : "Something went wrong"
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
function scheduleLabel(state: ApplicationState) {
    const schedule = state.preferences.schedule
    return schedule.kind === "hourly"
        ? `Every ${schedule.interval === 1 ? "hour" : `${schedule.interval} hours`}`
        : `Daily at ${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`
}

function normalizeState(state: ApplicationState): ApplicationState {
    return {
        ...state,
        snapshots: state.snapshots ?? [],
        preferences: {
            ...state.preferences,
            sources: state.preferences.sources ?? [],
        },
    }
}
