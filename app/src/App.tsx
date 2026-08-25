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
    Square,
    Trash2,
    Wrench,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import {
    isPackagedHost,
    requestNative,
    subscribeToBackupProgress,
    subscribeToUpdates,
} from "./bridge"
import type {
    ApplicationState,
    BackupProgress,
    Snapshot,
    SnapshotEntry,
    UpdateStatus,
} from "./model"

type View = "overview" | "snapshots" | "settings"

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
                        onUpdateStatus={setUpdateStatus}
                    />
                )}
            </div>
        </main>
    )
}

function UpdateBanner({
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
                <small>
                    You are on {update.currentVersion}
                    {update.notes ? ` · ${update.notes.slice(0, 90)}` : ""}…
                </small>
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
                                aria-pressed={view === item}
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
            <span>Loading…</span>
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
    const [location, setLocation] = useState("")
    const [username, setUsername] = useState("")
    const [backendPassword, setBackendPassword] = useState("")
    const [accessKey, setAccessKey] = useState("")
    const [secretKey, setSecretKey] = useState("")
    const [region, setRegion] = useState("")
    const [secretProvider, setSecretProvider] = useState<
        "keychain" | "onepassword"
    >("keychain")
    const [onePasswordAccount, setOnePasswordAccount] = useState("")
    const [onePasswordAccounts, setOnePasswordAccounts] = useState<
        { id: string; name: string }[]
    >([])
    const [detectingAccounts, setDetectingAccounts] = useState(false)
    const [manualAccount, setManualAccount] = useState(false)
    const [onePasswordVaultID, setOnePasswordVaultID] = useState("")
    const [onePasswordVaults, setOnePasswordVaults] = useState<
        { id: string; title: string }[]
    >([])
    const [onePasswordItems, setOnePasswordItems] = useState<
        {
            id: string
            title: string
            kind?: "local" | "s3" | "sftp" | "rest"
            location?: string
        }[]
    >([])
    const [onePasswordItemID, setOnePasswordItemID] = useState("")
    const [loadingVaults, setLoadingVaults] = useState(false)
    const [loadingItems, setLoadingItems] = useState(false)
    const onePasswordRequestGeneration = useRef(0)
    const detectingAccountsRef = useRef(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string>()

    const clearOnePasswordItems = () => {
        onePasswordRequestGeneration.current += 1
        setOnePasswordItems([])
        setOnePasswordItemID("")
    }

    const clearOnePasswordSelections = () => {
        clearOnePasswordItems()
        setOnePasswordVaults([])
        setOnePasswordVaultID("")
    }

    const discoverOnePasswordAccounts = async () => {
        if (detectingAccountsRef.current) return
        detectingAccountsRef.current = true
        setDetectingAccounts(true)
        try {
            const accounts = await requestNative<
                { id: string; name: string }[]
            >("onepassword.accounts")
            setOnePasswordAccounts(accounts)
            if (accounts.length > 0) {
                setOnePasswordAccount(accounts[0].id)
            } else {
                setManualAccount(true)
            }
        } catch {
            setManualAccount(true)
        } finally {
            detectingAccountsRef.current = false
            setDetectingAccounts(false)
        }
    }

    const loadOnePasswordVaults = async () => {
        const generation = onePasswordRequestGeneration.current
        setLoadingVaults(true)
        try {
            const vaults = await requestNative<{ id: string; title: string }[]>(
                "onepassword.vaults",
                { account: onePasswordAccount },
            )
            if (generation !== onePasswordRequestGeneration.current) return
            setOnePasswordVaults(vaults)
            setOnePasswordVaultID(vaults[0]?.id ?? "")
            setOnePasswordItems([])
            setOnePasswordItemID("")
            setError(undefined)
        } catch (requestError) {
            if (generation !== onePasswordRequestGeneration.current) return
            setError(message(requestError))
        } finally {
            if (generation === onePasswordRequestGeneration.current) {
                setLoadingVaults(false)
            }
        }
    }

    const loadOnePasswordItems = async () => {
        const generation = onePasswordRequestGeneration.current
        setLoadingItems(true)
        try {
            const items = await requestNative<
                {
                    id: string
                    title: string
                    kind?: "local" | "s3" | "sftp" | "rest"
                    location?: string
                }[]
            >("onepassword.items", {
                account: onePasswordAccount,
                vaultID: onePasswordVaultID,
            })
            if (generation !== onePasswordRequestGeneration.current) return
            setOnePasswordItems(items)
            setOnePasswordItemID("")
            setError(
                items.length === 0
                    ? "No Snapshotter items were found in this vault."
                    : undefined,
            )
        } catch (requestError) {
            if (generation !== onePasswordRequestGeneration.current) return
            setError(message(requestError))
        } finally {
            if (generation === onePasswordRequestGeneration.current) {
                setLoadingItems(false)
            }
        }
    }

    const usesExistingOnePasswordItem =
        secretProvider === "onepassword" && onePasswordItemID !== ""

    const create = async () => {
        setBusy(true)
        try {
            onComplete(
                await requestNative<ApplicationState>(
                    kind === "local"
                        ? "repository.configure.choose"
                        : "repository.configure.remote",
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
                        secretStorage:
                            secretProvider === "onepassword"
                                ? {
                                      provider: "onepassword",
                                      account: onePasswordAccount,
                                      vaultID: onePasswordVaultID,
                                      itemID: onePasswordItemID || undefined,
                                  }
                                : undefined,
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
            <fieldset className="repository-mode" aria-label="Secret storage">
                <button
                    type="button"
                    className={secretProvider === "keychain" ? "selected" : ""}
                    aria-pressed={secretProvider === "keychain"}
                    onClick={() => setSecretProvider("keychain")}
                >
                    Keychain
                </button>
                <button
                    type="button"
                    className={
                        secretProvider === "onepassword" ? "selected" : ""
                    }
                    aria-pressed={secretProvider === "onepassword"}
                    onClick={() => {
                        setSecretProvider("onepassword")
                        if (!onePasswordAccount && !detectingAccounts) {
                            void discoverOnePasswordAccounts()
                        }
                    }}
                >
                    1Password
                </button>
            </fieldset>
            {secretProvider === "onepassword" && (
                <div className="onepassword-storage">
                    {detectingAccounts && (
                        <small className="setup-hint">
                            Detecting 1Password accounts…
                        </small>
                    )}
                    {!detectingAccounts &&
                        !manualAccount &&
                        onePasswordAccounts.length > 0 && (
                            <label>
                                1Password account
                                <select
                                    value={onePasswordAccount}
                                    onChange={(event) => {
                                        clearOnePasswordSelections()
                                        setOnePasswordAccount(
                                            event.target.value,
                                        )
                                    }}
                                >
                                    {onePasswordAccounts.map((account) => (
                                        <option
                                            key={account.id}
                                            value={account.id}
                                        >
                                            {account.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                    {!detectingAccounts && manualAccount && (
                        <label>
                            1Password account
                            <input
                                value={onePasswordAccount}
                                placeholder="Account name or ID"
                                onChange={(event) => {
                                    clearOnePasswordSelections()
                                    setOnePasswordAccount(event.target.value)
                                }}
                                spellCheck={false}
                            />
                        </label>
                    )}
                    {!detectingAccounts && (
                        <div className="onepassword-actions">
                            {onePasswordAccounts.length > 0 && (
                                <button
                                    type="button"
                                    className="secondary-button"
                                    onClick={() => {
                                        clearOnePasswordSelections()
                                        setManualAccount((manual) => !manual)
                                        setOnePasswordAccount(
                                            manualAccount
                                                ? onePasswordAccounts[0].id
                                                : "",
                                        )
                                    }}
                                >
                                    {manualAccount
                                        ? "Use detected account"
                                        : "Enter manually"}
                                </button>
                            )}
                            <button
                                type="button"
                                className="secondary-button"
                                disabled={
                                    !onePasswordAccount.trim() || loadingVaults
                                }
                                onClick={() => void loadOnePasswordVaults()}
                            >
                                {loadingVaults ? "Connecting…" : "Load vaults"}
                            </button>
                        </div>
                    )}
                    {onePasswordVaults.length > 0 && (
                        <label>
                            Vault
                            <select
                                value={onePasswordVaultID}
                                onChange={(event) => {
                                    clearOnePasswordItems()
                                    setOnePasswordVaultID(event.target.value)
                                }}
                            >
                                {onePasswordVaults.map((vault) => (
                                    <option key={vault.id} value={vault.id}>
                                        {vault.title}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                    {onePasswordVaultID && (
                        <>
                            <button
                                type="button"
                                className="secondary-button"
                                disabled={loadingItems}
                                onClick={() => void loadOnePasswordItems()}
                            >
                                {loadingItems
                                    ? "Loading…"
                                    : "Use synced secrets…"}
                            </button>
                            {onePasswordItems.length > 0 && (
                                <label>
                                    Snapshotter item
                                    <select
                                        value={onePasswordItemID}
                                        onChange={(event) => {
                                            const item = onePasswordItems.find(
                                                (candidate) =>
                                                    candidate.id ===
                                                    event.target.value,
                                            )
                                            setOnePasswordItemID(
                                                event.target.value,
                                            )
                                            if (!item) return
                                            setName(item.title)
                                            setKind(item.kind ?? "local")
                                            setLocation(item.location ?? "")
                                        }}
                                    >
                                        <option value="">
                                            Use entered password
                                        </option>
                                        {onePasswordItems.map((item) => (
                                            <option
                                                key={item.id}
                                                value={item.id}
                                            >
                                                {item.title}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            )}
                        </>
                    )}
                    <small className="setup-hint">
                        Requires the 1Password desktop app. Authorization uses
                        Touch ID when enabled in 1Password.
                    </small>
                </div>
            )}
            <fieldset
                className="destination-kind"
                aria-label="Destination type"
            >
                {(["local", "s3", "sftp", "rest"] as const).map((option) => (
                    <button
                        type="button"
                        className={kind === option ? "selected" : ""}
                        aria-pressed={kind === option}
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
                Password{" "}
                {usesExistingOnePasswordItem && <small>From 1Password</small>}
                <input
                    type="password"
                    value={password}
                    disabled={usesExistingOnePasswordItem}
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
            {kind === "local" && usesExistingOnePasswordItem && location && (
                <label>
                    Saved destination
                    <input value={location} disabled />
                </label>
            )}
            {kind === "s3" && (
                <div className="remote-credentials">
                    <label>
                        Access key
                        <input
                            value={accessKey}
                            disabled={usesExistingOnePasswordItem}
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
                            disabled={usesExistingOnePasswordItem}
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
                            disabled={usesExistingOnePasswordItem}
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
                            disabled={usesExistingOnePasswordItem}
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
                            disabled={usesExistingOnePasswordItem}
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
            {error && (
                <span className="form-error" role="alert">
                    {error}
                </span>
            )}
            <button
                type="button"
                className="primary-button setup-button"
                disabled={
                    !name ||
                    (!password && !usesExistingOnePasswordItem) ||
                    busy ||
                    (secretProvider === "onepassword" &&
                        (!onePasswordAccount.trim() || !onePasswordVaultID)) ||
                    (kind !== "local" && !location)
                }
                onClick={create}
            >
                {busy
                    ? "Configuring…"
                    : kind === "local"
                      ? "Choose destination…"
                      : "Continue"}
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
    const unlockStarted = useRef(false)
    const unlock = async () => {
        setBusy(true)
        try {
            onComplete(
                await requestNative<ApplicationState>("repository.unlock", {
                    repositoryID: state.preferences.repository?.id,
                    secretStorage: state.preferences.repository?.secretStorage,
                }),
            )
        } catch (requestError) {
            setError(message(requestError))
        } finally {
            setBusy(false)
        }
    }

    useEffect(() => {
        if (unlockStarted.current) return
        unlockStarted.current = true
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

function BackupContentControls({
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
            <button
                type="button"
                aria-label={`${action} ${title}`}
                onClick={onAction}
            >
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
                    aria-label="Search snapshots"
                    placeholder="Find a snapshot…"
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

function Settings({
    state,
    onState,
    onUpdateStatus,
}: {
    state: ApplicationState
    onState: (state: ApplicationState) => void
    onUpdateStatus: (status: UpdateStatus) => void
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
            <h3>Schedule</h3>
            <div className="settings-card">
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
                        disabled={savingRetention}
                        onClick={() => void saveRetention()}
                    >
                        {savingRetention ? "Applying…" : "Apply"}
                    </button>
                </div>
            )}
            <h3>Maintenance</h3>
            <button
                type="button"
                className="setting-row"
                onClick={() =>
                    void (checking ? cancelMaintenance() : checkRepository())
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
                    <small>Rebuild repository metadata from stored packs</small>
                </span>
            </button>
            <h3>Updates</h3>
            <div className="settings-card">
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
            </div>
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
            alwaysUpdate: state.preferences.alwaysUpdate ?? false,
        },
    }
}
