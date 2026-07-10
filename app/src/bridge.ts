import type { Dashboard } from "./model"

declare global {
    interface Window {
        webkit?: {
            messageHandlers?: {
                resticNative?: { postMessage(message: string): void }
            }
        }
    }
}

export const initialDashboard: Dashboard = {
    state: "idle",
    lastBackup: "Today, 10:42",
    nextBackup: "in 43 minutes",
    repository: "Home Archive",
    repositoryDetail: "Local disk · /Volumes/Archive",
    sources: [
        {
            id: "desktop",
            name: "Desktop",
            path: "~/Desktop",
            size: "2.4 GB",
            enabled: true,
        },
        {
            id: "documents",
            name: "Documents",
            path: "~/Documents",
            size: "18.7 GB",
            enabled: true,
        },
        {
            id: "developer",
            name: "Developer",
            path: "~/Developer",
            size: "31.2 GB",
            enabled: true,
        },
        {
            id: "config",
            name: "Config files",
            path: "~/.config",
            size: "684 MB",
            enabled: false,
        },
    ],
    snapshots: [
        {
            id: "a39d71",
            label: "Today, 10:42",
            relativeTime: "2 hours ago",
            size: "284 MB",
            files: "128,403 files",
        },
        {
            id: "9d02bc",
            label: "Yesterday, 18:04",
            relativeTime: "Yesterday",
            size: "91 MB",
            files: "128,171 files",
        },
        {
            id: "70e0ff",
            label: "Jul 8, 09:15",
            relativeTime: "2 days ago",
            size: "1.2 GB",
            files: "127,950 files",
        },
    ],
}

export function sendNative(type: string, payload: unknown = {}) {
    window.webkit?.messageHandlers?.resticNative?.postMessage(
        JSON.stringify({ type, payload }),
    )
}

export function isNativeHost() {
    return Boolean(window.webkit?.messageHandlers?.resticNative)
}
