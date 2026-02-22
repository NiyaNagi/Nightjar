# Nightjar v1.7.17 Release Notes

**Release Date:** February 20, 2026

This release refreshes the **PWA icons** so the Nightjar bird appears on a transparent background — just the bird by itself — and fills most of the icon space for a clean, native look on mobile home screens.

---

## 🐦 PWA Icon Refresh

**Before:** The PWA icons had the bird on a dark background rectangle, which looked out of place on both light and dark mobile home screens.

**After:** The bird is rendered on a fully transparent background, sized to fill ~94% of the icon width, so it displays as a standalone bird silhouette — just like a native app icon.

### Icons Generated

| File | Size | Purpose | Background |
|------|------|---------|------------|
| `nightjar-512.png` | 512×512 | Standard PWA icon | Transparent |
| `nightjar-192.png` | 192×192 | Standard PWA icon | Transparent |
| `apple-touch-icon.png` | 180×180 | iOS "Add to Home Screen" | Transparent |
| `nightjar-maskable-512.png` | 512×512 | Maskable (OS-shaped) | App dark (#0f0f17) |

### Maskable vs Standard Icons

- **Standard icons** (`nightjar-192.png`, `nightjar-512.png`): Transparent background. The OS displays the bird as-is — perfect for platforms that show the raw icon (desktop PWA, Android with transparent icon support).
- **Maskable icon** (`nightjar-maskable-512.png`): Has the app's dark background color (`#0f0f17`) with the bird sized inside the [safe zone](https://web.dev/maskable-icon/) (inner 80%). This allows the OS to crop the icon to any shape (circle, squircle, rounded rectangle) without cutting off the bird. Used on Android devices that apply adaptive icon shapes.

### Icon Sizing

The bird is extracted from the high-resolution source (`assets/icons/nightjar-crop.png`, 1203×893), tightly cropped to content, and placed on the canvas with:

- **3% padding** on the constraining dimension (width) for standard icons
- **Safe-zone-aware padding** for the maskable icon (bird fills 90% of the inner 80% safe area)
- **LANCZOS resampling** for sharp downscaling

### Manifest Changes

The `manifest.json` maskable icon entry now points to the dedicated `nightjar-maskable-512.png` instead of reusing the transparent `nightjar-512.png` (which would look wrong when the OS applies a shaped mask to a transparent image).

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/public/nightjar-512.png` | Regenerated — transparent background, bird fills 94% width |
| `frontend/public/nightjar-192.png` | Regenerated — transparent background, bird fills 94% width |
| `frontend/public/apple-touch-icon.png` | Regenerated — transparent background, 180×180 |
| `frontend/public/nightjar-maskable-512.png` | **New** — maskable icon with dark background and safe-zone sizing |
| `frontend/public/manifest.json` | Maskable icon `src` → `nightjar-maskable-512.png` |
| `package.json` | Version bump `1.7.16` → `1.7.17` |
