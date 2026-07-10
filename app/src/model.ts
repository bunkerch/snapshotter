export type BackupState = "idle" | "running" | "attention"

export interface Source {
    id: string
    name: string
    path: string
    size: string
    enabled: boolean
}

export interface Snapshot {
    id: string
    label: string
    relativeTime: string
    size: string
    files: string
}

export interface Dashboard {
    state: BackupState
    lastBackup: string
    nextBackup: string
    repository: string
    repositoryDetail: string
    sources: Source[]
    snapshots: Snapshot[]
}
