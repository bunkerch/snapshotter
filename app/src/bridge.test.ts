import { afterEach, describe, expect, it, vi } from "vitest"
import { isNativeHost, sendNative } from "./bridge"

describe("native bridge", () => {
    afterEach(() => {
        delete window.webkit
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
