import { LoaderCircle } from "lucide-react"

export function Loading() {
    return (
        <div className="center-state">
            <LoaderCircle className="spinner" />
            <span>Loading…</span>
        </div>
    )
}
