import type { ApplicationState } from "../model"

export function message(error: unknown) {
    return error instanceof Error ? error.message : "Something went wrong"
}
export function destinationPlaceholder(kind: "s3" | "sftp" | "rest") {
    if (kind === "s3") return "s3:s3.amazonaws.com/bucket/snapshotter"
    if (kind === "sftp") return "sftp:user@host:/backups/snapshotter"
    return "rest:https://backup.example.com/snapshotter"
}
export function basename(path: string) {
    return path.split("/").filter(Boolean).at(-1) ?? path
}
export function formatDate(value: string) {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(value))
}
export function formatRelative(value: string) {
    const minutes = Math.max(
        0,
        Math.round((Date.now() - new Date(value).getTime()) / 60000),
    )
    return minutes < 1
        ? "just now"
        : minutes < 60
          ? `${minutes}m ago`
          : minutes < 1440
            ? `${Math.floor(minutes / 60)}h ago`
            : `${Math.floor(minutes / 1440)}d ago`
}
export function formatCount(value: number) {
    return new Intl.NumberFormat().format(value ?? 0)
}
export function formatBytes(value: number) {
    if (!value) return "0 B"
    const units = ["B", "KB", "MB", "GB", "TB"]
    const exponent = Math.min(
        Math.floor(Math.log(value) / Math.log(1024)),
        units.length - 1,
    )
    return `${(value / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}
export function compactPresetPath(path: string) {
    return path.split("/").filter(Boolean).slice(-2).join("/")
}
export function scheduleLabel(state: ApplicationState) {
    const schedule = state.preferences.schedule
    if (schedule.kind === "weekly") {
        return `${weekdays[schedule.weekday]} at ${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`
    }
    return schedule.kind === "hourly"
        ? `Every ${schedule.interval === 1 ? "hour" : `${schedule.interval} hours`}`
        : `Daily at ${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`
}

export const weekdays = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
]

export function normalizeState(state: ApplicationState): ApplicationState {
    return {
        ...state,
        applicationPresets: state.applicationPresets ?? [],
        snapshots: state.snapshots ?? [],
        preferences: {
            ...state.preferences,
            sources: state.preferences.sources ?? [],
            exclusions: state.preferences.exclusions ?? [],
            selectedApps: state.preferences.selectedApps ?? [],
            alwaysUpdate: state.preferences.alwaysUpdate ?? false,
        },
    }
}
