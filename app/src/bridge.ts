interface NativeResponse<T> {
    ok: boolean
    data?: T
    error?: string
}

export interface NativeBackupProgress {
    phase: string
    filesDone?: number
    bytesDone?: number
}

type PendingRequest = {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
}

const pending = new Map<string, PendingRequest>()

declare global {
    interface Window {
        webkit?: {
            messageHandlers?: {
                resticNative?: { postMessage(message: string): void }
            }
        }
        __snapshotterResolve?: (
            id: string,
            response: NativeResponse<unknown>,
        ) => void
        __snapshotterPackaged?: boolean
        __snapshotterProgress?: (progress: NativeBackupProgress) => void
    }
}

const progressListeners = new Set<(progress: NativeBackupProgress) => void>()

window.__snapshotterProgress = (progress) => {
    for (const listener of progressListeners) listener(progress)
}

export function subscribeToBackupProgress(
    listener: (progress: NativeBackupProgress) => void,
) {
    progressListeners.add(listener)
    return () => {
        progressListeners.delete(listener)
    }
}

window.__snapshotterResolve = (id, response) => {
    const request = pending.get(id)
    if (!request) return
    pending.delete(id)
    if (response.ok) request.resolve(response.data)
    else
        request.reject(
            new Error(response.error ?? "Snapshotter request failed"),
        )
}

export function requestNative<T>(type: string, payload: unknown = {}) {
    const handler = window.webkit?.messageHandlers?.resticNative
    if (!handler) {
        return Promise.reject(
            new Error("Open Snapshotter through the macOS menu bar"),
        )
    }
    const id = crypto.randomUUID()
    return new Promise<T>((resolve, reject) => {
        pending.set(id, {
            resolve: resolve as (value: unknown) => void,
            reject,
        })
        handler.postMessage(JSON.stringify({ id, type, payload }))
    })
}

export function isPackagedHost() {
    return window.__snapshotterPackaged === true
}
