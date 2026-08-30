import { useCallback, useEffect, useRef, useState } from "react"
import {
    requestNative,
    subscribeToBackupProgress,
    subscribeToUpdates,
} from "./bridge"
import { Header } from "./components/Header"
import { Loading } from "./components/Loading"
import { Locked } from "./components/Locked"
import { Overview } from "./components/Overview"
import { Settings } from "./components/Settings"
import { Setup } from "./components/Setup"
import { Snapshots } from "./components/Snapshots"
import { UpdateBanner } from "./components/UpdateBanner"
import { message, normalizeState } from "./lib/utils"
import type { ApplicationState, BackupProgress, UpdateStatus } from "./model"

export type View = "overview" | "snapshots" | "settings"

export function App() {
    const [view, setView] = useState<View>("overview")
    const [state, setState] = useState<ApplicationState>()
    const [error, setError] = useState<string>()
    const [running, setRunning] = useState(false)
    const [backupProgress, setBackupProgress] = useState<BackupProgress>()
    const [updateStatus, setUpdateStatus] = useState<UpdateStatus>()
    const manualBackupRunning = useRef(false)

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

    useEffect(() => {
        const refreshUpdate = async () => {
            try {
                setUpdateStatus(
                    await requestNative<UpdateStatus>("update.status"),
                )
            } catch {
                // The native host reports update availability; stay silent.
            }
        }
        void refreshUpdate()
        const unsubscribe = subscribeToUpdates((update) =>
            setUpdateStatus(update),
        )
        return () => {
            unsubscribe()
        }
    }, [])

    useEffect(
        () =>
            subscribeToBackupProgress((progress) => {
                if (
                    progress.phase === "backing-up" ||
                    progress.phase === "finalizing"
                ) {
                    setRunning(true)
                }
                if (
                    progress.phase === "complete" ||
                    progress.phase === "cancelled" ||
                    progress.phase === "error"
                ) {
                    if (!manualBackupRunning.current) setRunning(false)
                }
                setBackupProgress({
                    phase: progress.phase as BackupProgress["phase"],
                    filesDone: progress.filesDone ?? 0,
                    bytesDone: progress.bytesDone ?? 0,
                })
            }),
        [],
    )

    const backupNow = async () => {
        manualBackupRunning.current = true
        setRunning(true)
        setBackupProgress({ phase: "backing-up", filesDone: 0, bytesDone: 0 })
        try {
            setState(
                normalizeState(
                    await requestNative<ApplicationState>("backup.start"),
                ),
            )
            setError(undefined)
        } catch (requestError) {
            const requestMessage = message(requestError)
            if (requestMessage !== "Operation cancelled") {
                setError(requestMessage)
            }
        } finally {
            manualBackupRunning.current = false
            setRunning(false)
            setBackupProgress(undefined)
        }
    }

    const cancelBackup = async () => {
        try {
            await requestNative<boolean>("operation.cancel")
        } catch (requestError) {
            setError(message(requestError))
        }
    }

    const installUpdate = async () => {
        if (!updateStatus?.available) return
        setUpdateStatus({ ...updateStatus, installing: true })
        try {
            await requestNative<boolean>("update.install")
            setUpdateStatus({ ...updateStatus, installing: true })
        } catch (requestError) {
            setUpdateStatus(undefined)
            setError(message(requestError))
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
                {updateStatus?.available && (
                    <UpdateBanner
                        update={updateStatus}
                        onInstall={() => void installUpdate()}
                        onDismiss={() => setUpdateStatus(undefined)}
                    />
                )}
                {error && (
                    <div className="error-banner" role="alert">
                        {error}
                    </div>
                )}
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
                        progress={backupProgress}
                        onBackup={backupNow}
                        onCancel={cancelBackup}
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
                        updateStatus={updateStatus}
                        onUpdateStatus={setUpdateStatus}
                        onInstall={() => void installUpdate()}
                    />
                )}
            </div>
        </main>
    )
}
