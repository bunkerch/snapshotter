-- Configure a mounted DMG volume's Finder window: icon view, icon size, background picture, and icon positions.
--
-- The layout targets the Snapshotter install window. The background image is 700x420 points; the app icon
-- is centred in the left landing slot and the Applications alias in the right landing slot. Finder uses a
-- top-left origin with y increasing downward, and icon size/background live on the icon view options object
-- (not the window). The window frame is sized so its icon-view content area (below the title bar) is exactly
-- the 700x420 background, so the background is never clipped.
--
-- Hidden files (.background, .DS_Store, etc.) are pushed off the right edge of the window so they do not
-- appear when the user enables "Show Hidden Files" in Finder.
--
-- Usage: osascript dmg-window.applescript <mountPath> <diskName>
--   mountPath  Absolute path of the mounted volume, e.g. /Volumes/Snapshotter
--   diskName   Volume name as Finder reports it, e.g. Snapshotter

on run argv
    set mountPath to item 1 of argv
    set volumeName to item 2 of argv

    set bgWidth to 700
    set bgHeight to 420
    -- Title bar / toolbar height consumed by the window frame. The bounds are measured from the
    -- frame's top-left, so we add this to the background height to keep the content area exact.
    set chromeOffset to 32
    set winWidth to bgWidth
    set winHeight to bgHeight + chromeOffset
    set iconSize to 128
    -- Window position on screen (top-left of the window frame).
    set winX to 200
    set winY to 200
    -- Icon positions: top-left origin within the content area, y increases downward.
    set appPos to {190, 198}
    set applicationsPos to {510, 198}

    tell application "Finder"
        activate

        -- Finder sometimes reports the disk a moment after mount; retry.
        set dsk to missing value
        repeat with attempt from 1 to 10
            try
                set dsk to disk volumeName
                exit repeat
            on error
                delay 1
            end try
        end repeat
        if dsk is missing value then error "Could not find disk " & volumeName

        open dsk
        delay 1

        -- Force-save so Finder bakes the layout into the volume's .DS_Store before eject.
        my applyLayout(mountPath, dsk, winX, winY, winWidth, winHeight, iconSize, appPos, applicationsPos)
        tell container window of dsk to close
        open dsk
        delay 2
        my applyLayout(mountPath, dsk, winX, winY, winWidth, winHeight, iconSize, appPos, applicationsPos)
        delay 2
    end tell
end run

-- Configure a single pass of the window layout.
on applyLayout(mountPath, dsk, winX, winY, winWidth, winHeight, iconSize, appPos, applicationsPos)
    set offscreenX to winX + winWidth + 120
    set offscreenY to winY + winHeight

    tell application "Finder"
        tell container window of dsk
            set current view to icon view
            set the bounds to {winX, winY, winX + winWidth, winY + winHeight}
            set toolbar visible to false
            set statusbar visible to false
        end tell

        set ivo to icon view options of (container window of dsk)
        set icon size of ivo to iconSize
        set arrangement of ivo to not arranged
        set background picture of ivo to POSIX file (mountPath & "/.background/bg.tiff") as alias

        -- Park every item (including hidden files) off the right edge, then bring the
        -- visible install icons back into their slots so hidden items stay out of view.
        set position of every item of dsk to {offscreenX, offscreenY}
        set position of item "Snapshotter.app" of dsk to appPos
        set position of item "Applications" of dsk to applicationsPos

        update dsk
    end tell
end applyLayout
