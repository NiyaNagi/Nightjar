# CSS Hardcoded Color Audit Report

> Generated from comprehensive search of all CSS files in `frontend/src/`
>
> **Scope**: Every hardcoded color NOT inside a `var()` fallback and NOT inside a `:root` / CSS variable definition block.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [CSS Variable Reference](#css-variable-reference)
3. [New Variables Needed](#new-variables-needed)
4. [Violations by File](#violations-by-file)
   - [CRITICAL Priority Files](#critical-priority-files)
   - [HIGH Priority Files](#high-priority-files)
   - [MEDIUM Priority Files](#medium-priority-files)
   - [LOW Priority Files](#low-priority-files)
5. [`color: white` / `color: #fff` Audit](#color-white--color-fff-audit)
6. [Hardcoded `rgba()` Audit](#hardcoded-rgba-audit)
7. [Color-to-Variable Mapping Cheat Sheet](#color-to-variable-mapping-cheat-sheet)

---

## Executive Summary

| Metric | Count |
|--------|-------|
| Total CSS files scanned | 109 |
| Files with hardcoded hex colors (outside `var()`) | ~30 |
| Hardcoded hex violations | ~250+ |
| `color: white` / `#fff` / `#ffffff` violations | ~170 |
| Hardcoded `rgba()` violations (theme-dependent) | ~100+ |
| **Estimated total violations** | **~520+** |

**Worst offenders** (by violation count):
1. `Share.css` — ~50 hex + 5 white + rgba
2. `App.css` — 21 hex + 8 white
3. `WorkspaceSettings.css` — ~20 hardcoded hex (outside var()) + 8 white + dark-mode media query block
4. `Editor.css` — 15 hex + rgba
5. `Onboarding.css` — 12 hex + 12 white + 40 rgba
6. `Settings.css` — 20+ hex + 24 white + 40 rgba
7. `Chat.css` — 9 hex + 15 white
8. `Changelog.css` — 4 hex + 4 white
9. `HierarchicalSidebar.css` — 10 hex + 8 white
10. `RecoveryCodeModal.css` — 20 hex (mostly in dark-mode media query) + 3 white
11. `WorkspaceSwitcher.css` — 6 hex + 6 white
12. `Presence.css` — 6 hex + 6 white
13. `LockScreen.css` — 5 hex + 4 white

---

## CSS Variable Reference

Defined in `frontend/src/styles/global.css`:

### Dark Theme (`:root`)
| Variable | Value |
|----------|-------|
| `--bg-primary` | `#0f0f17` |
| `--bg-secondary` | `#16161e` |
| `--bg-tertiary` | `#1a1a2e` |
| `--sidebar-bg` | `#1a1a2e` |
| `--editor-bg` | `#1e1e2e` |
| `--toolbar-bg` | `#1e1e2e` |
| `--tab-bar-bg` | `#16161e` |
| `--status-bar-bg` | `#16161e` |
| `--input-bg` | `#252538` |
| `--text-primary` | `#e4e4e7` |
| `--text-secondary` | `#c4c4cc` |
| `--text-muted` | `#b0b0b8` |
| `--text-tertiary` | `#c4c4cc` |
| `--border-color` | `#2d2d44` |
| `--hover-bg` | `#2d2d44` |
| `--active-bg` | `#3d3d5c` |
| `--accent-color` | `#6366f1` |
| `--accent-hover` | `#4f46e5` |
| `--accent-light` | `#818cf8` |
| `--success-color` | `#22c55e` |
| `--success-hover` | `#16a34a` |
| `--warning-color` | `#f59e0b` |
| `--warning-hover` | `#d97706` |
| `--error-color` | `#ef4444` |
| `--error-hover` | `#dc2626` |
| `--error-border` | `#fca5a5` |
| `--accent-alpha` | `rgba(99,102,241,0.1)` |
| `--error-bg` | `rgba(239,68,68,0.1)` |
| `--success-bg` | `rgba(34,197,94,0.1)` |
| `--warning-bg` | `rgba(245,158,11,0.1)` |
| `--shadow-color` | `rgba(0,0,0,0.3)` |
| `--code-bg` | `rgba(255,255,255,0.1)` |

---

## New Variables Needed

These hardcoded colors appear multiple times and have no existing CSS variable:

| Proposed Variable | Dark Value | Light Value | Used For |
|-------------------|------------|-------------|----------|
| `--error-bg-subtle` | `#450a0a` | `#fef2f2` | Light error backgrounds (WorkspaceSettings, RecoveryCodeModal) |
| `--error-border-subtle` | `#7f1d1d` | `#fecaca` | Subtle error borders |
| `--error-dark` | `#b91c1c` | `#b91c1c` | Darker error hover states |
| `--error-darkest` | `#991b1b` | `#991b1b` | Darkest error text |
| `--highlight-bg` | `rgba(254,240,138,0.3)` | `#fef08a` | Search/highlight yellow |
| `--info-color` | `#3b82f6` | `#3b82f6` | Info-blue (already used as fallback in StatusBar) |
| `--accent-gradient` | `linear-gradient(135deg, #6366f1, #8b5cf6)` | same | Accent gradients |
| `--onboarding-gradient` | `linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)` | light equiv | Onboarding/LockScreen background |
| `--text-on-accent` | `#ffffff` | `#ffffff` | White text on colored buttons |
| `--warning-text` | `#b45309` | `#b45309` | Warning text in light contexts |
| `--success-text` | `#059669` | `#059669` | Success text in light contexts |

---

## Violations by File

### CRITICAL Priority Files

---

#### `frontend/src/Editor.css`

| Line | Property | Hardcoded Value | Suggested Replacement |
|------|----------|-----------------|----------------------|
| 3 | `border` | `#444` | `var(--border-color)` |
| 15 | `border-color` | `#888` | `var(--border-color)` |
| 44 | `color` | `#fff` | `var(--text-primary)` |
| 57 | `border` | `#666` | `var(--border-color)` |
| 64 | `background-color` | `#444` | `var(--hover-bg)` |
| 81 | `background` | `rgba(200, 200, 255, 0.4)` | New `--selection-bg` variable |
| 88 | `border-bottom` | `#444` | `var(--border-color)` |
| 94 | `background` | `#2c2c2c` | `var(--bg-secondary)` |
| 95 | `color` | `#fff` | `var(--text-primary)` |
| 96 | `border` | `#555` | `var(--border-color)` |
| 104 | `background` | `#555` | `var(--hover-bg)` |
| 116 | `color` | `#818cf8` | `var(--accent-light)` |
| 121 | `background-color` | `#fef08a` | New `--highlight-bg` variable |
| 122 | `color` | `#1a1a2e` | `var(--bg-tertiary)` — but semantically needs dark text var |
| 134 | `background` | `rgba(99, 102, 241, 0.15)` | `var(--accent-alpha)` |
| 135 | `color` | `#c4b5fd` | `var(--accent-light)` |
| 148 | `background` | `rgba(255, 255, 255, 0.02)` | Theme-dependent — needs var |
| 156 | `background` | `rgba(99, 102, 241, 0.1)` | `var(--accent-alpha)` |
| 159 | `color` | `#a5b4fc` | `var(--accent-light)` |

**Total: 19 violations**

---

#### `frontend/src/components/Share/Share.css`

| Line | Property | Hardcoded Value | Suggested Replacement |
|------|----------|-----------------|----------------------|
| 58 | `color` | `#fff` | `var(--text-primary)` |
| 64 | `color` | `#888` | `var(--text-muted)` |
| 73 | `color` | `#fff` | `var(--text-primary)` |
| 92 | `color` | `#888` | `var(--text-muted)` |
| 100 | `color` | `#fff` | `var(--text-primary)` |
| 149 | `color` | `#ccc` | `var(--text-secondary)` |
| 156 | `accent-color` | `#6366f1` | `var(--accent-color)` |
| 164 | `background` | `#0a0a14` | `var(--bg-primary)` |
| 165 | `border` | `#2a2a4a` | `var(--border-color)` |
| 167 | `color` | `#fff` | `var(--text-primary)` |
| 174 | `border-color` | `#6366f1` | `var(--accent-color)` |
| 190 | `background` | `#0a0a14` | `var(--bg-primary)` |
| 191 | `border` | `#2a2a4a` | `var(--border-color)` |
| 193 | `color` | `#fff` | `var(--text-primary)` |
| 200 | `background` | `#6366f1` | `var(--accent-color)` |
| 203 | `color` | `#fff` | `var(--text-on-accent)` ⚠️ OK if on accent button |
| 212 | `background` | `#5558e3` | `var(--accent-hover)` |
| 230 | `background` | `#fff` | Needs light/dark aware variable |
| 236 | `color` | `#666` | `var(--text-muted)` |
| 250 | `color` | `#888` | `var(--text-muted)` |
| 261 | `color` | `#aaa` | `var(--text-secondary)` |
| 274 | `background` | `#0a0a14` | `var(--bg-primary)` |
| 275 | `border` | `#2a2a4a` | `var(--border-color)` |
| 277 | `color` | `#fff` | `var(--text-primary)` |
| 287 | `border-color` | `#6366f1` | `var(--accent-color)` |
| 292 | `background` | `#2a2a4a` | `var(--hover-bg)` |
| 295 | `color` | `#fff` | `var(--text-primary)` |
| 302 | `background` | `#3a3a5a` | `var(--active-bg)` |
| 324-327 | various | `#0a0a14`, `#2a2a4a`, `#fff` | As above |
| 334 | `border-color` | `#6366f1` | `var(--accent-color)` |
| 340 | `border-color` | `#6366f1` | `var(--accent-color)` |
| 343 | `color` | `#888` | `var(--text-muted)` |
| 351 | `background` | `#2a2a4a` | `var(--hover-bg)` |
| 355 | `background` | `#3a3a5a` | `var(--active-bg)` |
| 383 | `color` | `#888` | `var(--text-muted)` |
| 386 | `color` | `#ccc` | `var(--text-secondary)` |
| 393 | `color` | `#888` | `var(--text-muted)` |
| 398 | `color` | `#6366f1` | `var(--accent-color)` |
| 405 | `background` | `linear-gradient(135deg, #6366f1, #8b5cf6)` | New `--accent-gradient` variable |
| 408 | `color` | `#fff` | `var(--text-on-accent)` |
| 434 | `color` | `#aaa` | `var(--text-secondary)` |
| 442 | `background` | `#0a0a14` | `var(--bg-primary)` |

**Total: ~45 violations**

---

#### `frontend/src/App.css`

| Line | Property | Hardcoded Value | Suggested Replacement |
|------|----------|-----------------|----------------------|
| 6 | `background` | `#121212` | `var(--bg-primary)` |
| 14 | `background` | `#1e1e1e` | `var(--bg-secondary)` |
| 15 | `border-bottom` | `#333` | `var(--border-color)` |
| 29 | `color` | `white` | `var(--text-primary)` |
| 35 | `color` | `#888` | `var(--text-muted)` |
| 44 | `color` | `white` | `var(--text-primary)` |
| 45 | `background` | `#333` | `var(--hover-bg)` |
| 49 | `color` | `#aaa` | `var(--text-secondary)` |
| 52 | `border-left` | `#444` | `var(--border-color)` |
| 65 | `color` | `#888` | `var(--text-muted)` |
| 73 | `color` | `#4ade80` | `var(--success-color)` |
| 77 | `color` | `#fbbf24` | `var(--warning-color)` |
| 81 | `color` | `#9ca3af` | `var(--text-muted)` |
| 85 | `color` | `#f87171` | `var(--error-color)` |
| 112 | `background` | `#1a1a1a` | `var(--bg-secondary)` |
| 121 | `color` | `white` | `var(--text-primary)` |
| 127 | `color` | `#888` | `var(--text-muted)` |
| 133 | `background` | `linear-gradient(135deg, #6366f1, #8b5cf6)` | `var(--accent-gradient)` |
| 137 | `color` | `white` | `var(--text-on-accent)` |
| 155 | `background` | `linear-gradient(135deg, #1a1a2e..#0f3460)` | `var(--onboarding-gradient)` |
| 159 | `color` | `white` | `var(--text-primary)` |
| 186 | `color` | `white` | `var(--text-primary)` |
| 203 | `background` | `linear-gradient(135deg, #6366f1, #8b5cf6)` | `var(--accent-gradient)` |
| 207 | `color` | `white` | `var(--text-on-accent)` |
| 226 | `background` | `linear-gradient(135deg, #7c3aed, #6d28d9)` | New gradient variable |
| 230 | `color` | `white` | `var(--text-on-accent)` |
| 250 | `background` | `#121212` | `var(--bg-primary)` |
| 271 | `border` | `#333` | `var(--border-color)` |
| 272 | `border-top-color` | `#6366f1` | `var(--accent-color)` |

**Total: 29 violations**

---

#### `frontend/src/components/Settings/Settings.css`

| Line | Property | Hardcoded Value | Suggested Replacement |
|------|----------|-----------------|----------------------|
| 96 | `color` | `#3b82f6` | `var(--accent-color)` or `var(--info-color)` |
| 97 | `border-bottom-color` | `#3b82f6` | `var(--accent-color)` |
| 168 | `border-color` | `#3b82f6` | `var(--accent-color)` |
| 201 | `box-shadow` | `#3b82f6` | `var(--accent-color)` |
| 235 | `background` | `linear-gradient(135deg, #3b82f6..#2563eb)` | `var(--accent-gradient)` |
| 283 | `color` | `#f87171` | `var(--error-color)` |
| 305 | `color` | `#fca5a5` | `var(--error-border)` |
| 314 | `color` | `#86efac` | `var(--success-color)` |
| 374 | `background` | `white` | `var(--bg-primary)` |
| 396 | `color` | `#3b82f6` | `var(--accent-color)` |
| 445 | `background` | `#3b82f6` | `var(--accent-color)` |
| 559 | `border-color` | `#3b82f6` | `var(--accent-color)` |
| 583 | `background` | `#1a1a2e` | `var(--bg-tertiary)` |
| 648 | `border-color` | `#6366f1` | `var(--accent-color)` |
| 697 | `background` | `#f87171` | `var(--error-color)` |
| 701 | `background` | `#4ade80` | `var(--success-color)` |
| 721 | `background` | `linear-gradient(90deg, #6366f1, #8b5cf6)` | `var(--accent-gradient)` |
| 756 | `color` | `#a5d6ff` | New `--info-light` variable |
| 807 | `color` | `#f87171` | `var(--error-color)` |
| 816 | `color` | `#a5b4fc` | `var(--accent-light)` |
| 824 | `color` | `#f87171` | `var(--error-color)` |
| 842 | `accent-color` | `#6366f1` | `var(--accent-color)` |
| 863 | `border-color` | `#6366f1` | `var(--accent-color)` |
| 868 | `background` | `#6366f1` | `var(--accent-color)` |
| 878 | `background` | `#5558e3` | `var(--accent-hover)` |

**Total: 25+ violations** (plus ~24 `color: white` and ~40 rgba)

---

#### `frontend/src/components/Onboarding/Onboarding.css`

| Line | Property | Hardcoded Value | Suggested Replacement |
|------|----------|-----------------|----------------------|
| 10 | `background` | `linear-gradient(135deg, #1a1a2e..#0f3460)` | `var(--onboarding-gradient)` |
| 40 | `color` | `#fff` | `var(--text-primary)` |
| 94 | `background` | `linear-gradient(135deg, #3b82f6..#2563eb)` | `var(--accent-gradient)` |
| 211 | `background` | `linear-gradient(135deg, #ef4444..#dc2626)` | New `--error-gradient` |
| 262 | `border-color` | `#3b82f6` | `var(--accent-color)` |
| 373 | `box-shadow` | `#3b82f6` | `var(--accent-color)` |
| 472 | `accent-color` | `#3b82f6` | `var(--accent-color)` |
| 533 | `color` | `#fca5a5` | `var(--error-border)` |
| 634 | `color` | `#fbbf24` | `var(--warning-color)` |
| 697 | `border-color` | `#6366f1` | `var(--accent-color)` |
| 703 | `border-color` | `#6366f1` | `var(--accent-color)` |
| 707 | `color` | `#fca5a5` | `var(--error-border)` |
| 731 | `color` | `#fbbf24` | `var(--warning-color)` |
| 747 | `border-top-color` | `#6366f1` | `var(--accent-color)` |

**Total: 14 hex violations** (plus 12 `color: white` and 40+ rgba)

---

### HIGH Priority Files

---

#### `frontend/src/components/Presence/Presence.css`

| Line | Property | Hardcoded Value | Suggested Replacement |
|------|----------|-----------------|----------------------|
| 22 | `background` | `#22c55e` | `var(--success-color)` |
| 51 | `border` | `#1a1a2e` | `var(--bg-tertiary)` |
| 77 | `background` | `#3b82f6` | `var(--accent-color)` |
| 79 | `border` | `#1a1a2e` | `var(--bg-tertiary)` |
| 99 | `border` | `#1a1a2e` | `var(--bg-tertiary)` |
| 320 | `color` | `#3b82f6` | `var(--accent-color)` |

**Total: 6 hex violations** (plus 6 `color: white`, 10+ rgba)

---

#### `frontend/src/components/Chat.css`

| Line | Property | Hardcoded Value | Suggested Replacement |
|------|----------|-----------------|----------------------|
| 95 | `background` | `#f59e0b` | `var(--warning-color)` |
| 96 | `color` | `#1a1a1a` | Dark text on warning — needs `--text-on-warning` |
| 372 | `color` | `#22c55e` | `var(--success-color)` |
| 619 | `background` | `#f59e0b` | `var(--warning-color)` |
| 620 | `color` | `#1a1a1a` | Dark text on warning |
| 765 | `color` | `#22c55e` | `var(--success-color)` |
| 808 | `color` | `#ef4444` | `var(--error-color)` |
| 814 | `color` | `#ffffff` | `var(--text-primary)` or `var(--text-on-accent)` |
| 819 | `color` | `#ffffff` | `var(--text-primary)` |

**Total: 9 violations** (plus ~15 `color: white`)

---

#### `frontend/src/components/WorkspaceSwitcher.css`

| Line | Property | Hardcoded Value | Suggested Replacement |
|------|----------|-----------------|----------------------|
| 350 | `color` | `#ef4444 !important` | `var(--error-color)` |
| 355 | `color` | `#dc2626 !important` | `var(--error-hover)` |
| 429 | `background` | `#ef4444` | `var(--error-color)` |
| 430 | `border` | `#ef4444` | `var(--error-color)` |
| 435 | `background` | `#dc2626` | `var(--error-hover)` |
| 436 | `border-color` | `#dc2626` | `var(--error-hover)` |
| 447-453 | CSS vars | `:root` override block | ✅ OK — these are variable definitions |

**Total: 6 violations** (lines 447-453 are variable definitions, excluded)

---

#### `frontend/src/components/WorkspaceSettings.css`

| Line | Property | Hardcoded Value | Suggested Replacement |
|------|----------|-----------------|----------------------|
| 94 | `background` | `#fef2f2` | `var(--error-bg-subtle)` (NEW) |
| 566 | `background` | `#fef2f2` | `var(--error-bg-subtle)` |
| 567 | `border-color` | `#fecaca` | `var(--error-border-subtle)` (NEW) |
| 586 | `background` | `#dc2626` | `var(--error-hover)` |
| 591 | `background` | `#b91c1c` | `var(--error-dark)` (NEW) |
| 622 | `color` | `#dc2626` | `var(--error-hover)` |
| 627 | `background` | `#dc2626` | `var(--error-hover)` |
| 638 | `background` | `#b91c1c` | `var(--error-dark)` |
| 643 | `box-shadow` | `#dc2626` (in box-shadow) | `var(--error-hover)` |
| 648 | `box-shadow` | `#dc2626` | `var(--error-hover)` |
| 654 | `border` | `#fca5a5` | `var(--error-border)` |
| 661 | `color` | `#111827` | `var(--text-primary)` (light value!) |
| 703 | `background` | `#dc2626` | `var(--error-hover)` |
| 714 | `background` | `#b91c1c` | `var(--error-dark)` |
| 719 | `box-shadow` | `#dc2626` | `var(--error-hover)` |
| 724 | `box-shadow` | `#dc2626` | `var(--error-hover)` |
| 729 | `background` | `#f59e0b` | `var(--warning-color)` |
| 733 | `background` | `#d97706` | `var(--warning-hover)` |
| 737 | `box-shadow` | `#f59e0b` | `var(--warning-color)` |
| 741 | `box-shadow` | `#f59e0b` | `var(--warning-color)` |
| 745 | `background` | `#f59e0b` | `var(--warning-color)` |
| 749 | `background` | `#d97706` | `var(--warning-hover)` |
| 753 | `box-shadow` | `#f59e0b` | `var(--warning-color)` |
| 757 | `box-shadow` | `#f59e0b` | `var(--warning-color)` |
| 877 | `background` | `#1f2937` | `var(--bg-secondary)` (dark override) |
| 878 | `border-color` | `#7f1d1d` | `var(--error-border-subtle)` |
| 882 | `color` | `#f9fafb` | `var(--text-primary)` |
| 905 | `background` | `#1f2937` | `var(--bg-secondary)` |
| 951 | `color` | `#b45309` | `var(--warning-text)` (NEW) |
| 972 | `color` | `#059669` | `var(--success-text)` (NEW) |
| 977 | `color` | `#dc2626` | `var(--error-hover)` |
| 1003 | `color` | `#b45309` | `var(--warning-text)` |
| 1043 | `color` | `#b45309` | `var(--warning-text)` |
| 1053 | `color` | `#059669` | `var(--success-text)` |

**Total: ~34 violations** (lines 863-869 are variable definitions, excluded)

---

#### `frontend/src/components/HierarchicalSidebar.css`

| Line | Property | Hardcoded Value | Suggested Replacement |
|------|----------|-----------------|----------------------|
| 207 | `color` | `#fff` | `var(--text-on-accent)` |
| 279 | `background` | `#16a34a` | `var(--success-hover)` |
| 288 | `background` | `linear-gradient(135deg, #3b82f6..#2563eb)` | `var(--accent-gradient)` |
| 294 | `background` | `linear-gradient(135deg, #2563eb..#1d4ed8)` | Darker accent gradient |
| 298 | `outline` | `#3b82f6` | `var(--accent-color)` |
| 303 | `background` | `linear-gradient(135deg, #f59e0b..#d97706)` | `var(--warning-gradient)` (NEW) |
| 309 | `background` | `linear-gradient(135deg, #d97706..#b45309)` | Darker warning gradient |
| 313 | `outline` | `#f59e0b` | `var(--warning-color)` |

**Total: 8 violations** (plus 8 `color: white`)

---

#### `frontend/src/components/RecoveryCodeModal.css`

| Line | Property | Hardcoded Value | Suggested Replacement |
|------|----------|-----------------|----------------------|
| 58 | `background` | `linear-gradient(135deg, #6366f1, #8b5cf6)` | `var(--accent-gradient)` |
| 116 | `background` | `#fef2f2` | `var(--error-bg-subtle)` |
| 118 | `border` | `#fecaca` | `var(--error-border-subtle)` |
| 124 | `color` | `#dc2626` | `var(--error-hover)` |
| 131 | `color` | `#991b1b` | `var(--error-darkest)` (NEW) |
| 305 | `background` | `#1f2937` | `var(--bg-secondary)` (dark override) |
| 309 | `color` | `#f9fafb` | `var(--text-primary)` |
| 313 | `color` | `#9ca3af` | `var(--text-tertiary)` |
| 317 | `background` | `#450a0a` | `var(--error-bg-subtle)` |
| 318 | `border-color` | `#7f1d1d` | `var(--error-border-subtle)` |
| 322 | `color` | `#fca5a5` | `var(--error-border)` |
| 326 | `background` | `#111827` | `var(--bg-primary)` |
| 327 | `border-color` | `#374151` | `var(--border-color)` |
| 331 | `background` | `#1f2937` | `var(--bg-secondary)` |
| 332 | `border-color` | `#374151` | `var(--border-color)` |
| 336 | `color` | `#f9fafb` | `var(--text-primary)` |
| 340 | `background` | `#374151` | `var(--hover-bg)` |
| 341 | `color` | `#f9fafb` | `var(--text-primary)` |
| 342 | `border-color` | `#4b5563` | `var(--border-color)` |
| 346 | `background` | `#111827` | `var(--bg-primary)` |
| 350 | `color` | `#f9fafb` | `var(--text-primary)` |

**Total: 21 violations** (lines 305-350 are in `@media (prefers-color-scheme: dark)` — should use CSS variables instead)

---

#### `frontend/src/components/LockScreen.css`

| Line | Property | Hardcoded Value | Suggested Replacement |
|------|----------|-----------------|----------------------|
| 12 | `background` | `linear-gradient(135deg, #1a1a2e..#0f3460)` | `var(--onboarding-gradient)` |
| 105 | `border-color` | `#6366f1` | `var(--accent-color)` |
| 111 | `border-color` | `#6366f1` | `var(--accent-color)` |
| 115 | `color` | `#fca5a5` | `var(--error-border)` |
| 138 | `border-top-color` | `#6366f1` | `var(--accent-color)` |

**Total: 5 violations** (plus 4 `color: white`)

---

### MEDIUM Priority Files

---

#### `frontend/src/index.css`

| Line | Property | Hardcoded Value | Suggested Replacement |
|------|----------|-----------------|----------------------|
| 6 | `color` | `rgba(255, 255, 255, 0.87)` | `var(--text-primary)` |
| 7 | `background-color` | `#242424` | `var(--bg-primary)` |

---

#### `frontend/src/components/Changelog.css`

| Line | Property | Hardcoded Value | Suggested Replacement |
|------|----------|-----------------|----------------------|
| 177 | `color` | `#f59e0b` | `var(--warning-color)` |
| 200 | `color` | `#000` | Needs dark text on warning var |
| 211 | `background` | `#d97706` | `var(--warning-hover)` |

**Total: 3 violations** (plus 4 `color: white`)

---

#### `frontend/src/components/Kanban.css`

| Line | Property | Hardcoded Value | Suggested Replacement |
|------|----------|-----------------|----------------------|
| 32 | `color` | `#a5b4fc` | `var(--accent-light)` |

**Total: 1 violation** (plus 5 `color: white`)

---

#### `frontend/src/components/TabBar.css`

| Line | Property | Hardcoded Value | Suggested Replacement |
|------|----------|-----------------|----------------------|
| 213 | `color` | `#ef4444` | `var(--error-color)` |

**Total: 1 violation** (plus 2 `color: white`)

---

#### `frontend/src/components/SelectionToolbar.css`

| Line | Property | Hardcoded Value | Suggested Replacement |
|------|----------|-----------------|----------------------|
| 350 | `color` | `#f59e0b` | `var(--warning-color)` |

**Total: 1 violation** (plus 4 `color: white`)

---

#### `frontend/src/components/Sidebar.css`

| Line | Property | Hardcoded Value | Suggested Replacement |
|------|----------|-----------------|----------------------|
| 397 | `box-shadow` | `#22c55e` (in box-shadow) | `var(--success-color)` |

**Total: 1 violation** (all other hex values are inside `var()` fallbacks ✅)

---

#### `frontend/src/styles/global.css` (outside `:root`)

| Line | Property | Hardcoded Value | Suggested Replacement |
|------|----------|-----------------|----------------------|
| 216 | `color` | `white` | `var(--text-on-accent)` — on accent button ⚠️ |
| 233 | `background` | `#22c55e` | `var(--success-color)` |
| 237 | `background` | `#16a34a` | `var(--success-hover)` |
| 245 | `background` | `#16a34a` | `var(--success-hover)` |
| 285 | `background` | `rgba(99, 102, 241, 0.1)` | `var(--accent-alpha)` |
| 513 | `color` | `white` | `var(--text-on-accent)` |

**Total: 6 violations**

---

### LOW Priority Files

These files use the `var(--name, #fallback)` pattern correctly for most properties. Only isolated violations exist:

#### `frontend/src/components/files/` subdirectory

These files use Catppuccin fallback colors in `var()` — mostly ✅ correct. However, they use Catppuccin colors directly (not in `var()`) for hover/active states in some places. The following standalone hardcoded colors were found:

| File | Line | Value | Suggested |
|------|------|-------|-----------|
| `UploadProgress.css` | 82 | `#f38ba8` | `var(--error-color)` |
| `FileContextMenu.css` | 41 | `#f38ba8` | `var(--error-color)` |
| `FileDetailPanel.css` | 130 | `#7ba7f0` | `var(--accent-hover)` |
| `FileDetailPanel.css` | 134-135 | `#f38ba8` | `var(--error-color)` |
| `FileDetailPanel.css` | 239 | `#f38ba8` | `var(--error-color)` |
| `FolderCreateDialog.css` | 127 | `#f38ba8` | `var(--error-color)` |
| `FolderCreateDialog.css` | 154 | `#3b3b52` | `var(--hover-bg)` |
| `FolderCreateDialog.css` | 163 | `#7ba7f0` | `var(--accent-hover)` |
| `FileMoveDialog.css` | 126 | `#7ba7f0` | `var(--accent-hover)` |
| `ReplaceDialog.css` | 69 | `#e67a96` | `var(--error-hover)` |
| `ReplaceDialog.css` | 78 | `#7ba7f0` | `var(--accent-hover)` |
| `ReplaceDialog.css` | 87 | `#3b3b52` | `var(--hover-bg)` |
| `TrashView.css` | 56-57 | `#a6e3a1` | `var(--success-color)` |
| `TrashView.css` | 62-63 | `#f38ba8` | `var(--error-color)` |
| `TrashView.css` | 67-68 | `#f38ba8` | `var(--error-color)` |
| `TrashView.css` | 143 | `#f38ba8` | `var(--error-color)` |
| `DownloadsView.css` | 48-49 | `#f38ba8` | `var(--error-color)` |
| `DownloadsView.css` | 104 | `#a6e3a1` | `var(--success-color)` |
| `DownloadsBar.css` | 64 | `#a6e3a1` | `var(--success-color)` |
| `DownloadsBar.css` | 70 | `#f38ba8` | `var(--error-color)` |
| `MeshView.css` | 84 | `#fab387` | `var(--warning-color)` |
| `MeshView.css` | 88 | `#a6e3a1` | `var(--success-color)` |
| `MeshView.css` | 218 | `#a6e3a1` | `var(--success-color)` |
| `MeshView.css` | 222 | `#fab387` | `var(--warning-color)` |
| `FolderCard.css` | 32 | `#a6e3a1` | `var(--success-color)` |
| `FileStorageSettings.css` | 39 | `#7ba7f0` | `var(--accent-hover)` |
| `FileStorageSettings.css` | 102 | `#f38ba8` | `var(--error-color)` |
| `FileStorageSettings.css` | 131 | `#f38ba8` | `var(--error-color)` |
| `FileStorageSettings.css` | 134 | `#f38ba8` | `var(--error-color)` |
| `FileStorageSettings.css` | 152 | `#f38ba8` | `var(--error-color)` |
| `FileStorageSettings.css` | 157 | `#e67a96` | `var(--error-hover)` |
| `ConfirmDialog.css` | 67,73 | `#f38ba8` | `var(--error-color)` |
| `BulkTagDialog.css` | 98 | `#f38ba8` | `var(--error-color)` |
| `BulkTagDialog.css` | 131 | `#f38ba8` | `var(--error-color)` |
| `BulkTagDialog.css` | 137 | `#fab387` | `var(--warning-color)` |
| `BulkActionBar.css` | 78,82 | `#f38ba8` | `var(--error-color)` |
| `FilePickerModal.css` | 217 | `#7ba7f0` | `var(--accent-hover)` |
| `UploadZone.css` | 82 | `#7ba7f0` | `var(--accent-hover)` |

---

## `color: white` / `color: #fff` Audit

168 instances across 40+ files. These fall into categories:

### ⚠️ Acceptable: White text on accent-colored buttons
These are OK because white text is always correct on `--accent-color` / `--error-color` / `--success-color` backgrounds:

- `global.css` L216, L513 — `.btn-create` on accent background
- `Sidebar.css` L119, L174 — accent buttons
- `HierarchicalSidebar.css` L150, L259, L274, L289, L304 — colored action buttons
- `Share.css` L203 — submit button on accent bg
- `SelectionToolbar.css` L60, L87 — accent buttons
- `WorkspaceSwitcher.css` L108, L329 — accent/error buttons
- `WorkspaceSettings.css` various — accent/error/warning buttons

### 🔴 Must Fix: White text used for general content
These should be `var(--text-primary)`:

| File | Lines |
|------|-------|
| `App.css` | 29, 44, 121, 137, 159, 186, 207, 230 |
| `Chat.css` | 50, 81, 186, 199, 360, 473, 509, 564, 604, 696, 706, 780, 849, 878, 950 |
| `Sidebar.css` | 203, 208, 370, 389 |
| `HierarchicalSidebar.css` | 379, 388, 550 |
| `StatusBar.css` | 288, 342, 474, 485, 551, 764 |
| `Kanban.css` | 44, 131, 212, 439, 495 |
| `Changelog.css` | 68, 129, 353, 609 |
| `Comments.css` | 170, 270, 344, 391 |
| `CollaboratorList.css` | 50, 101, 156 |
| `DocumentPicker.css` | 31, 365 |
| `LockScreen.css` | 53, 83, 101, 161 |
| `RecoveryCodeModal.css` | 68, 157, 253 |
| `TabBar.css` | 107, 150 |
| `Toolbar.css` | 69 |
| `UserProfile.css` | 562 |
| `UserFlyout.css` | 44 |
| `SyncProgressModal.css` | 211 |
| `Sheet.css` | 321, 376 |
| `DocumentCollaborators.css` | 38 |
| `CreateWorkspace.css` | 274 |
| `CreateFolder.css` | 235 |
| `CreateDocument.css` | 275 |
| `AccessDenied.css` | 75 |
| `RelaySettings.css` | 395 |
| `KickedModal.css` | 133 |
| `common/AddDropdown.css` | 17, 268 |
| `common/AppSettings.css` | 457, 483 |
| `common/EditPropertiesModal.css` | 331, 371 |
| `common/JoinWithLink.css` | 181, 186, 204, 279 |
| `common/ConfirmDialog.css` | 93, 103 |
| `styles/editor.css` | 206, 239 |

### 🔴 Must Fix: `background: white` / `background-color: white`

| File | Line | Suggested |
|------|------|-----------|
| `SplitPane.css` | 101 | `var(--bg-primary)` |
| `PinInput.css` | 29 | `var(--bg-primary)` |
| `IdentitySelector.css` | 17, 101, 382 | `var(--bg-primary)` |
| `UserProfile.css` | 508 | `var(--bg-primary)` |
| `WorkspaceSettings.css` | 653 | `var(--bg-primary)` |
| `Settings.css` | 374 | `var(--bg-primary)` |

---

## Hardcoded `rgba()` Audit

### 🔴 Theme-dependent `rgba()` that need variables

| Pattern | Meaning | Fix |
|---------|---------|-----|
| `rgba(255, 255, 255, 0.x)` | White overlays (dark-theme only) | Need theme-aware `--overlay-*` variables |
| `rgba(137, 180, 250, 0.x)` | Catppuccin blue accent | `var(--accent-alpha)` or new variable |
| `rgba(243, 139, 168, 0.x)` | Catppuccin red | `var(--error-bg)` |
| `rgba(166, 227, 161, 0.x)` | Catppuccin green | `var(--success-bg)` |
| `rgba(99, 102, 241, 0.x)` | Indigo accent | `var(--accent-alpha)` |
| `rgba(239, 68, 68, 0.x)` | Error red | `var(--error-bg)` |
| `rgba(34, 197, 94, 0.x)` | Success green | `var(--success-bg)` |
| `rgba(245, 158, 11, 0.x)` | Warning amber | `var(--warning-bg)` |

### ✅ Acceptable `rgba()` (theme-independent)
| Pattern | Usage |
|---------|-------|
| `rgba(0, 0, 0, 0.x)` | Shadows, overlays — generally OK |

Files with heaviest rgba violations: Settings.css (~40), Onboarding.css (~40), Presence.css (~10), StatusBar.css (~10), Share.css (~10)

---

## Color-to-Variable Mapping Cheat Sheet

Use this when fixing violations:

| Hardcoded Color | CSS Variable |
|----------------|--------------|
| `#fff` / `white` / `#ffffff` | `var(--text-primary)` (text) or `var(--text-on-accent)` (on buttons) |
| `#000` / `black` | Context-dependent |
| `#888` / `#666` / `#aaa` / `#9ca3af` | `var(--text-muted)` |
| `#ccc` / `#bbb` | `var(--text-secondary)` |
| `#444` / `#555` / `#333` | `var(--border-color)` or `var(--hover-bg)` |
| `#121212` / `#0a0a14` / `#0f0f17` | `var(--bg-primary)` |
| `#1a1a1a` / `#1e1e1e` / `#242424` / `#2c2c2c` | `var(--bg-secondary)` |
| `#1a1a2e` | `var(--bg-tertiary)` |
| `#2a2a4a` / `#2d2d44` | `var(--border-color)` or `var(--hover-bg)` |
| `#3a3a5a` / `#3d3d5c` | `var(--active-bg)` |
| `#3b3b52` | `var(--hover-bg)` |
| `#6366f1` | `var(--accent-color)` |
| `#5558e3` / `#4f46e5` | `var(--accent-hover)` |
| `#818cf8` / `#a5b4fc` / `#c4b5fd` | `var(--accent-light)` |
| `#8b5cf6` | `var(--accent-light)` (or new `--accent-purple`) |
| `#3b82f6` | `var(--accent-color)` or `var(--info-color)` |
| `#2563eb` | `var(--accent-hover)` |
| `#7ba7f0` | `var(--accent-hover)` |
| `#22c55e` / `#4ade80` / `#86efac` / `#a6e3a1` | `var(--success-color)` |
| `#16a34a` | `var(--success-hover)` |
| `#059669` | `var(--success-text)` (NEW) |
| `#f59e0b` / `#fbbf24` / `#fab387` | `var(--warning-color)` |
| `#d97706` | `var(--warning-hover)` |
| `#b45309` | `var(--warning-text)` (NEW) |
| `#ef4444` / `#f87171` / `#f38ba8` | `var(--error-color)` |
| `#dc2626` / `#e67a96` | `var(--error-hover)` |
| `#b91c1c` | `var(--error-dark)` (NEW) |
| `#991b1b` | `var(--error-darkest)` (NEW) |
| `#fca5a5` | `var(--error-border)` |
| `#fecaca` | `var(--error-border-subtle)` (NEW) |
| `#fef2f2` | `var(--error-bg-subtle)` (NEW) |
| `#450a0a` | `var(--error-bg-subtle)` (dark theme value — NEW) |
| `#fef08a` | `var(--highlight-bg)` (NEW) |
| `#a5d6ff` | `var(--info-light)` (NEW) |

---

## Recommended Fix Order

1. **Add new CSS variables** to `global.css` `:root` and `:root[data-theme="light"]`
2. **Fix critical files first**: Editor.css, Share.css, App.css, Settings.css, Onboarding.css
3. **Fix high-priority files**: Presence.css, Chat.css, WorkspaceSwitcher.css, WorkspaceSettings.css, HierarchicalSidebar.css
4. **Replace `color: white`** across all files (quick find-and-replace for non-button contexts)
5. **Fix files/ subdirectory** Catppuccin standalone colors
6. **Address rgba() values** — most complex, may need new CSS variables with alpha channel support
7. **Fix RecoveryCodeModal.css** dark mode media query — should use CSS variables instead of hardcoded dark colors

---

*End of audit report*
