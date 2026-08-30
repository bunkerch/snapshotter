import type { ReactNode } from "react"

export function SectionTitle({
    title,
    action,
    icon,
    onAction,
}: {
    title: string
    action: string
    icon?: ReactNode
    onAction: () => void
}) {
    return (
        <div className="section-title">
            <h2>{title}</h2>
            <button
                type="button"
                aria-label={`${action} ${title}`}
                onClick={onAction}
            >
                {icon}
                {action}
            </button>
        </div>
    )
}
