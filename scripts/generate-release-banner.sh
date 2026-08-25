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
    echo "Release: $VERSION"
    echo
    if command -v gh >/dev/null 2>&1 && [ -n "${GITHUB_REPOSITORY:-}" ]; then
        if gh pr list --repo "$GITHUB_REPOSITORY" --state merged --limit 40 \
            --json title,mergedAt --jq 'sort_by(.mergedAt) | reverse | .[].title' \
            2>"$WS/pr.err" | sed 's/^/- /'; then
            :
        else
            echo "  [gh pr list failed: $(head -n1 "$WS/pr.err" 2>/dev/null || true)]" >&2
        fi
    fi
    echo
    echo "# Recent commits"
    echo
    if git rev-parse --git-dir >/dev/null 2>&1; then
        if prev=$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null); then
            git log --no-color --oneline --no-merges "$prev..HEAD" 2>/dev/null | sed 's/^/- /' || true
        else
            git log --no-color --oneline --no-merges -20 2>/dev/null | sed 's/^/- /' || true
        fi
    fi
    rm -f "$WS/pr.err"
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
# Non-interactive: never block on a user question, and cap the run so a
# misbehaving agent cannot hang the job.
_run_with_timeout() {
    secs=$1
    shift
    set +e
    "$@" &
    pid=$!
    ( sleep "$secs" && kill "$pid" 2>/dev/null ) &
    killer=$!
    wait "$pid"
    rc=$?
    kill "$killer" 2>/dev/null
    set -e
    return "$rc"
}
OPENCODE_TIMEOUT_SEC="${OPENCODE_TIMEOUT_SEC:-900}"

if [ -n "${OPENCODE_API_KEY:-}" ] && [ -n "${OPENCODE_BASE_URL:-}" ] && [ -n "${OPENCODE_MODEL_ID:-}" ]; then
    if ! command -v opencode2 >/dev/null 2>&1; then
        echo "banner: installing opencode-ai ..." >&2
        npm install -g @opencode-ai/cli >/dev/null 2>&1 || true
        export PATH="$(npm config get prefix)/bin:$PATH"
    fi
    export OPENCODE_API_KEY OPENCODE_BASE_URL OPENCODE_MODEL_ID

    # Provision image tooling the agent may reach for (Pillow via a venv) so
    # `python3` has PIL. Chrome and sips ship with the runner.
    if [ ! -x "$WS/.venv/bin/python3" ]; then
        python3 -m venv "$WS/.venv" 2>/dev/null || true
        "$WS/.venv/bin/python3" -m pip install --quiet --disable-pip-version-check Pillow 2>/dev/null || true
    fi
    export PATH="$WS/.venv/bin:$PATH"

    cat > "$WS/prompt.md" <<PROMPT
You are generating the promotional banner for the Snapshotter release described
in $WS/changelog.md. Version to feature: $VERSION.

A skill file with detailed rules is at
$WS/skills/design-promotional-banner/SKILL.md — read it and follow it. The key
requirements are restated here so you can satisfy them regardless of tooling.

1. CHANGELOG-DRIVEN HERO. The single message must come from changelog.md. If it
   names a concrete user-facing feature or milestone (new capability, new
   storage backend, new secret store, notable integration), that is the hero.
   If it is only fixes/CI/polish, make the message "Bug fixes and polish" —
   concrete, not noise. Do not invent features, numbers, dates, or metrics.

2. On-brand but not the template. Adapt $WS/index.html in place. Keep the kit
   recognizably Snapshotter: near-black background, light text, one accent
   (base #0a84ff, but shift it to fit the changelog/milestone), the rounded
   shield mark, a system font stack. You MUST change the hero message, copy,
   and accent so the result cannot be confused with the default fallback.

3. Design rules. One message, three levels max (hook, support line, CTA).
   Hierarchy by size/weight/colour, not boxes/borders/shadows. Headline under 6
   words, support under 12, 1.5x size separation, headline line-height ~1.1,
   letter-spacing -0.02em. Keep content inside ~5% padding. One CTA, verb-first,
   specific outcome. Contrast: 7:1 headline, 4.5:1 body. Fix a calm zone behind
   the type. No hover/scroll/position:fixed; it is a still snapshot. Test with
   filter: grayscale(1) and at 25% scale.

4. ANTI-SLOP COPY. No empty verbs (elevate, unlock, transform, empower,
   streamline), no "the future of X", no negative parallelism ("not just X"),
   no aspiration filler, no adjective stacks, no invented numbers, zero
   exclamation marks, zero emoji, no questions answerable with "no", no
   second-person flattery. Headline states the concrete change.

5. RENDER. Produce banner.png (1600x900) in the workspace:
   - Render $WS/index.html with headless Chrome at 2x and downscale with sips:
       "$CHROME" --headless --disable-gpu --hide-scrollbars \
         --force-device-scale-factor=2 --window-size=1600,900 \
         --screenshot=banner.png index.html
       sips -z 900 1600 banner.png
   - Available tools: Chrome (above path), sips, and a Python 3 venv with Pillow
     (use `python3` — PIL is importable). ImageMagick is NOT installed; do not
     call `magick`/`convert`. Do not `pip install` into the system python.
   - Verify banner.png exists and is non-empty before finishing.

6. NON-INTERACTIVE. This is an unattended CI run: never ask the user anything,
   never block waiting for input; work autonomously to completion.
PROMPT
    if ( cd "$WS" && _run_with_timeout "$OPENCODE_TIMEOUT_SEC" \
            opencode2 run --standalone --auto --thinking \
                "$(cat "$WS/prompt.md")" 2>&1 ) \
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