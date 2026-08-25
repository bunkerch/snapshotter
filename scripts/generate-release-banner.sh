#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT="${BANNER_OUT:-$ROOT/build/Snapshotter-banner.png}"
VERSION="${BANNER_VERSION:-0.1.0}"
WS="$ROOT/build/banner-workspace"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SIZE_W=1600
SIZE_H=900

mkdir -p "$WS"

# --- Gather the changelog ---
CHANGELOG="$WS/changelog.md"
{
    echo "# What changed"
    echo
    if command -v gh >/dev/null 2>&1; then
        gh pr list --repo "${GITHUB_REPOSITORY:-}" --state merged --limit 25 \
            --json title,mergedAt --jq 'sort_by(.mergedAt) | reverse | .[].title' 2>/dev/null \
            | sed 's/^/- /' || true
    fi
    if git rev-parse --git-dir >/dev/null 2>&1; then
        prev=$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || true)
        if [ -n "$prev" ]; then
            echo
            echo "# Commits since $prev"
            echo
            git log --oneline --no-merges "$prev..HEAD" 2>/dev/null | sed 's/^/- /' || true
        fi
    fi
} > "$CHANGELOG"

# --- Prepare workspace (template + version + isolation config + skill) ---
cp -R "$ROOT/scripts/banner/." "$WS/"
sed "s/__VERSION__/$(printf '%s' "$VERSION" | sed 's/[&/\]/\\&/g')/g" \
    "$ROOT/scripts/banner/index.html" > "$WS/index.html"

# --- Fallback render so a banner always exists ---
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --window-size=${SIZE_W},${SIZE_H} --screenshot="$OUT" "$WS/index.html" >/dev/null 2>&1
sips -z "$SIZE_H" "$SIZE_W" "$OUT" --out "$OUT" >/dev/null 2>&1

# --- AI banner: only when a provider is configured ---
if [ -n "${OPENCODE_API_KEY:-}" ] && [ -n "${OPENCODE_BASE_URL:-}" ] && [ -n "${OPENCODE_MODEL_ID:-}" ]; then
    command -v opencode2 >/dev/null 2>&1 || npm install -g opencode-ai >/dev/null 2>&1 || true
    export OPENCODE_API_KEY OPENCODE_BASE_URL OPENCODE_MODEL_ID
    cat > "$WS/prompt.md" <<PROMPT
You are generating the promotional banner for the Snapshotter release shown in
$WS/changelog.md.

Load the design-promotional-banner skill and follow it. Adapt $WS/index.html in
place so the banner hero reflects the changelog (a milestone if there is one,
otherwise the bug fixes / polish). Vary the accent treatment tastefully while
staying recognisably on-brand. Then render the final 1600x900 image to
banner.png in the workspace using headless Chrome at 2x and downscaling with
sips (see the skill). Finish only once banner.png exists and is non-empty.
PROMPT
    if (cd "$WS" && opencode2 run --auto --dir "$WS" "$(cat "$WS/prompt.md")" >/dev/null 2>&1) \
        && [ -s "$WS/banner.png" ]; then
        cp "$WS/banner.png" "$OUT"
        echo "banner: opencode-generated"
    else
        echo "banner: opencode generation failed; keeping fallback" >&2
    fi
else
    echo "banner: fallback (opencode not configured)" >&2
fi

test -s "$OUT" || { echo "failed to produce $OUT" >&2; exit 1; }
echo "banner: $OUT"