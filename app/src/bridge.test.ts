import { afterEach, describe, expect, it, vi } from "vitest"
import { requestNative, subscribeToBackupProgress } from "./bridge"

describe("native bridge", () => {
    afterEach(() => {
        delete window.webkit
        vi.restoreAllMocks()
    })

    it("resolves responses from the native host", async () => {
        vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
            "00000000-0000-4000-8000-000000000000",
        )
        const postMessage = vi.fn()
        window.webkit = {
            messageHandlers: { resticNative: { postMessage } },
        }

        const result = requestNative<{ status: string }>("state.get")
        window.__snapshotterResolve?.("00000000-0000-4000-8000-000000000000", {
            ok: true,
            data: { status: "unconfigured" },
        })

        await expect(result).resolves.toEqual({ status: "unconfigured" })
        expect(postMessage).toHaveBeenCalledOnce()
    })

    it("streams native backup counters", () => {
        const listener = vi.fn()
        const unsubscribe = subscribeToBackupProgress(listener)

        window.__snapshotterProgress?.({
            phase: "backing-up",
            filesDone: 42,
            bytesDone: 2048,
        })

        expect(listener).toHaveBeenCalledWith({
            phase: "backing-up",
            filesDone: 42,
            bytesDone: 2048,
        })
        unsubscribe()
    })

    it("is safe in a regular browser", () => {
        window.webkit = undefined
        const result = requestNative("state.get")
        void result.catch(() => {})
    })
})
