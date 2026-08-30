import {
    Archive,
    ArrowLeft,
    ArrowUp,
    ChevronRight,
    Download,
    File,
    Folder,
    Search,
    Square,
    Trash2,
} from "lucide-react"
import { useEffect, useState } from "react"
import { requestNative } from "../bridge"
import {
    basename,
    formatBytes,
    formatCount,
    formatDate,
    message,
} from "../lib/utils"
import type { ApplicationState, Snapshot, SnapshotEntry } from "../model"

export function Snapshots({
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
                    aria-label="Search snapshots"
                    placeholder="Find a snapshot…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                />
            </div>
            <div className="timeline">
                {visibleSnapshots.length === 0 && (
                    <div className="empty-row">No snapshots found</div>
                )}
                {visibleSnapshots.map((snapshot) => (
                    <button
                        type="button"
                        className="timeline-row"
                        key={snapshot.id}
                        onClick={() => setSelectedSnapshot(snapshot)}
                    >
                        <div className="snapshot-symbol">
                            <Archive size={17} />
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

export function SnapshotBrowser({
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
    const [restoring, setRestoring] = useState(false)

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
        setRestoring(true)
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
        } finally {
            setRestoring(false)
        }
    }

    const cancelOperation = async () => {
        setStatus("Cancelling…")
        try {
            await requestNative<boolean>("operation.cancel")
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
    const isRoot = path === "/"
    return (
        <section className="page snapshot-browser">
            <div className="browser-toolbar">
                <button
                    type="button"
                    className="icon-button"
                    aria-label={isRoot ? "Back to snapshots" : "Up one level"}
                    title={isRoot ? "Back to snapshots" : "Up one level"}
                    disabled={loading || restoring}
                    onClick={() => {
                        if (isRoot) onBack()
                        else setPath(parent)
                    }}
                >
                    {isRoot ? <ArrowLeft size={16} /> : <ArrowUp size={16} />}
                </button>
                <div>
                    <strong>{formatDate(snapshot.time)}</strong>
                    <small>{path}</small>
                </div>
                <button
                    type="button"
                    className={restoring ? "cancel-button" : "primary-button"}
                    onClick={() =>
                        void (restoring ? cancelOperation() : restore())
                    }
                    disabled={loading || deleting}
                >
                    {restoring ? (
                        <Square size={11} fill="currentColor" />
                    ) : (
                        <Download size={13} />
                    )}
                    {restoring ? "Cancel restore" : "Restore"}
                </button>
            </div>
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
                            onClick={() =>
                                void (deleting
                                    ? cancelOperation()
                                    : setConfirmDelete(false))
                            }
                        >
                            {deleting ? "Cancel deletion" : "Cancel"}
                        </button>
                        <button
                            type="button"
                            className="destructive-button"
                            onClick={() => void deleteSnapshot()}
                            disabled={deleting || restoring}
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
