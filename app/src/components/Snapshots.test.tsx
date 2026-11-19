import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { SnapshotBrowser } from "./Snapshots"

afterEach(() => {
    cleanup()
    delete window.webkit
})

it("clears the previous folder when loading the next one fails and can retry", async () => {
    let failed = false
    window.webkit = {
        messageHandlers: {
            resticNative: {
                postMessage(raw) {
                    const { id, type, payload } = JSON.parse(raw)
                    if (type !== "snapshot.list") throw new Error(type)
                    if (payload.path === "/")
                        window.__snapshotterResolve?.(id, {
                            ok: true,
                            data: [
                                {
                                    name: "Documents",
                                    path: "/Documents",
                                    type: "dir",
                                    size: 0,
                                    modTime: "",
                                },
                            ],
                        })
                    else if (!failed) {
                        failed = true
                        window.__snapshotterResolve?.(id, {
                            ok: false,
                            error: "Connection lost",
                        })
                    } else
                        window.__snapshotterResolve?.(id, {
                            ok: true,
                            data: [],
                        })
                },
            },
        },
    }
    render(
        <SnapshotBrowser
            snapshot={{
                id: "snapshot",
                time: "2026-01-01",
                hostname: "mac",
                paths: [],
                tags: [],
                fileCount: 1,
                totalSize: 1,
            }}
            onBack={vi.fn()}
            onDeleted={vi.fn()}
        />,
    )
    fireEvent.click(await screen.findByRole("button", { name: /Documents/ }))
    await screen.findByText("Connection lost")
    expect(screen.queryByRole("button", { name: /Documents/ })).toBeNull()
    expect(screen.queryByText("This folder is empty")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    await screen.findByText("This folder is empty")
})

it("leaves destination selection while restore runs, then allows a second restore", async () => {
    const restores: string[] = []
    window.webkit = {
        messageHandlers: {
            resticNative: {
                postMessage(raw) {
                    const request = JSON.parse(raw)
                    if (request.type === "snapshot.list") {
                        window.__snapshotterResolve?.(request.id, {
                            ok: true,
                            data: [],
                        })
                    } else if (request.type === "restore.destination.choose") {
                        window.__snapshotterResolve?.(request.id, {
                            ok: true,
                            data: "/restore",
                        })
                    } else if (request.type === "snapshot.restore") {
                        restores.push(request.id)
                    }
                },
            },
        },
    }
    render(
        <SnapshotBrowser
            snapshot={{
                id: "snapshot",
                time: "2026-01-01",
                hostname: "mac",
                paths: [],
                tags: [],
                fileCount: 1,
                totalSize: 1,
            }}
            onBack={vi.fn()}
            onDeleted={vi.fn()}
        />,
    )
    await waitFor(() =>
        expect(screen.getByText("This folder is empty")).toBeTruthy(),
    )
    for (let index = 0; index < 2; index++) {
        fireEvent.click(screen.getByRole("button", { name: "Restore" }))
        await waitFor(() =>
            expect(screen.getByRole("status").textContent).toContain(
                "Restoring",
            ),
        )
        expect(screen.queryByText("Choose where to restore…")).toBeNull()
        await act(async () =>
            window.__snapshotterRestoreProgress?.({
                phase: "restoring",
                filesDone: 3,
                bytesDone: 1024,
            }),
        )
        expect(screen.getByRole("status").textContent).toContain(
            "3 files processed",
        )
        await act(async () =>
            window.__snapshotterResolve?.(restores[index], {
                ok: true,
                data: { restoredFiles: 1 },
            }),
        )
        await screen.findByText("Restored 1 file")
    }
})

it("cancels the picker without cancelling an engine operation and can retry after failure", async () => {
    let pickerID = ""
    let chooseCount = 0
    const types: string[] = []
    window.webkit = {
        messageHandlers: {
            resticNative: {
                postMessage(raw) {
                    const { id, type } = JSON.parse(raw)
                    types.push(type)
                    if (type === "snapshot.list")
                        window.__snapshotterResolve?.(id, {
                            ok: true,
                            data: [],
                        })
                    if (type === "restore.destination.choose") {
                        pickerID = id
                        if (++chooseCount > 1)
                            window.__snapshotterResolve?.(id, {
                                ok: true,
                                data: "/restore",
                            })
                    }
                    if (type === "restore.destination.cancel") {
                        window.__snapshotterResolve?.(pickerID, {
                            ok: true,
                            data: null,
                        })
                        window.__snapshotterResolve?.(id, { ok: true })
                    }
                    if (type === "snapshot.restore")
                        window.__snapshotterResolve?.(id, {
                            ok: false,
                            error: "Destination is not writable",
                        })
                },
            },
        },
    }
    render(
        <SnapshotBrowser
            snapshot={{
                id: "snapshot",
                time: "2026-01-01",
                hostname: "mac",
                paths: [],
                tags: [],
                fileCount: 1,
                totalSize: 1,
            }}
            onBack={vi.fn()}
            onDeleted={vi.fn()}
        />,
    )
    await screen.findByText("This folder is empty")
    fireEvent.click(screen.getByRole("button", { name: "Restore" }))
    fireEvent.click(screen.getByRole("button", { name: "Cancel restore" }))
    await screen.findByText("Restore cancelled")
    expect(types).not.toContain("operation.cancel")
    fireEvent.click(screen.getByRole("button", { name: "Restore" }))
    await screen.findByText("Destination is not writable")
    expect(
        (screen.getByRole("button", { name: "Restore" }) as HTMLButtonElement)
            .disabled,
    ).toBe(false)
})
