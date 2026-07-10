import {
    ArchiveRestore,
    ChevronRight,
    Clock3,
    Folder,
    HardDrive,
    MoreHorizontal,
    Play,
    Plus,
    Search,
    Settings2,
    ShieldCheck,
    Wrench,
} from "lucide-react"
import { useState } from "react"
import { initialDashboard, sendNative } from "./bridge"

type View = "overview" | "snapshots" | "settings"

export function App() {
    const [view, setView] = useState<View>("overview")
    const [dashboard, setDashboard] = useState(initialDashboard)
    const [running, setRunning] = useState(false)

    const backupNow = () => {
        setRunning(true)
        sendNative("backup.start")
        window.setTimeout(() => setRunning(false), 2200)
    }

    const toggleSource = (id: string) => {
        setDashboard((current) => ({
            ...current,
            sources: current.sources.map((source) =>
                source.id === id
                    ? { ...source, enabled: !source.enabled }
                    : source,
            ),
        }))
    }

    return (
        <main className="app-shell">
            <header className="titlebar">
                <div className="brand">
                    <div className="brand-mark">
                        <ShieldCheck size={17} strokeWidth={2.4} />
                    </div>
                    <span>Restic</span>
                </div>
                <button
                    type="button"
                    className="icon-button"
                    aria-label="Settings"
                    onClick={() => setView("settings")}
                >
                    <Settings2 size={17} />
                </button>
            </header>

            <nav className="segmented" aria-label="Main navigation">
                <button
                    type="button"
                    className={view === "overview" ? "selected" : ""}
                    onClick={() => setView("overview")}
                >
                    Overview
                </button>
                <button
                    type="button"
                    className={view === "snapshots" ? "selected" : ""}
                    onClick={() => setView("snapshots")}
                >
                    Snapshots
                </button>
                <button
                    type="button"
                    className={view === "settings" ? "selected" : ""}
                    onClick={() => setView("settings")}
                >
                    Settings
                </button>
            </nav>

            {view === "overview" && (
                <>
                    <section className="hero-card">
                        <div
                            className={`status-orb ${running ? "working" : ""}`}
                        >
                            <ShieldCheck size={28} />
                        </div>
                        <div className="hero-copy">
                            <h1>
                                {running ? "Backing up…" : "You’re protected"}
                            </h1>
                            <p>
                                {running
                                    ? "Scanning your selected folders"
                                    : `Last backup ${dashboard.lastBackup}`}
                            </p>
                        </div>
                        <button
                            type="button"
                            className="primary-button"
                            onClick={backupNow}
                            disabled={running}
                        >
                            <Play size={14} fill="currentColor" />
                            {running ? "Running" : "Back up now"}
                        </button>
                        {running && (
                            <div className="progress">
                                <span />
                            </div>
                        )}
                    </section>

                    <div className="stats-row">
                        <div>
                            <Clock3 size={16} />
                            <span>
                                <small>Next backup</small>
                                {dashboard.nextBackup}
                            </span>
                        </div>
                        <div>
                            <HardDrive size={16} />
                            <span>
                                <small>Repository</small>
                                {dashboard.repository}
                            </span>
                        </div>
                    </div>

                    <SectionTitle
                        title="Folders"
                        action="Add"
                        icon={<Plus size={13} />}
                        onAction={() => sendNative("source.choose")}
                    />
                    <section className="list-card source-list">
                        {dashboard.sources.map((source) => (
                            <div className="source-row" key={source.id}>
                                <div className="folder-icon">
                                    <Folder size={17} />
                                </div>
                                <div className="row-copy">
                                    <strong>{source.name}</strong>
                                    <small>
                                        {source.path} · {source.size}
                                    </small>
                                </div>
                                <button
                                    type="button"
                                    className={`switch ${source.enabled ? "on" : ""}`}
                                    aria-label={`Toggle ${source.name}`}
                                    onClick={() => toggleSource(source.id)}
                                >
                                    <span />
                                </button>
                            </div>
                        ))}
                    </section>

                    <SectionTitle
                        title="Latest snapshots"
                        action="See all"
                        onAction={() => setView("snapshots")}
                    />
                    <section className="list-card snapshot-list">
                        {dashboard.snapshots.slice(0, 2).map((snapshot) => (
                            <button
                                type="button"
                                className="snapshot-row"
                                key={snapshot.id}
                                onClick={() => setView("snapshots")}
                            >
                                <div className="snapshot-dot" />
                                <div className="row-copy">
                                    <strong>{snapshot.label}</strong>
                                    <small>
                                        {snapshot.files} · {snapshot.size} added
                                    </small>
                                </div>
                                <ChevronRight size={15} />
                            </button>
                        ))}
                    </section>
                </>
            )}

            {view === "snapshots" && <Snapshots />}
            {view === "settings" && <Settings />}

            <footer>
                <span className="footer-status">
                    <i className="online-dot" /> Ready
                </span>
                <button type="button" onClick={() => sendNative("app.quit")}>
                    Quit Restic
                </button>
            </footer>
        </main>
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

function Snapshots() {
    return (
        <section className="page">
            <div className="search">
                <Search size={15} />
                <input
                    aria-label="Search backup files"
                    placeholder="Find a file in your backups…"
                />
            </div>
            <div className="page-heading">
                <div>
                    <h1>Snapshots</h1>
                    <p>Browse or recover a previous version.</p>
                </div>
                <button type="button" className="secondary-button">
                    <ArchiveRestore size={14} /> Recover file
                </button>
            </div>
            <div className="timeline">
                {initialDashboard.snapshots.map((snapshot, index) => (
                    <button
                        type="button"
                        className="timeline-row"
                        key={snapshot.id}
                    >
                        <div className="timeline-rail">
                            <span />
                            {index < initialDashboard.snapshots.length - 1 && (
                                <i />
                            )}
                        </div>
                        <div className="row-copy">
                            <strong>{snapshot.label}</strong>
                            <small>
                                {snapshot.files} · {snapshot.size} added
                            </small>
                            <code>{snapshot.id}</code>
                        </div>
                        <MoreHorizontal size={17} />
                    </button>
                ))}
            </div>
        </section>
    )
}

function Settings() {
    return (
        <section className="page settings-page">
            <div className="page-heading">
                <div>
                    <h1>Settings</h1>
                    <p>Backup schedule and repository health.</p>
                </div>
            </div>
            <h3>Repository</h3>
            <button type="button" className="setting-row">
                <HardDrive size={17} />
                <span>
                    <strong>Home Archive</strong>
                    <small>Local disk · Connected</small>
                </span>
                <ChevronRight size={15} />
            </button>
            <h3>Schedule</h3>
            <div className="settings-card">
                <label>
                    <span>
                        <strong>Automatic backups</strong>
                        <small>Run every hour when your Mac is awake</small>
                    </span>
                    <button type="button" className="switch on">
                        <span />
                    </button>
                </label>
                <label>
                    <span>
                        <strong>Start at login</strong>
                        <small>Keep protection running in the background</small>
                    </span>
                    <button type="button" className="switch on">
                        <span />
                    </button>
                </label>
            </div>
            <h3>Retention</h3>
            <button type="button" className="setting-row">
                <Clock3 size={17} />
                <span>
                    <strong>Smart retention</strong>
                    <small>24 hourly · 7 daily · 4 weekly · 12 monthly</small>
                </span>
                <ChevronRight size={15} />
            </button>
            <h3>Maintenance</h3>
            <button type="button" className="setting-row">
                <Wrench size={17} />
                <span>
                    <strong>Check repository</strong>
                    <small>Last checked 3 days ago</small>
                </span>
                <ChevronRight size={15} />
            </button>
        </section>
    )
}
