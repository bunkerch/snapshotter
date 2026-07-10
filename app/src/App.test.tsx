import {
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

vi.mock("./bridge", () => ({
    requestNative: vi.fn(),
    isPackagedHost: () => false,
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

    it("renders persisted sources and browses real snapshot entries", async () => {
        render(<App />)

        expect(await screen.findByText("Documents")).toBeTruthy()
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
})
