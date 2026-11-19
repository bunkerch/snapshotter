import { ShieldCheck } from "lucide-react"
import type { View } from "../App"

export function Header({
    view,
    onView,
    showNavigation,
    busy = false,
}: {
    view: View
    onView: (view: View) => void
    showNavigation: boolean
    busy?: boolean
}) {
    return (
        <>
            <header className="titlebar">
                <div className="brand">
                    <div className="brand-mark">
                        <ShieldCheck />
                    </div>
                    <span>Snapshotter</span>
                </div>
            </header>
            {showNavigation && (
                <nav className="segmented" aria-label="Main navigation">
                    {(["overview", "snapshots", "settings"] as const).map(
                        (item) => (
                            <button
                                type="button"
                                key={item}
                                className={view === item ? "selected" : ""}
                                aria-pressed={view === item}
                                disabled={busy && view !== item}
                                onClick={() => onView(item)}
                            >
                                {item[0].toUpperCase() + item.slice(1)}
                            </button>
                        ),
                    )}
                </nav>
            )}
        </>
    )
}
