import { Settings2, ShieldCheck } from "lucide-react"
import type { View } from "../App"

export function Header({
    view,
    onView,
    showNavigation,
}: {
    view: View
    onView: (view: View) => void
    showNavigation: boolean
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
                {showNavigation && (
                    <button
                        type="button"
                        className="icon-button"
                        aria-label="Settings"
                        onClick={() => onView("settings")}
                    >
                        <Settings2 size={17} />
                    </button>
                )}
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
