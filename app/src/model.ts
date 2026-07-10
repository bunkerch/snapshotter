export interface Repository {
    id: string
    name: string
    kind: "local" | "sftp" | "s3" | "rest"
    location: string
}

export interface Source {
    id: string
    path: string
    enabled: boolean
    excluded: boolean
}

export interface Schedule {
    enabled: boolean
    kind: "hourly" | "daily" | "weekly"
    interval: number
    hour: number
    minute: number
    weekday: number
}

export interface RetentionPolicy {
    hourly: number
    daily: number
    weekly: number
    monthly: number
    yearly: number
}

export interface Preferences {
    version: number
    repository?: Repository
    sources: Source[]
    schedule: Schedule
    retention: RetentionPolicy
    launchAtLogin: boolean
}

export interface Snapshot {
    id: string
    time: string
    hostname: string
    paths: string[]
    tags: string[]
    fileCount: number
    totalSize: number
}

export interface SnapshotEntry {
    name: string
    path: string
    type: string
    size: number
    modTime: string
}

export interface ApplicationState {
    preferences: Preferences
    snapshots: Snapshot[]
    status: "unconfigured" | "locked" | "ready"
}
