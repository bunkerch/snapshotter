export interface Repository {
    id: string
    name: string
    kind: "local" | "sftp" | "s3" | "rest"
    location: string
    secretStorage?: SecretStorage
}

export interface SecretStorage {
    provider: "onepassword"
    account: string
    vaultID: string
    itemID?: string
}

export interface Source {
    id: string
    path: string
    enabled: boolean
    excluded: boolean
}

export interface Exclusion {
    id: string
    pattern: string
    enabled: boolean
    builtin: boolean
}

export interface ApplicationPreset {
    id: string
    name: string
    paths: string[]
    enabled: boolean
    available: boolean
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
    exclusions: Exclusion[]
    selectedApps: string[]
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
    applicationPresets: ApplicationPreset[]
    snapshots: Snapshot[]
    status: "unconfigured" | "locked" | "ready"
}

export interface BackupProgress {
    phase: "idle" | "backing-up" | "complete" | "error"
    filesDone: number
    bytesDone: number
}
