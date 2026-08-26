#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT="${BANNER_OUT:-$ROOT/build/Snapshotter-banner.png}"
SUMMARY_OUT="${SUMMARY_OUT:-$ROOT/build/release-summary.txt}"
VERSION="${BANNER_VERSION:-0.1.0}"
WS="$ROOT/build/banner-workspace"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SIZE_W=1600
SIZE_H=900

# Release-channel accent (saturated green/yellow): green for stable, yellow for
# pre-release — derived from GitHub's palette, deepened so it reads on dark.
ACCENT="#4ADE80"
RELEASE_TYPE="stable release"
if [ "${BANNER_PRERELEASE:-false}" = "true" ]; then
    ACCENT="#F7C948"
    RELEASE_TYPE="pre-release"
fi

mkdir -p "$WS"

# --- Gather the changelog, scoped to this release's diff base ---
# Diff base = the immediately-previous release tag in semantic-version order.
# For a STABLE release, prereleases of the same version are skipped so the
# notes recap the whole release line (e.g. v1.0.2 recaps rc.1 + final, based on
# v1.0.1), not just the last rc. For a PRE-RELEASE the base is the prior tag
# (v1.0.2-rc.2 diffs against v1.0.2-rc.1).
CHANGELOG="$WS/changelog.md"
tag_file="$WS/tags.txt"
git tag --sort=version:refname 2>/dev/null > "$tag_file" || true

prev=""
if [ -n "${RELEASE_TAG:-}" ]; then
    cur="$RELEASE_TAG"
    cur_base="${cur%%-*}"
    idx=$(grep -nxF "$cur" "$tag_file" 2>/dev/null | cut -d: -f1 || true)
    if [ -n "$idx" ]; then
        i=$((idx - 1))
        while [ "$i" -ge 1 ]; do
            t=$(sed -n "${i}p" "$tag_file")
            t_base=${t%%-*}
            if [ "$cur" = "$cur_base" ] && [ "$t" != "$t_base" ] && [ "$t_base" = "$cur_base" ]; then
                i=$((i - 1))
                continue
            fi
            prev="$t"
            break
        done
    fi
else
    prev="$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || true)"
fi

{
    echo "# What changed (this release)"
    echo
    echo "Release: $VERSION"
    echo
    if [ -n "$prev" ]; then
        echo "Changes since $prev:"
        echo
        git log --no-color --oneline --no-merges "$prev..HEAD" 2>/dev/null | sed 's/^/- /' || true
    else
        echo "No previous release tag; showing the complete history:"
        echo
        git log --no-color --oneline --no-merges 2>/dev/null | sed 's/^/- /' || true
    fi
} > "$CHANGELOG"
rm -f "$tag_file"

# --- Prepare workspace (template + version + isolation config + skill) ---
cp -R "$ROOT/scripts/banner/." "$WS/"
sed -e "s/__VERSION__/$(printf '%s' "$VERSION" | sed 's/[&/\]/\\&/g')/g" \
    -e "s/__ACCENT__/$ACCENT/g" \
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
        "$WS/.venv/bin/python3" -m pip install --quiet --disable-pip-version-check Pillow numpy 2>/dev/null || true
    fi
    export PATH="$WS/.venv/bin:$PATH"

    # The model often reaches for ImageMagick; install magick/convert so that
    # path works too. Best-effort (brew may be slow) — sips/Pillow still cover it.
    if ! command -v magick >/dev/null 2>&1 && command -v brew >/dev/null 2>&1; then
        echo "banner: installing imagemagick ..." >&2
        brew install imagemagick >/dev/null 2>&1 || true
    fi

    cat > "$WS/prompt.md" <<PROMPT
You are generating the promotional banner for the Snapshotter release described
in $WS/changelog.md. Version to feature: $VERSION.

This is the $RELEASE_TYPE. Its accent colour is $ACCENT (green for a stable
release, yellow for a pre-release); it is already set in index.html. Keep that
exact accent hue — do not shift it to something else.

A skill file with detailed rules is at
$WS/skills/design-promotional-banner/SKILL.md — read it and follow it. The key
requirements are restated here so you can satisfy them regardless of tooling.

1. CHANGELOG-DRIVEN HERO. The single message must come from changelog.md. If it
   names a concrete user-facing feature or milestone (new capability, new
   storage backend, new secret store, notable integration), that is the hero.
   If it is only fixes/CI/polish, make the message "Bug fixes and polish" —
   concrete, not noise. Do not invent features, numbers, dates, or metrics.

2. On-brand but not the template. Adapt $WS/index.html in place. Keep the kit
   recognizably Snapshotter: near-black background, light text, the release-type
   accent ($ACCENT), the rounded shield mark, the subtle grid background, and a
   system font stack. You MUST change the hero message and copy so the result
   cannot be confused with the default fallback, but keep the accent hue.

3. Design rules. One message, at most a hook + support line. Hierarchy by
   size/weight/colour, not boxes/borders/shadows. Headline under 6 words,
   support under 12, 1.5x size separation, headline line-height ~1.1,
   letter-spacing -0.02em. Keep content inside ~5% padding. NO call-to-action
   button or pill — the banner is a static image rendered in release notes and
   is never a link; end the composition with the version or a short neutral
   tagline instead of a button. Contrast: 7:1 headline, 4.5:1 body. Fix a calm
   zone behind the type. No hover/scroll/position:fixed; it is a still
   snapshot. Test with filter: grayscale(1) and at 25% scale.

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
   - Available tools: Chrome (above path), sips, ImageMagick
     (magick/convert), and a Python 3 venv with Pillow (use python3 — PIL is
     importable). Prefer sips/Pillow for resizing; use whatever works. Do not
     pip install into the system python.
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

    # --- AI release summary (playful prose derived from the changelog) ---
    cat > "$WS/summary-prompt.md" <<SPROMPT
You are writing the opening summary for the Snapshotter release notes.

Read the change list at $WS/changelog.md (PR titles and commit titles) and
write a short, warm, slightly playful summary of what this release is about.

Rules:
- 2 to 4 sentences max. Plain prose, no markdown, no bullets, no heading.
- Reflect what actually changed. For a mostly-bug-fix release, a light tone is
  welcome (such as a nod to squashing bugs). If there is a standout feature or
  milestone, lead with that.
- Do not invent features, numbers, dates, or metrics. Do not mention AI or
  build tooling unless it is genuinely user-facing.
- No exclamation marks, no emoji, no second-person flattery.
Write the final text only, then save exactly that text (nothing else) to
$WS/release-summary.txt.
SPROMPT
    if ( cd "$WS" && _run_with_timeout "$OPENCODE_TIMEOUT_SEC" \
            opencode2 run --standalone --auto \
                "$(cat "$WS/summary-prompt.md")" 2>&1 ) \
        && [ -s "$WS/release-summary.txt" ]; then
        echo "summary: opencode-generated"
    else
        echo "summary: AI failed; using fallback text" >&2
    fi
else
    echo "banner: fallback (opencode not configured)" >&2
fi

# --- Ensure a summary file always exists (fallback when AI unavailable) ---
mkdir -p "$(dirname "$SUMMARY_OUT")"
if [ -s "$WS/release-summary.txt" ]; then
    cp "$WS/release-summary.txt" "$SUMMARY_OUT"
else
    printf 'A new Snapshotter build is here — the full change list is below.\n' > "$SUMMARY_OUT"
fi

test -s "$OUT" || { echo "failed to produce $OUT" >&2; exit 1; }
echo "banner: $OUT"
echo "summary: $SUMMARY_OUT"