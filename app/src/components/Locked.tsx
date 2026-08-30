import { HardDrive } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { requestNative } from "../bridge"
import { message } from "../lib/utils"
import type { ApplicationState } from "../model"

export function Locked({
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
