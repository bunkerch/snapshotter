import { HardDrive } from "lucide-react"
import { useRef, useState } from "react"
import { requestNative } from "../bridge"
import { destinationPlaceholder, message } from "../lib/utils"
import type { ApplicationState } from "../model"

export function Setup({
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
