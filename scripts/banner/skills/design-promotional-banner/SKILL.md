# design-promotional-banner

Design promotional banners for what the project ships in a given release. The
agent receives a changelog and must turn it into a single 16:9 HTML/CSS banner
that it renders to PNG in CI.

## When to use

Use this skill whenever a release banner needs to be generated. The banner must
always be driven by the changelog: if the release contains a meaningful feature
or milestone, that milestone is the hero; if it is mostly bug fixes and polish,
the heroes are those fixes.

## Instructions

1. Read `changelog.md` in the workspace and classify the release:
   - A headline feature or milestone (new capability, new storage backend, new
     secret store, a notable new integration) -> make that the one message.
   - Otherwise, "bug fixes and polish" -> make the fixes the one message.
2. Adapt `index.html` in place (keep the file name). Match this project's design
   system: near-black background, light text, a subtle gray grid background, the
   rounded shield mark, and a system font stack. The accent is **fixed by
   release type** and is already substituted into the template: green `#4ADE80`
   for a stable release, yellow `#F7C948` for a pre-release. Keep that accent's
   hue; it signals the release channel. The version is already in the headline.
3. Adapt the layout to the changelog (a milestone hero, or "bug fixes and
   polish"). Keep the release-type accent hue from step 2 — vary the layout,
   copy, and the accent's use (shapes, glow, kicker) for interest, but do not
   shift the hue. The subtle grid background stays.
4. Write the banner copy. Follow the banner design rules and anti-slop rules
   below. The headline must state what changed, not announce a category. If the
   release is polish-only, say so concretely ("Bug fixes and polish" as the
   message, not noise). Do not invent numbers, dates, or features.
5. Render: screenshot `index.html` with headless Chrome at 2x and downscale to
1600x900, writing `banner.png` into the workspace:
   ```
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --headless --disable-gpu --hide-scrollbars \
     --force-device-scale-factor=2 --window-size=1600,900 \
     --screenshot=banner.png index.html
   sips -z 900 1600 banner.png
   ```
   Verify `banner.png` is created and non-empty before finishing.

## Banner design rules

- One message: one offer, one benefit, one CTA. Two ideas means two banners.
- Three levels maximum: hook, one support line, CTA. Lead with the value, then
  the brand.
- Hierarchy through size, weight, colour, not boxes, borders, or shadows.
- One focal point. Keep content inside at least 5% padding of the short edge.
- Pick one alignment and hold it. Whitespace is structural.
- One root element, explicit 1600x900 size, `overflow: hidden`,
  `box-sizing: border-box`, zero margin. Flex/grid layout. Do not use
  `position: fixed`, hover states, or scrollbars. It is a still snapshot.
- Scale type with the canvas (`vw`/`clamp()`), not fixed text boxes that break
  when copy changes.
- Two typefaces maximum. Load fonts explicitly and wait before screenshotting; a
  fallback-font render is a broken banner.
- Headline under 6 words, support under 12, headline at least 1.5x the size of
  the support line. Letter-spacing `-0.02em` on display type; headline
  line-height 1.05-1.15, body 1.4. Line length under 40 characters via
  `max-width`.
- Contrast: 4.5:1 normal text, 3:1 large/bold text and meaningful shapes, aim
  7:1 on the headline. Background, foreground, one accent. The accent belongs to
  the CTA and nothing else.
- Test with `filter: grayscale(1)`: if elements merge, hierarchy is not working.
- Over a gradient or pattern, check contrast against the lightest and darkest
  point behind the text.
- Do not use pill badges, borders, or text shadows to patch contrast.
- One CTA: none. The banner is a static image rendered inside release notes and
  is not clickable, so do not draw a call-to-action button or pill. End the
  composition with the version or a short neutral tagline instead.

## Anti-slop rules for the copy (banned patterns)

- Negative parallelism: "not just X, it's Y", "more than just X", "X? Y."
- Empty verbs: elevate, unlock, transform, supercharge, empower, reimagine,
  streamline.
- Arrival announcements: "The future of X is here", "Introducing...".
- Aspiration filler: "take X to the next level", "where X meets Y".
- Adjective stacks, alliteration-replacing-claims, staccato periods used for
  gravity, vague quantifiers ("thousands of teams").
- Question headlines answerable with "no". Second-person flattery. Exclamation
  marks (zero). Emoji in the headline (zero).
- Never invent numbers, metrics, dates, or features. If a number is needed and
  unknown, omit the claim.
- Overcorrection is also slop: no forced slang, no lowercase-everything. State
  concretely what the release does.

### Process

Scan against the list mechanically, rewrite by meaning, scan again, and repeat
until a pass returns zero hits. Read the headline alone without logo or CTA: if
it could sit on a competing tool's banner unchanged, it is not a headline yet.

## Pre-ship QA

- View at 100% and at 25%.
- Grayscale check.
- Confirm the intended font loaded.
- Check the longest copy variant for overflow and clipped descenders.
- Check for banding after export.

## Output

You must finish with `banner.png` written to the workspace and report a short
markdown summary table: file name, size, hero message used, accent/theme, and
the changelog call-out it was derived from.