import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { App } from "./App"
import { requestNative } from "./bridge"
import type { ApplicationState } from "./model"

const nativeProgress = vi.hoisted(() => ({
    listener: undefined as
        | ((progress: {
              phase: string
              filesDone?: number
              bytesDone?: number
          }) => void)
        | undefined,
}))

vi.mock("./bridge", () => ({
    requestNative: vi.fn(),
    isPackagedHost: () => false,
    subscribeToBackupProgress: (listener: typeof nativeProgress.listener) => {
        nativeProgress.listener = listener
        return () => {
            nativeProgress.listener = undefined
        }
    },
}))

const readyState: ApplicationState = {
    status: "ready",
    preferences: {
        version: 1,
        repository: {
            id: "repository",
            name: "Archive",
            kind: "local",
            location: "/Volumes/Archive",
        },
        sources: [
            {
                id: "documents",
                path: "/Users/example/Documents",
                enabled: true,
                excluded: false,
            },
        ],
        exclusions: [
            {
                id: "node-modules",
                pattern: "**/node_modules",
                enabled: true,
                builtin: true,
            },
        ],
        selectedApps: [],
        schedule: {
            enabled: true,
            kind: "daily",
            interval: 1,
            hour: 9,
            minute: 0,
            weekday: 1,
        },
        retention: {
            hourly: 0,
            daily: 7,
            weekly: 4,
            monthly: 12,
            yearly: 0,
        },
        launchAtLogin: false,
    },
    applicationPresets: [
        {
            id: "firefox",
            name: "Firefox",
            paths: [
                "/Users/example/Library/Application Support/Firefox/Profiles",
            ],
            enabled: false,
            available: true,
        },
    ],
    snapshots: [
        {
            id: "abcdef0123456789",
            time: "2026-07-11T00:20:00Z",
            hostname: "example.local",
            paths: ["/Users/example/Documents"],
            tags: [],
            fileCount: 42,
            totalSize: 1024,
        },
    ],
}

describe("Snapshotter app", () => {
    beforeEach(() => {
        vi.mocked(requestNative).mockImplementation(async (type) => {
            if (type === "state.get") return readyState
            if (type === "snapshot.list") {
                return [
                    {
                        name: "report.pdf",
                        path: "/Users/example/Documents/report.pdf",
                        type: "file",
                        size: 2048,
                        modTime: "2026-07-10T12:00:00Z",
                    },
                ]
            }
            return readyState
        })
    })

    afterEach(() => {
        cleanup()
        vi.clearAllMocks()
    })

    it("hides navigation until a repository is configured", async () => {
        vi.mocked(requestNative).mockResolvedValueOnce({
            ...readyState,
            status: "unconfigured",
            preferences: {
                ...readyState.preferences,
                repository: undefined,
                sources: [],
            },
            snapshots: [],
        })
        render(<App />)

        expect(await screen.findByText("Set up your backup")).toBeTruthy()
        expect(screen.queryByRole("navigation")).toBeNull()
    })

    it("configures an S3 repository without persisting credentials in UI state", async () => {
        vi.mocked(requestNative).mockResolvedValueOnce({
            ...readyState,
            status: "unconfigured",
            preferences: {
                ...readyState.preferences,
                repository: undefined,
                sources: [],
            },
            snapshots: [],
        })
        render(<App />)
        await screen.findByText("Set up your backup")

        fireEvent.click(screen.getByRole("button", { name: "S3" }))
        fireEvent.change(screen.getByLabelText("Password"), {
            target: { value: "repository-secret" },
        })
        fireEvent.change(screen.getByLabelText("Destination"), {
            target: { value: "s3:s3.amazonaws.com/archive/snapshotter" },
        })
        fireEvent.change(screen.getByLabelText("Access key"), {
            target: { value: "access" },
        })
        fireEvent.change(screen.getByLabelText("Secret key"), {
            target: { value: "secret" },
        })
        fireEvent.click(screen.getByRole("button", { name: "Continue" }))

        await waitFor(() => {
            expect(requestNative).toHaveBeenCalledWith(
                "repository.configure.remote",
                expect.objectContaining({
                    kind: "s3",
                    location: "s3:s3.amazonaws.com/archive/snapshotter",
                    credentials: expect.objectContaining({
                        accessKey: "access",
                        secretKey: "secret",
                    }),
                }),
            )
        })
    })

    it("configures an existing remote repository", async () => {
        vi.mocked(requestNative).mockResolvedValueOnce({
            ...readyState,
            status: "unconfigured",
            preferences: {
                ...readyState.preferences,
                repository: undefined,
                sources: [],
            },
            snapshots: [],
        })
        render(<App />)
        await screen.findByText("Set up your backup")

        fireEvent.click(screen.getByRole("button", { name: "SFTP" }))
        fireEvent.change(screen.getByLabelText("Password"), {
            target: { value: "repository-secret" },
        })
        fireEvent.change(screen.getByLabelText("Destination"), {
            target: { value: "sftp:user@example.com:/archive" },
        })
        fireEvent.click(screen.getByRole("button", { name: "Continue" }))

        await waitFor(() => {
            expect(requestNative).toHaveBeenCalledWith(
                "repository.configure.remote",
                expect.objectContaining({
                    kind: "sftp",
                    location: "sftp:user@example.com:/archive",
                }),
            )
        })
    })

    it("opens a repository with secrets synced from 1Password", async () => {
        const unconfigured = {
            ...readyState,
            status: "unconfigured" as const,
            preferences: {
                ...readyState.preferences,
                repository: undefined,
                sources: [],
            },
            snapshots: [],
        }
        vi.mocked(requestNative).mockImplementation(async (type) => {
            if (type === "state.get") return unconfigured
            if (type === "onepassword.accounts") {
                return [
                    {
                        id: "account-id",
                        name: "Personal",
                    },
                    {
                        id: "work-account-id",
                        name: "Work",
                    },
                ]
            }
            if (type === "onepassword.vaults") {
                return [{ id: "vault-id", title: "Private" }]
            }
            if (type === "onepassword.items") {
                return [
                    {
                        id: "item-id",
                        title: "Archive",
                        kind: "s3",
                        location: "s3:s3.amazonaws.com/archive/snapshotter",
                    },
                    { id: "legacy-item", title: "Legacy" },
                ]
            }
            return readyState
        })
        render(<App />)
        await screen.findByText("Set up your backup")

        fireEvent.click(screen.getByRole("button", { name: "1Password" }))
        const account = await screen.findByRole<HTMLSelectElement>("combobox", {
            name: "1Password account",
        })
        expect(account.value).toBe("account-id")
        fireEvent.change(account, { target: { value: "work-account-id" } })
        fireEvent.click(screen.getByRole("button", { name: "Load vaults" }))
        await screen.findByRole("combobox", { name: "Vault" })
        fireEvent.click(
            screen.getByRole("button", { name: "Use synced secrets…" }),
        )
        fireEvent.change(
            await screen.findByRole("combobox", {
                name: "Snapshotter item",
            }),
            { target: { value: "item-id" } },
        )
        expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe(
            "Archive",
        )
        expect(
            screen.getByLabelText<HTMLInputElement>("Destination").value,
        ).toBe("s3:s3.amazonaws.com/archive/snapshotter")

        fireEvent.change(
            screen.getByRole("combobox", { name: "Snapshotter item" }),
            { target: { value: "legacy-item" } },
        )
        expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe(
            "Legacy",
        )
        expect(screen.queryByLabelText("Destination")).toBeNull()

        fireEvent.change(
            screen.getByRole("combobox", { name: "Snapshotter item" }),
            { target: { value: "item-id" } },
        )
        fireEvent.click(screen.getByRole("button", { name: "Continue" }))

        await waitFor(() => {
            expect(requestNative).toHaveBeenCalledWith(
                "repository.configure.remote",
                expect.objectContaining({
                    password: "",
                    secretStorage: {
                        provider: "onepassword",
                        account: "work-account-id",
                        vaultID: "vault-id",
                        itemID: "item-id",
                    },
                }),
            )
        })
    })

    it("renders persisted sources and browses real snapshot entries", async () => {
        render(<App />)

        expect(await screen.findByText("Documents")).toBeTruthy()
        fireEvent.click(
            screen.getByRole("button", { name: "Disable Documents" }),
        )
        await waitFor(() => {
            expect(requestNative).toHaveBeenCalledWith("source.setEnabled", {
                id: "documents",
                enabled: false,
            })
        })
        fireEvent.click(
            screen.getByRole("button", { name: "Remove Documents" }),
        )
        await waitFor(() => {
            expect(requestNative).toHaveBeenCalledWith("source.remove", {
                id: "documents",
            })
        })
        fireEvent.click(screen.getByRole("button", { name: "Snapshots" }))
        fireEvent.click(await screen.findByText("42 files"))

        expect(await screen.findByText("report.pdf")).toBeTruthy()
        expect(requestNative).toHaveBeenCalledWith("snapshot.list", {
            snapshotID: "abcdef0123456789",
            path: "/",
        })

        fireEvent.click(screen.getByRole("button", { name: "Delete snapshot" }))
        expect(
            screen.getByText("Delete this snapshot and reclaim its space?"),
        ).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Delete" }))
        await waitFor(() => {
            expect(requestNative).toHaveBeenCalledWith("snapshot.delete", {
                snapshotID: "abcdef0123456789",
            })
        })
    })

    it("opens retention settings and explains packaged-only login", async () => {
        render(<App />)
        await screen.findByText("Documents")
        fireEvent.click(
            within(screen.getByRole("navigation")).getByRole("button", {
                name: "Settings",
            }),
        )
        fireEvent.click(screen.getByRole("button", { name: /Smart retention/ }))
        fireEvent.click(
            screen.getByRole("button", { name: /Change repository/ }),
        )

        expect(
            screen.getByText(/Stored snapshots remain untouched/),
        ).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Disconnect" }))
        await waitFor(() => {
            expect(requestNative).toHaveBeenCalledWith(
                "repository.disconnect",
                { repositoryID: "repository" },
            )
        })

        expect(
            screen.getByText(/Applied after every successful backup/),
        ).toBeTruthy()
        expect(screen.getByText("Available in the packaged app")).toBeTruthy()
        await waitFor(() => {
            expect(
                screen.getByRole<HTMLButtonElement>("button", {
                    name: "Toggle start at login",
                }).disabled,
            ).toBe(true)
            expect(
                screen.getByRole("button", { name: /Repair index/ }),
            ).toBeTruthy()
        })
    })

    it("edits and displays schedules as wall-clock time", async () => {
        render(<App />)
        await screen.findByText("Documents")
        fireEvent.click(
            within(screen.getByRole("navigation")).getByRole("button", {
                name: "Settings",
            }),
        )

        expect(screen.getByText("Daily at 09:00")).toBeTruthy()
        expect(
            screen.getByLabelText<HTMLInputElement>("Backup time").value,
        ).toBe("09:00")
        fireEvent.change(screen.getByLabelText("Backup time"), {
            target: { value: "18:45" },
        })

        await waitFor(() => {
            expect(requestNative).toHaveBeenCalledWith("schedule.set", {
                ...readyState.preferences.schedule,
                hour: 18,
                minute: 45,
            })
        })
    })

    it("configures application presets and exclusion patterns", async () => {
        render(<App />)
        await screen.findByText("Documents")

        fireEvent.click(screen.getByRole("button", { name: /Applications/ }))
        fireEvent.click(screen.getByRole("button", { name: "Back up Firefox" }))
        await waitFor(() => {
            expect(requestNative).toHaveBeenCalledWith(
                "application.setEnabled",
                { id: "firefox", enabled: true },
            )
        })

        fireEvent.click(screen.getByRole("button", { name: /Exclusions/ }))
        fireEvent.change(screen.getByLabelText("Custom exclusion pattern"), {
            target: { value: "**/.generated" },
        })
        fireEvent.click(screen.getByRole("button", { name: "Add" }))
        await waitFor(() => {
            expect(requestNative).toHaveBeenCalledWith("exclusion.add", {
                pattern: "**/.generated",
            })
        })
    })

    it("shows real counters streamed by the native backup engine", async () => {
        render(<App />)
        await screen.findByText("Documents")

        act(() => {
            nativeProgress.listener?.({
                phase: "backing-up",
                filesDone: 42,
                bytesDone: 2048,
            })
        })

        expect(await screen.findByText("42 files · 2.0 KB")).toBeTruthy()
        expect(screen.queryByText(/%/)).toBeNull()
    })

    it("cancels an active backup", async () => {
        render(<App />)
        await screen.findByText("Documents")

        act(() => {
            nativeProgress.listener?.({
                phase: "backing-up",
                filesDone: 1,
                bytesDone: 1024,
            })
        })
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

        await waitFor(() => {
            expect(requestNative).toHaveBeenCalledWith("operation.cancel")
        })
    })
})
