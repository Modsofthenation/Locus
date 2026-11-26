# Themes

Locus themes are validated data, never raw CSS. One engine
(`packages/shared/src/models/customTheme.ts`) compiles a theme spec into CSS
scoped to `[data-theme="<id>"]`. The same spec format is used by the
**Generated** editor, the AI generator, the `manage_theme` agent tool and
theme packs.

## Kinds of built-in theme

| Kind | Where it lives | Remix / extend |
|---|---|---|
| Hand-written | `apps/desktop/src/index.css`, `styles/themeStyles.css` | Remix copies the colours |
| Token data | `packages/shared/src/models/tokenThemeData.ts` (75 colour-only themes such as Nord) | Yes |
| Crafted | `packages/shared/src/models/craftedThemes.ts` (16 themes compiled from specs) | Yes |

Token themes compile to the same CSS blocks they used to be. The desktop app
installs token and crafted CSS once at startup (`ensureCraftedThemeCss`).

## Spec reference

Only `name` and either `colors` (`bg`, `text`, `accent` at least) or
`palette.seed` are needed. Everything else is optional. The full field list,
with every allowed value, is `CUSTOM_THEME_SPEC_GUIDE` (the text the AI
generator and `manage_theme` see).

```json
{
  "name": "Harbour",
  "scheme": "dark",
  "palette": { "seed": "#22c3d6", "harmony": "analogous" },
  "adaptive": true,
  "variants": { "light": { "colors": { "accent": "#0b6f7c" } } },
  "layout": { "background": "waves", "pane": "glass", "paneAccent": "gradient" },
  "components": {
    "modal": { "radius": 22, "shadow": "layered" },
    "button": { "radius": 999 }
  },
  "code": {
    "syntax": { "keyword": "#7fd4ff", "string": "#b5e48c" },
    "ansi": { "magenta": "#d06a92" },
    "diffAdd": "#6ee7a0",
    "diffDel": "#ff6e6e"
  },
  "effects": { "sheen": true }
}
```

- **`palette`** grows the whole palette from one seed colour and a harmony
  (`mono`, `analogous`, `complementary`, `split`, `triadic`). Colours you give
  in `colors` win over it. In the editor, **Use the image's colours** picks the
  seed and backdrop colours from the backdrop image.
- **`adaptive`** makes one theme follow the system light/dark setting. The
  other scheme is regrown from the seed, or mirrored, and `variants.light` /
  `variants.dark` pin colours for either one. Adaptive themes can fill either
  slot of the light/dark pair.
- **`code`** themes syntax highlighting (`--syn-*` tokens), diff lines
  (`--diff-add`, `--diff-del`) and the terminal's 16 ANSI colours
  (`--ansi-*`). Give `{}` to derive all of them from the palette. Every theme
  built by the engine gets a matching ANSI palette, even without `code`.
- **`components`** sets radius (0–40, or 999 for a pill), border width, shadow
  and fill for one kind of component (`modal`, `composer`, `menu`, `button`,
  `input`, `bubble`, `sidebar`, `topbar`, `rail`). These win over `layout`.
- **`extends`** builds on a crafted or token built-in, or on another generated
  theme. The theme stores only `overrides` (what differs), and is re-merged on
  every load, so changes to the base carry through. If the base is deleted the
  theme keeps its last look and loses the link. Remix in Settings → Appearance
  creates a linked theme; **Unlink** in the editor drops the link.

## Readability

`themeReadabilityIssues()` checks text, muted and faint text on the page and
panes, accent ink, per-surface fills with their text, both ends of gradient
fills, syntax colours on the code block, ANSI colours on the terminal, diff
colours, and, for adaptive themes, the other scheme as well.
New input is repaired with `fixThemeReadability()`. **Fix contrast** in the
editor runs the same repair.

## Choosing the active theme

`activeThemeRef()` picks, in order:

1. the current project's or repository's own theme
   (`themePreferences.workspaceThemes`);
2. the time-of-day schedule (`scheduleOn` with up to 8 `schedule` slots; each
   runs from its `HH:MM` until the next and wraps past midnight);
3. the light/dark pair when following the system;
4. the fixed pick (`theme`).

Choosing a theme by hand turns following the system and the schedule off, but
keeps the pair and the slots. Set all of this under Settings → Appearance →
**Automatic themes, schedules and workspace themes**.
