# Triviality Mayhem Brand Guide

This document is the reference for the Triviality Mayhem design system applied across the CRM. It covers the color palette, design tokens, component primitives, and the rationale behind a few deliberate decisions. Anyone adding a new page or component should read this first rather than reaching for raw Tailwind colors.

## 1. Brand palette (fixed, not admin-editable)

| Name | Hex | Role |
|---|---|---|
| Mayhem Red | `#DA0301` | Primary buttons, CTAs, key highlights |
| Mayhem Red Dark | `#650000` | Primary-button hover, destructive/danger actions |
| Deep Navy | `#002A6B` | Headings, selected nav accent, major labels |
| Mayhem Blue | `#00368B` | Secondary buttons, links, selected panels |
| Electric Blue | `#0648A6` | Hover/focus/active states |
| Near Black | `#050405` | Primary text, darkest elements |
| Warm White | `#F7F3ED` | Dominant page/panel background |
| Silver | `#A0A0A0` | Decorative dividers only (see §2) |

These eight colors are the entire brand palette. No other blues, reds, or "random" accent colors should be introduced anywhere in the app. Success/warning use Tailwind's stock `emerald`/`amber` — deliberately *not* brand colors, since green/amber are universal semantic signals (success/caution) that the fixed palette has no equivalent for.

Design direction: Warm White dominates backgrounds, Near Black dominates text, Silver provides subtle structure, and Deep Navy/Mayhem Blue/Mayhem Red are used selectively as accents — never as large fill areas. No decorative gradients.

## 2. Why Silver has two derived neighbors

The literal brand hex `#A0A0A0` fails WCAG AA when used as text (2.37:1 contrast against Warm White; AA requires 4.5:1) or as a functional interactive-element border (needs 3:1). Rather than either quietly violating AA or quietly ignoring the spec, two additional lightness steps of the *same neutral gray* were added — no new hue introduced:

```css
--color-silver: #A0A0A0;        /* decorative dividers, non-critical structure only */
--color-silver-strong: #8A8A8A; /* functional borders: inputs, buttons, cards — clears 3:1 */
--color-text-muted: #6B6B6B;    /* secondary/muted text specifically — clears 4.5:1 */
```

### WCAG AA contrast verification

| Pair | Ratio | Needs | Result |
|---|---|---|---|
| Near Black text / Warm White bg | 18.5:1 | 4.5:1 | Pass |
| Mayhem Red text / Warm White bg | 4.75:1 | 4.5:1 | Pass |
| White text / Mayhem Red bg | 5.25:1 | 4.5:1 | Pass |
| White text / Mayhem Red Dark bg | high | 4.5:1 | Pass |
| Deep Navy text / Warm White bg | 12.3:1 | 4.5:1 | Pass |
| White text / Deep Navy bg | 13.6:1 | 4.5:1 | Pass |
| Mayhem Blue text / Warm White bg | 10.0:1 | 4.5:1 | Pass |
| White text / Electric Blue bg | 8.45:1 | 3:1 (UI) | Pass |
| Silver text / Warm White bg | 2.37:1 | 4.5:1 | **Fails** — use `text-muted` instead |
| Silver border / Warm White bg | 2.37:1 | 3:1 | **Fails** — use `border-strong` instead |
| Silver-strong border / Warm White bg | 3.4:1 | 3:1 | Pass |
| Text-muted / Warm White bg | 5.1:1 | 4.5:1 | Pass |

## 3. Design tokens (`src/app/globals.css`)

Defined once in a Tailwind v4 `@theme` block, which auto-generates `bg-*`, `text-*`, and `border-*` utilities from every `--color-*` custom property. Components should always reach for the **semantic aliases**, not the raw brand-color names, so a future palette adjustment only ever touches one block:

| Semantic token | Maps to | Used for |
|---|---|---|
| `bg-surface` / `text-text` | Warm White / Near Black | Page background / body text |
| `bg-surface-raised` | white | Cards sitting on the page background |
| `text-text-muted` | derived gray | Secondary text, help text, timestamps |
| `border-border` / `border-border-strong` | Silver / Silver-strong | Decorative dividers / functional borders |
| `bg-primary` / `bg-primary-hover` | Mayhem Red / Red Dark | Primary buttons, CTAs |
| `text-secondary` / `bg-secondary` | Mayhem Blue | Links, secondary buttons, selected panels |
| `text-accent` / `bg-accent` | Deep Navy | Headings, selected nav accent |
| `text-focus` / `bg-focus` | Electric Blue | Hover/focus/active states, focus rings |
| `text-danger` / `bg-danger` | Mayhem Red Dark | Errors, destructive actions |

`:focus-visible` gets a global 2px Electric Blue outline as a guaranteed baseline, on top of which individual components may layer their own `focus:ring-*` styling.

## 4. Component primitives (`src/components/ui/`)

No UI framework was added — everything is built on existing Tailwind conventions plus `clsx` (already a dependency) for variant composition.

- **`logo.tsx`** — `Logo({ size: "full" | "compact" })`. `full` is the primary Mayhem wordmark (`public/triviality-mayhem-logo.png`), `compact` is the circular mark (`public/triviality-mayhem-logo-circle.png`) used in the mobile header. Both PNGs are genuinely 3919×3919 (square) — the component declares that as the intrinsic `width`/`height` so `next/image` reserves the correct aspect ratio, then CSS height utilities + `object-contain` control the displayed size. The artwork itself is never modified.
- **`button.tsx`** — `Button({ variant: "primary" | "secondary" | "destructive" | "ghost" })`. Includes `disabled:pointer-events-none` (not just `opacity-50`) so a disabled button can never visually "win" a hover state.
- **`field.tsx`** — `Label`, `Input`, `Select`, `Textarea`, `HelpText`, `FieldError`. One shared control-class string for all form inputs.
- **`card.tsx`** — `Card`, `SectionHeading`. Standard panel surface.
- **`page-header.tsx`** — `PageHeader({ title, description, actions })`. Standard page-title row.
- **`badge.tsx`** + **`src/lib/ui/status-tones.ts`** — `Badge({ tone })` plus typed tone/label maps for every status enum in the app (opportunity grade, confidence, trivia status, search disposition, search job status, verification status, active/inactive). This replaced three previously-inconsistent ad hoc badge implementations and added color-coding to several values that had none before (grade, confidence, disposition, search status).
- **`alert.tsx`** — `Alert({ tone: "info" | "success" | "warning" | "danger" })`.
- **`empty-state.tsx`** — `EmptyState`.
- **`pagination.tsx`** — `Pagination`. Works embedded in either a Server Component (via an `hrefFor` builder + `next/link`) or a Client Component (via an `onNavigate` callback), unifying two previously-divergent pagination idioms into one visual result.

## 5. Sidebar treatment

The sidebar was changed from a solid dark-navy fill to a light Warm-White background with Deep-Navy accents (active nav item gets a Deep-Navy left bar + Deep-Navy text on a faint navy-tinted wash; inactive items are Near-Black-on-transparent). This follows the brief's "Warm White should dominate" plus "Deep Navy... selected navigation accents" (not "navigation fill") more literally than keeping a solid navy panel, and it also makes Mayhem Red read as genuinely special when it appears, since a red CTA pops far more against Warm White than against a dark panel.

## 6. Logo placement

- **Sidebar**: full logo in a dedicated header band with generous clear space, `object-contain`, never stretched or cropped.
- **Sign-in / change-password pages**: full logo, larger and centered above the form card.
- **Mobile header**: compact circular mark, used only when the sidebar is collapsed.

## 7. What did not change

Server-side permissions, database logic, AI/research logic, authentication, background jobs, and deployment architecture were not touched — this was a restyle only. No navigation item or button label was renamed as part of this pass.
