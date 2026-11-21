---
name: portable-artifacts site
description: A construction drawing set. A JSON spec is the drawing, the built artifact is the plate. Cyanotype in dark, whiteprint in light, redline as the only accent.
colors:
  field: "#f3f6fb"
  sheet: "#f8fafd"
  ink: "#1b347f"
  ink-2: "#3a4f8f"
  ink-3: "#5a6ca3"
  redline: "#c4321a"
  hairline: "rgba(27, 52, 127, 0.24)"
  hairline-strong: "rgba(27, 52, 127, 0.55)"
  grid: "rgba(27, 52, 127, 0.06)"
  redline-wash: "rgba(196, 50, 26, 0.12)"
  field-dark: "#0b2a52"
  sheet-dark: "#0e3160"
  ink-dark: "#eef4ff"
  ink-2-dark: "#c3d4ee"
  ink-3-dark: "#93abd2"
  redline-dark: "#ff8f73"
  hairline-dark: "rgba(214, 228, 255, 0.24)"
  hairline-strong-dark: "rgba(214, 228, 255, 0.6)"
  grid-dark: "rgba(214, 228, 255, 0.05)"
  redline-wash-dark: "rgba(255, 143, 115, 0.16)"
  media-black: "#000"
  scrim: "rgba(10, 22, 48, 0.82)"
  on-scrim: "#fff"
  tag-shadow: "rgba(0, 0, 0, 0.35)"
  thumb-placeholder: "#0003"
typography:
  display:
    fontFamily: "Archivo, Arial Narrow, system-ui, sans-serif"
    fontSize: "clamp(48px, 7.2vw, 100px)"
    fontWeight: 800
    lineHeight: 0.88
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 68"
  headline:
    fontFamily: "Archivo, Arial Narrow, system-ui, sans-serif"
    fontSize: "clamp(40px, 6.4vw, 92px)"
    fontWeight: 800
    lineHeight: 0.9
    letterSpacing: "-0.015em"
    fontVariation: "'wdth' 70"
  title:
    fontFamily: "Archivo, Arial Narrow, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "normal"
    fontVariation: "'wdth' 85"
  body:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
    fontVariation: "'wdth' 100"
  lede:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(18px, 1.6vw, 21px)"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Archivo, Arial Narrow, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.08em"
    fontVariation: "'wdth' 85"
  measure:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.35
  spec-line:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.75
  register-title:
    fontFamily: "Archivo, Arial Narrow, system-ui, sans-serif"
    fontSize: "clamp(40px, 6vw, 84px)"
    fontWeight: 800
    lineHeight: 0.88
  note:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15.5px"
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  body-small:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  micro:
    fontFamily: "Archivo, Arial Narrow, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.1em"
rounded:
  none: "0"
  full: "50%"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "20px"
  gutter: "clamp(16px, 4vw, 48px)"
  hairline: "1px"
components:
  tool-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.spec-line}"
    rounded: "{rounded.none}"
    height: "32px"
    padding: "0 10px"
  tool-button-hover:
    textColor: "{colors.ink}"
  copy-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.none}"
    height: "28px"
    padding: "0 10px"
  copy-button-copied:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.field}"
  plate-frame:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.none}"
    padding: "8px"
  stamp:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.none}"
  title-block-cell:
    textColor: "{colors.ink}"
    typography: "{typography.measure}"
    padding: "10px 12px 12px"
  detail-tag:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.redline}"
    rounded: "{rounded.full}"
    size: "24px"
  detail-tag-on:
    backgroundColor: "{colors.redline}"
  register-thumb:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.none}"
    padding: "6px"
---

# Design System: portable-artifacts site

## Overview

**Creative North Star: "The Drawing Set"**

The site is a set of construction drawings. A JSON spec is the drawing; the file it builds is the plate mounted beside it. Every page is a sheet with a drawing border and a sheet number, artifacts sit in dimensioned frames, and numbered tags tie a spec line to the part of the output it built. The aim is that a visitor reads "spec in, file out" at a glance and trusts it because the page looks like something that gets checked, not marketed.

Two materials carry the world. Dark is cyanotype: white linework on Prussian blue. Light is whiteprint: diazo blue linework on near-white. Both draw on a 24px graph grid. Redline, the markup colour of a reviewed drawing, is the only accent: leader lines, revision marks, sheet numbers, focus rings, hover underlines. The whole system is hairlines and type. There are no fills, no cards with radius, no gradients except the graph grid.

The build refuses the dark neon bento grid and the cream editorial page that developer tools default to. That rejection is the one confirmed visual anti-reference (direction contract, seed 149445c2). Voice stays minimal, in line with PRODUCT.md: few words, the artifact shown instead of described.

**Key Characteristics:**
- Linework first: 1px hairlines in ink at 24% and 55% alpha do the work that fills and shadows do elsewhere.
- Square corners everywhere; the only circles are detail tags, as on a real drawing.
- Archivo at condensed width in heavy caps for lettering; JetBrains Mono for every measurement, spec and sheet number.
- One accent (redline), used only for markup and state.
- Every figure carries a mono caption ("Plate 01", a dimension line) that states something checkable.
- Light and dark are co-equal themes, switchable (auto, light, dark), both held to AA contrast.

## Colors

A two-material palette: one hue family (blue, hue about 256 to 269 in OKLCH) stepped by lightness for text and line, plus one orange-red markup colour. Values below are the shipped `:root` custom properties in `docs/assets/pa.css`; light values are the default, `-dark` tokens apply in the cyanotype theme.

### Primary
- **Diazo Ink** (`ink`, `ink-dark`): primary text, borders of the install stamp (2px), filled "copied" state. Deep diazo blue in light, near-white blue-tinted in dark.

### Secondary
- **Redline** (`redline`, `redline-dark`): the markup accent. Leader lines and their end dot, detail tags, sheet-number emphasis, the arrows in the cover title, focus ring (2px, 3px offset), link-hover underline, hover borders on register thumbnails. Brick red in light, soft coral in dark.
- **Redline Wash** (`redline-wash`): a 12% (16% in dark) tint that sweeps across a spec line when its tag is active.

### Neutral
- **Field** (`field`, `field-dark`): page ground, with the graph grid drawn over it. Whiteprint paper in light, Prussian blue in dark.
- **Sheet** (`sheet`, `sheet-dark`): the plate frame, spec panel, install stamp and register thumbs. One step lighter than field.
- **Ink 2** (`ink-2`, `ink-2-dark`): secondary text, ledes, button labels, nav links at rest.
- **Ink 3** (`ink-3`, `ink-3-dark`): captions, dimension text, sheet numbers, dt labels. The lowest text tier; about 4.7:1 on field in light, so keep it at 11px and above only where it is real content, never below.
- **Hairline / Hairline Strong** (`hairline`, `hairline-strong`): the ink colour at 24% and 55% (60% in dark). Hairline separates inside a sheet; strong marks the outside of a plate or panel.
- **Grid** (`grid`): ink at 6% (5% in dark), the 24px graph paper behind everything.

### Named Rules

**The Redline Rule.** Redline marks; it does not decorate. It appears as a line, a number, a ring, a small tag or a hover state. Large surfaces and text blocks are never redline. Its rarity is how a visitor reads "this is the part that points at something".

**The Two Materials Rule.** Light and dark are the same drawing on different stock. Every colour is a token with a light and a dark value; no component hard-codes a hue that exists in only one theme.

**The Hairline Rule.** Structure is drawn with 1px lines (`--rule`). The 2px border is reserved for one object, the install stamp, because it is the document the visitor must act on.

## Typography

**Display Font:** Archivo variable (weight 100 to 900, width 62% to 125%), fallback Arial Narrow, system-ui, sans-serif
**Body Font:** Archivo variable at normal width, fallback system-ui, -apple-system, Segoe UI, sans-serif
**Label/Mono Font:** JetBrains Mono variable, fallback ui-monospace, SF Mono, Menlo, monospace

**Character:** Archivo squeezed to 68 to 90% width and set heavy reads as stencilled drawing lettering; the same family at normal width is a quiet, neutral reading face. JetBrains Mono is the draughtsman's measurements: sizes, filenames, spec JSON, sheet numbers. Both fonts are self-hosted latin subsets (OFL 1.1, see `docs/assets/fonts/LICENSES.md`).

### Hierarchy
- **Display** (800, `clamp(52px, 9.2vw, 132px)`, 0.86, width 68%, -0.02em, uppercase): the cover title "PROMPT -> SPEC -> FILE." and the register page h1 (`clamp(48px, 8vw, 112px)`). Once per page.
- **Headline** (800, `clamp(40px, 6.4vw, 92px)`, 0.9, width 70%, lowercase): skill sheet names (`/make-dashboard`), lowercase because they are slash commands. The general-notes h2 uses the same recipe in uppercase at `clamp(34px, 4.6vw, 64px)`; register group h2 uses width 75% lowercase at `clamp(26px, 3vw, 38px)`.
- **Title** (700, 20px, 1.25, width 85%): the bold line of each general note.
- **Body** (400, 17px, 1.55, 16px under 560px): running copy. Lede paragraphs cap at 34 to 40ch; spec notes at 12.5 to 15.5px.
- **Label** (700, 12px, 0.08em, width 85%, uppercase): install stamp header, title-block `dt` (600, 10px, 0.1em, width 90%).
- **Measure** (JetBrains Mono 500, 14px, 1.35): title-block values. Smaller mono sizes (11 to 13.5px) carry sheet numbers, dimension lines, copy buttons and commands; the spec excerpt runs at 12px / 1.75.

### Named Rules

**The Lettering Rule.** Condensed width and heavy weight are for lettering only: titles, sheet names, labels. Anything a visitor reads as a sentence is Archivo at width 100%.

**The Measurement Rule.** A measurement used as a label or data cell, a file name, a command, a sheet number or a line of spec is JetBrains Mono. Numbers inside a sentence or a bold item title stay in the reading face.

**The Case Follows Meaning Rule.** Page titles and group lettering are uppercase; skill and command names are lowercase because that is how they are typed.

## Layout

A sheet-and-border model. `.sheet` is a full-width bordered block (1px hairline, no top border so sheets stack like a drawing set) inset from the viewport by the gutter (`clamp(16px, 4vw, 48px)`). An inner border sits 10px inside it (6px under 560px), and a sheet-number tab ("Sheet 01 / 05 . make-dashboard") hangs in the top-left corner. Sheet padding runs `clamp(52px, 6vw, 72px)` top, which clears that tab.

Grids are fractional and unequal on purpose: cover 5fr / 7fr (lettering left, plate right), skill sheets 11fr / 13fr with a `flip` variant that swaps spec and plate sides so adjacent sheets do not repeat, general notes 4fr / 8fr. Gaps are `clamp(20px, 3vw, 44px)` between a spec and its plate. Title blocks are bordered definition grids (4, 5 or 6 columns, collapsing to 3 then 2). The register is `repeat(auto-fill, minmax(min(100%, 280px), 1fr))` with a 20px gap.

Rhythm uses a handful of recurring steps: 6, 8, 12 and 20px for inner spacing, `clamp()` for everything between sections. Density is moderate: generous around the display lettering, tight inside spec panels and title blocks.

Responsive: at 960px every two-column grid becomes one column, the plate moves above its spec, the sheet index in the top strip moves to a second, horizontally scrolling row, and title blocks drop to 2 or 3 columns. At 560px body drops to 16px, sheet padding tightens, tags shrink from 24px to 20px, and the video button loses its text label. The top strip is sticky at 56px with a blurred field-colour background; `scroll-padding-top` is 72px.

## Elevation & Depth

Flat by construction. Depth is conveyed by borders, nesting (sheet inside field, plate-frame inside sheet, an inner drawing border inside the sheet) and one deliberate lift. The plate frame, where the real artifact is mounted, carries the only broad shadow: a 1px hard contact edge plus a long soft drop, so the output reads as a print pinned over the drawing. Detail tags carry a small drop so they float above the artifact. The sticky strip uses a blur (`backdrop-filter: saturate(1.2) blur(8px)`) over an 88% field tint, which is the only translucency.

### Shadow Vocabulary
- **Plate** (`box-shadow: 0 1px 0 rgba(27, 52, 127, 0.25), 0 18px 40px -22px rgba(27, 52, 127, 0.45)`; dark: `0 1px 0 rgba(0, 0, 0, 0.35), 0 22px 44px -20px rgba(0, 0, 0, 0.6)`): plate frames only.
- **Tag** (`box-shadow: 0 2px 6px -1px rgba(0, 0, 0, 0.35)`): detail tags over the artifact image.

### Named Rules

**The Mounted Plate Rule.** Only the artifact is lifted. Text panels, spec panels, stamps and title blocks stay flat and bordered.

## Shapes

Square. Every border radius in the system is 0 (`border-radius: 0` is stated on buttons). Frames are rectangles with 1px lines, mounted with padding (plate frame 8px, register thumb 6px) so the image sits inside a mat. The single exception is the detail tag: a 24px circle with a 1.5px redline ring, the callout bubble of a real drawing. Dimension lines are a hairline with end ticks (`.dim`), and sheet-number tabs are open on two sides. Leader lines are 1.5px redline polylines with a 3px end dot. Dashed hairlines separate rows inside the install stamp.

## Components

### Buttons
Two small, outlined, square controls; nothing is filled at rest.
- **Tool button** (theme toggle, GitHub): 32px high, 1px hairline border, mono 12px label, ink-2 text. Hover: text to ink, border to hairline-strong.
- **Copy button**: 28px high, 1px hairline-strong border, mono 11px lowercase label. Hover: border to ink. Copied: fills ink with field-coloured text for 1.4s. Failed: redline text and border. One button per command, never one for several.
- **Watch with sound** (`.plate-play`): a dark scrim chip over the film with a white label, hover turns it redline with a sheet-coloured label (AA in both themes). Appears on the cover and film plates.

### Plate (figure)
Dimension line above (mono caption centred over a hairline with end ticks), a 1px hairline-strong frame with 8px mat on sheet, the artifact inside at 16:9, a mono figcaption below ("Plate 01 . Product performance") with one link. Carries the Plate shadow.

### Spec Panel
Bordered sheet-coloured panel: a mono header row (file name and size, link to full spec), then an ordered list of JSON lines at 12px / 1.75 with CSS line numbers. Keys in ink-2, values in ink. A line that points at the artifact (`data-tag`) shows a redline numbered circle at its end; on hover, focus or click it washes with redline-wash and a redline leader line draws from the line to the matching tag on the plate (420ms ease-out, skipped under reduced motion).

### Detail Tag
24px circle, sheet fill, redline ring and numeral (mono 11px, 700). Active: filled redline, scale 1.18, numeral in the sheet colour (as the spec-line tag does), AA in both themes.

### Install Stamp
The one 2px-bordered object. Header row in label type ("Issued for install" left, "MIT" in redline right), then groups separated by hairlines, each a heading and rows of `command + copy button` split by dashed hairlines. Two columns, one under 960px.

### Title Block
A definition grid of bordered cells, `dt` in label type at ink-3, `dd` in mono; a `wide` cell spans two columns. Used on the cover, under each skill sheet, and in the footer. The place for facts that are checkable in code.

### Navigation
Sticky 56px strip: the mark (a small drawing-sheet glyph plus "portable-artifacts" in Archivo 700 at width 85%), a sheet index of `00 Cover`, `01 Film`, `02 Explainer` and so on (sheet number in mono, the current sheet's number turns redline, set by scroll position), and the tool buttons. Links at rest are ink-2; hover or current adds a 1px hairline border. Under 960px the index wraps to its own scrolling row.

### Register Item
Thumbnail in a 6px mat with a 1px hairline-strong border; hover shifts it up 2px and turns the border redline. Caption: mono redline register number (`R-01.2`), bold title, and quiet links to page, spec and prompt.

## Do's and Don'ts

### Do:
- **Do** draw structure with 1px hairlines (`hairline`, `hairline-strong`); keep the 2px border for the install stamp only.
- **Do** keep every corner square. Circles are for detail tags only.
- **Do** use redline only as a line, number, ring, tag or state: leader lines, sheet numbers, focus ring, hover underline.
- **Do** set measurements, file names, commands, sheet numbers and spec lines in JetBrains Mono; set lettering in condensed heavy Archivo.
- **Do** caption every figure with a plate number and a fact that can be checked in the code.
- **Do** define every colour as a token with a light and a dark value, and check any new pairing for WCAG AA in both themes.
- **Do** keep the focus ring as is: 2px redline, 3px offset, on every interactive element.
- **Do** guard every motion (leader draw, scroll, hover lift, loop playback) with `prefers-reduced-motion`; transitions are 0.2 to 0.4s on `cubic-bezier(0.16, 1, 0.3, 1)`.
- **Do** keep a plain-HTML fallback: the page must read without JavaScript; `pa.js` only adds theme, copy, scroll-spy, loop playback and leader lines.

### Don't:
- **Don't** make a dark neon bento grid or a cream editorial page. That is the confirmed anti-reference.
- **Don't** fill large areas or text blocks with redline.
- **Don't** put a soft shadow on text panels, spec panels or stamps. Lift the mounted artifact only.
- **Don't** set body-length copy in condensed width, or set a measurement in Archivo.
- **Don't** add rounded cards, pills or chips. The form language is frames, mats and rules.
- **Don't** use imagery that is not a real output from the skills; thumbnails, clips and posters come from files in the repo, never mock-ups.
- **Don't** introduce a second accent colour. Hue variety belongs inside the artifacts shown, not in the site chrome.
