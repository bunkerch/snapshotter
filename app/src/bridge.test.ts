import { afterEach, describe, expect, it, vi } from "vitest"
import { isNativeHost, requestNative, sendNative } from "./bridge"

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

    it("posts JSON requests to WKWebView", () => {
        const postMessage = vi.fn()
        window.webkit = {
            messageHandlers: { resticNative: { postMessage } },
        }

        sendNative("backup.start", { source: "documents" })

        expect(postMessage).toHaveBeenCalledWith(
            JSON.stringify({
                type: "backup.start",
                payload: { source: "documents" },
            }),
        )
        expect(isNativeHost()).toBe(true)
    })

    it("is safe in a regular browser", () => {
        expect(() => sendNative("backup.start")).not.toThrow()
        expect(isNativeHost()).toBe(false)
    })
})
