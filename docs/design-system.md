# Signal Block design system

Signal Block is aicfg's visual system, developed from concept 05. It combines warm paper surfaces, precise black rules, geometric typography, signal yellow selection, and restrained vermilion accents. The interface should feel like a carefully organized working tool.

Open the [visual component reference](../desktop/design-system.html) directly, or run `npm run dev` in `desktop/` and visit `/design-system.html`. The reference loads the same tokens and component styles as the application. The production build includes both pages.

## Sources of truth

| Resource                                           | Purpose                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| `desktop/src/tokens.css`                           | Colors, type scales, spacing, radii, strokes, motion, and shell dimensions |
| `desktop/src/styles.css`                           | Shared component styles and responsive page layouts                        |
| `desktop/assets/aicfg.svg`                         | Canonical yellow app icon and in-app brand asset                           |
| `desktop/assets/aicfg-mark.svg`                    | Standalone black symbol for light backgrounds                              |
| `desktop/src-tauri/icons/icon.png` and `icon.icns` | Native application icons generated from the SVG                            |
| `desktop/design-system.html`                       | Visual reference for foundations and component states                      |

## Identity

The symbol is constructed on a 64-unit square. Three quarter-ring modules and a right-angle block form an abstract lowercase `a`. The central counter and four-unit separations keep the modules distinct at small sizes. The mark occupies units 8–56, giving it eight units of built-in clear space.

Use the yellow tile for app identity and the black symbol on warm white for monochrome uses. On a dark background, use a white version of the standalone symbol. Keep the symbol square, retain all four modules, and do not add gradients, outlines, rotation, or shadows. Use the icon at 24px or larger; the navigation uses 44px, reducing to 40px and 32px at smaller widths.

The wordmark is lowercase `aicfg`, set in the interface sans serif at weight 800 with tight spacing. It has no trailing dot. Leave at least one eighth of the tile width between the icon and wordmark. Keep the source SVG as the master; regenerate native icons with `npx tauri icon assets/aicfg.svg --output <temporary-directory>` and copy `icon.png` and `icon.icns` into `src-tauri/icons/`.

## Color

| Token                    | Value     | Role                                                    |
| ------------------------ | --------- | ------------------------------------------------------- |
| `--color-canvas`         | `#F4F2EB` | Shell, collection surfaces, secondary regions           |
| `--color-surface`        | `#FFFDF8` | Documents, panels, dialogs                              |
| `--color-surface-raised` | `#FFFFFF` | Editable fields                                         |
| `--color-ink`            | `#141414` | Text, structural borders, primary actions               |
| `--color-muted`          | `#64635C` | Secondary text and metadata                             |
| `--color-line`           | `#CFCDC4` | Internal row and field dividers                         |
| `--color-signal`         | `#F4D44C` | Current selection, navigation underline, preset context |
| `--color-signal-soft`    | `#FCF3C9` | Hover, warning context, unselected preset graph nodes   |
| `--color-orange`         | `#E65936` | Project context headers and small brand accents         |
| `--color-orange-soft`    | `#FBE6DF` | Project counts and rule graph nodes                     |
| `--color-success`        | `#24683D` | Confirmed connected or synced state                     |
| `--color-success-soft`   | `#E6EFDF` | Success badges and synced project nodes                 |
| `--color-danger`         | `#A52B20` | Destructive actions and errors                          |
| `--color-danger-soft`    | `#FAE7E1` | Error surfaces and invalid references                   |

Use ink text on yellow and vermilion. Primary actions use white text on ink; destructive actions use white on the darker danger color. Signal yellow indicates selection or emphasis, never successful completion. Status labels and icons accompany color. Avoid large decorative fields, gradients, or colored body copy.

## Typography

Use the local `Helvetica Neue`, Helvetica, Arial, and system sans serif stack. Metadata uses SF Mono, Consolas, Liberation Mono, and Menlo. No remote fonts are required.

| Role             | Size    | Weight  | Treatment                            |
| ---------------- | ------- | ------- | ------------------------------------ |
| Detail display   | 32–48px | 800     | Tight tracking; responsive           |
| Page title       | 28–40px | 800     | 1.1 line height; tight tracking      |
| Document heading | 17–29px | 750     | Clear heading hierarchy              |
| Body             | 13–14px | 400     | 1.5 UI / 1.8 document line height    |
| Control / field  | 12px    | 500–600 | Sentence case                        |
| Metadata         | 10–11px | 400     | Monospace; identifiers may wrap      |
| Eyebrow          | 10px    | 400     | Monospace, uppercase, 1.1px tracking |

Reserve uppercase for short category labels and eyebrows. Keep long repository paths, skill names, translated labels, and source text readable without widening the workbench.

## Space and geometry

Use the 4px scale: 4, 8, 12, 16, 20, 24, 32, 40, and 48px. Default panel padding is 24px; compact toolbars use 16px. Related controls use 8–12px gaps. Separate sections by 24px.

Structural boundaries use a 1px ink rule. Internal separators use a 1px subtle rule. Corners use a 2px radius. Primary actions have a 2px hard offset shadow; dialogs use a restrained 8px offset shadow. Other panels remain flat.

## Layout

The application has three persistent rows: a 76px top navigation, a flexible work area, and a 38px workspace status bar. At widths up to 1200px the navigation becomes 68px tall. The status bar shows the connected repository, real Git status, and running app version.

The library uses a 280px collection column and a flexible document inspector. Below 1200px the collection becomes 260px and usage cards move below the document; at 1000px outer padding reduces to 16px. The native window's 1000 × 680 minimum is supported. Compact browser widths use icon navigation with accessible names.

Library collection and document panes scroll independently. Project lists and project detail panes also scroll independently. Dependency tools remain visible above a flexible graph canvas. Other pages scroll within the work area while navigation and workspace state remain visible.

## Components and states

| Component          | Default                                  | Hover / selected                                    | Disabled / focus                                            |
| ------------------ | ---------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| Primary button     | Ink fill, white text, 2px offset shadow  | Yellow fill with ink text; pressed shadow collapses | 42% opacity; no shadow; 2px focus ring                      |
| Secondary button   | Warm white, ink border                   | Pale yellow                                         | Same disabled and focus treatment                           |
| Destructive button | Dark danger fill, white text             | Pale danger fill, danger text                       | Confirmation remains required                               |
| Icon button        | 32px target, transparent                 | Pale orange, danger ink for delete                  | Visible on row hover or keyboard focus                      |
| Navigation         | Icon, label, optional count              | 6px yellow underline and bold label                 | `aria-current="page"`; inset focus ring                     |
| Collection row     | Number, icon, title, description, source | Full yellow field and pressed state                 | Selection never relies on color alone                       |
| Search / input     | White fill, subtle rule, 38px height     | Ink border                                          | 2px offset focus ring; associated label                     |
| Status badge       | Text plus semantic color and border      | No decorative hover                                 | Success and pending are distinct                            |
| Usage card         | Ink outline, compact clickable rows      | Yellow preset header; vermilion project header      | Clear empty text when unused                                |
| Segmented control  | Outlined group                           | Yellow fill and ink border on active segment        | Native buttons retain keyboard focus                        |
| Disclosure         | Compact summary with chevron             | Expanded content below rule                         | Native keyboard behavior                                    |
| Dialog             | Warm surface, ink outline, offset shadow | Sticky title and close action                       | Native modal focus trap, Escape and focus restoration       |
| Dependency node    | Warm or semantic surface, square corners | Focused node is yellow with a 2px ink border        | Unrelated nodes fade; keyboard Enter, Space and Escape work |

Select fields use a 38px height, 2px corners, an ink border, and a custom chevron. Reset native control appearance so macOS and WebKit respect the shared geometry. Hover uses pale yellow; keyboard focus uses the standard ink outline. Keep native option selection and keyboard behavior, and restore the system appearance in forced-colors mode.

Use one primary action per region. Destructive operations retain the application's confirmation dialogs. Keep preview and application separate: reviewing changes must not apply files. Activity logs remain collapsed into a compact summary, with full details available on demand.

## Usage information

The skill inspector shows configured usage from the current repository state. Preset counts include direct and inherited references, are deduplicated, and terminate even with reference cycles. Project counts include projects configured with any of those presets, excluding projects that explicitly exclude the skill. These counts describe configuration, not proof of a completed installation. Adapter chips reflect enabled adapters on the matching projects.

Preset and project rows navigate to their existing editors. No example counts or demo repositories are rendered in the application. Empty searches, unused skills, disconnected repositories, loading, errors, unsaved changes, conflicts, and destructive confirmations all use the same system.

## Interaction and accessibility

Use a 2px ink focus outline with a 3px offset. Keep primary controls at least 38px tall and icon targets at least 32px. Preserve visible labels, semantic buttons, native checkboxes, native dialogs, and readable status messages. Do not disable navigation while a skill document is loading; global repository operations keep their existing busy guards.

Transitions last 120ms. Respect reduced-motion preferences, including the loading indicator. Existing English, Chinese, and Japanese localization remains supported; user-provided names and document content retain their original language.
