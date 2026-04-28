# Faiz Portfolio — Design Spec

**Date:** 2026-04-27  
**Stack:** Vite + React  
**Status:** Approved

---

## Overview

A single-page personal photography portfolio for Faiz. The site IS the gallery — no navigation, no about page, no contact. Pure artistic expression. The photos speak for themselves.

**Aesthetic:** Cinematic. Pure black background. Images fill the screen. Minimal UI chrome.

---

## Architecture

### Stack
- **Vite + React** — static SPA, no routing, no server-side rendering
- **No external UI libraries** — custom layout engine only
- **Deployment:** static hosting (Netlify / Vercel / GitHub Pages)

### File Structure
```
/
├── public/
│   └── images/          ← all photos from "new portfolio images" folder
├── src/
│   ├── App.jsx           ← root component
│   ├── main.jsx          ← Vite entry point
│   ├── index.css         ← global styles (reset, body background, font)
│   └── components/
│       ├── Gallery.jsx   ← justified layout engine
│       └── Lightbox.jsx  ← full-screen image viewer
├── index.html
├── vite.config.js
└── package.json
```

---

## Visual System

| Property | Value |
|---|---|
| Background | `#0A0A0A` |
| Text color | `#FFFFFF` |
| Image gap | `3px` |
| Font | Archivo Light — Google Fonts |
| Name treatment | Uppercase, `letter-spacing: 0.3em`, light weight (300) |
| Hover effect | `filter: brightness(1.08)`, `transition: 0.3s ease` |
| Scroll entrance | Fade in via `IntersectionObserver` |

### What exists on the page
1. Site name "FAIZ" — top-left, small, uppercase, thin weight
2. The justified gallery — fills the rest of the viewport and continues below the fold
3. Nothing else

---

## Gallery Component (`Gallery.jsx`)

### Layout: Justified Grid
Images maintain their **natural aspect ratios**. Each row is scaled so all images share the same row height and together fill 100% of the container width.

**Algorithm:**
1. On mount, read each image's `naturalWidth` and `naturalHeight` to compute aspect ratio
2. Group images into rows targeting a row height of `220px` on desktop
3. For each row: `imageWidth = rowHeight * aspectRatio`; scale all widths proportionally so the row fills 100% of container
4. Re-run on `window.resize` (debounced 100ms)

**Gap:** `3px` between all images (horizontal and vertical)

### Mobile fallback
Below `640px`: 2-column CSS grid with fixed row height (`180px`), images use `object-fit: cover`. The justified math becomes too tight on small screens.

### Image loading
- Images live in `public/images/` and are referenced by URL path (`/images/filename.jpg`)
- A `src/images.js` file exports an ordered array of filenames — this is the single source of truth for gallery order
- The justified layout is computed after images load: each `<img>` fires `onLoad`, which reads `naturalWidth`/`naturalHeight` to get the aspect ratio; layout recalculates once all ratios are known
- Images render with `loading="lazy"` so only near-viewport images are fetched
- Fade-in animation triggered by `IntersectionObserver` when image enters viewport

---

## Lightbox Component (`Lightbox.jsx`)

Triggered by clicking any gallery photo.

### Behavior
- Full-screen black overlay (`background: #000`)
- Selected image centered, scaled to fit (`max-width: 95vw`, `max-height: 95vh`)
- Smooth open/close: opacity + scale transition (`0.25s ease`)

### Navigation
| Input | Action |
|---|---|
| `←` / `→` arrow keys | Previous / next photo |
| `Escape` | Close lightbox |
| Click outside image | Close lightbox |
| On-screen prev/next arrows | Fade out after 2s of inactivity, reappear on mouse move |

### State
- `isOpen: boolean`
- `currentIndex: number` — index into the gallery images array
- Trap focus inside lightbox while open (accessibility)
- `overflow: hidden` on `body` while lightbox is open to prevent background scroll

---

## Animations & Motion

| Trigger | Animation |
|---|---|
| Page load | Images fade in row by row as they enter viewport |
| Gallery image hover | `brightness(1.08)`, `0.3s ease` |
| Lightbox open | Fade + slight scale up (`scale(0.96) → scale(1)`), `0.25s ease` |
| Lightbox close | Reverse of open |
| Lightbox prev/next | Crossfade between images, `0.2s ease` |
| On-screen arrows | Fade out `2s` after last mouse move |

All animations respect `prefers-reduced-motion`: fade only, no scale/transform.

---

## Responsive Behavior

| Breakpoint | Layout |
|---|---|
| `≥ 640px` | Justified grid, target row height `220px` |
| `< 640px` | 2-column fixed grid, row height `180px`, `object-fit: cover` |

---

## Image Assets

- Source: `new portfolio images/` folder (~90 JPG/PNG files)
- Copied to `public/images/` during setup
- No resizing or compression in scope — served as-is from Vite's static server
- Future: can add a build step to generate WebP + responsive srcsets

---

## Out of Scope

- About page
- Contact page or form
- Image categories or filtering
- Captions or metadata display
- Dark/light mode toggle (dark only)
- Social links
- Analytics
