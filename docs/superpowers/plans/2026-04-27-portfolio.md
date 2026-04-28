# Faiz Portfolio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-page cinematic photography portfolio — a justified gallery of ~90 photos on a pure black background, with a full-screen lightbox on click.

**Architecture:** Vite + React SPA. A one-time Node.js script reads image dimensions at setup time and writes `src/image-data.js` so the layout algorithm has all aspect ratios synchronously on mount. The justified layout engine (`src/lib/buildRows.js`) is a pure function tested with Vitest. Two components — `Gallery` and `Lightbox` — are wired together in `App.jsx`.

**Tech Stack:** Vite 5, React 19, Vitest (tests), `image-size` (dev-only, dimension extraction script)

---

## File Map

| File | Role |
|---|---|
| `public/images/` | All photo assets, served statically |
| `scripts/generate-image-data.mjs` | One-time script: reads image dimensions, writes `src/image-data.js` |
| `src/image-data.js` | Auto-generated: `[{ src, aspectRatio }, ...]` — source of truth for gallery order |
| `src/lib/buildRows.js` | Pure function: aspect ratios + container width → justified row layout |
| `src/lib/buildRows.test.js` | Vitest unit tests for buildRows |
| `src/components/Gallery.jsx` | Renders justified grid, handles resize, scroll fade-in, mobile fallback |
| `src/components/Lightbox.jsx` | Full-screen overlay, keyboard nav, fading arrows |
| `src/App.jsx` | Root: header + Gallery + Lightbox, manages lightbox open/index state |
| `src/main.jsx` | Vite entry point |
| `src/index.css` | Global reset, background, font, all component CSS |
| `index.html` | HTML shell with font preconnect |
| `vite.config.js` | Vite config with test block |
| `package.json` | Dependencies and scripts |

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `vite.config.js`
- Create: `index.html`
- Create: `src/main.jsx`

- [ ] **Step 1: Initialise the project**

Run in the project root (`/Users/faiznazeer/Desktop/Portfolio Site Claude`):

```bash
npm create vite@latest . -- --template react
```

When prompted "Current directory is not empty. Remove existing files and continue?" — **yes** (only `.superpowers/` and `docs/` exist, Vite will scaffold around them).

- [ ] **Step 2: Install dependencies**

```bash
npm install
npm install --save-dev vitest @vitest/ui image-size
```

- [ ] **Step 3: Replace `vite.config.js`**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 4: Replace `package.json` scripts block**

Open `package.json` and replace the `"scripts"` block with:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "generate-data": "node scripts/generate-image-data.mjs"
},
```

- [ ] **Step 5: Replace `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Faiz</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Archivo:wght@300;400&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Replace `src/main.jsx`**

```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 7: Verify dev server starts**

```bash
npm run dev
```

Expected: server starts at `http://localhost:5173`, browser shows default Vite + React page. Stop the server (`Ctrl+C`).

- [ ] **Step 8: Commit**

```bash
git init
git add package.json package-lock.json vite.config.js index.html src/main.jsx
git commit -m "feat: scaffold Vite + React project"
```

---

## Task 2: Copy Images & Generate Data Manifest

**Files:**
- Create: `public/images/` (copy from source)
- Create: `scripts/generate-image-data.mjs`
- Create: `src/image-data.js` (generated output)

- [ ] **Step 1: Copy images to `public/images/`**

```bash
mkdir -p public/images
cp -r "new portfolio images/." public/images/
ls public/images/ | wc -l
```

Expected: a count of ~93 files.

- [ ] **Step 2: Create `scripts/generate-image-data.mjs`**

```js
import { imageSize } from 'image-size';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, extname } from 'path';

const IMAGES_DIR = 'public/images';
const OUTPUT = 'src/image-data.js';

const VALID_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const filenames = readdirSync(IMAGES_DIR)
  .filter(f => VALID_EXT.has(extname(f).toLowerCase()))
  .sort();

const imageData = filenames.map(filename => {
  const buffer = readFileSync(join(IMAGES_DIR, filename));
  const { width, height } = imageSize(buffer);
  return { src: filename, aspectRatio: +(width / height).toFixed(6) };
});

const content =
  `// Auto-generated by scripts/generate-image-data.mjs — do not edit by hand.\n` +
  `// Run: npm run generate-data\n` +
  `export default ${JSON.stringify(imageData, null, 2)};\n`;

writeFileSync(OUTPUT, content);
console.log(`✓ Generated ${imageData.length} entries → ${OUTPUT}`);
```

- [ ] **Step 3: Run the script**

```bash
npm run generate-data
```

Expected output:
```
✓ Generated 93 entries → src/image-data.js
```

- [ ] **Step 4: Verify the output**

```bash
head -10 src/image-data.js
```

Expected: a JS file starting with the comment header and `export default [`, with objects like `{ "src": "DSCF0185.JPG", "aspectRatio": 1.5 }`.

- [ ] **Step 5: Commit**

```bash
git add public/images scripts/generate-image-data.mjs src/image-data.js
git commit -m "feat: copy images and generate aspect-ratio manifest"
```

---

## Task 3: Global Styles & App Shell

**Files:**
- Create: `src/index.css`
- Create: `src/App.jsx`

- [ ] **Step 1: Write `src/index.css`**

```css
/* ── Reset ── */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* ── Root ── */
html, body {
  background: #0a0a0a;
  color: #fff;
  font-family: 'Archivo', sans-serif;
  font-weight: 300;
  min-height: 100vh;
}

/* ── Header ── */
.site-header {
  padding: 20px 20px 14px;
}

.site-name {
  font-size: 11px;
  font-weight: 300;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: #fff;
  user-select: none;
}

/* ── Gallery (desktop: justified) ── */
.gallery {
  padding: 0 3px 3px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.gallery-row {
  display: flex;
  gap: 3px;
  align-items: flex-start;
}

.gallery-item {
  flex: none;
  padding: 0;
  border: none;
  background: #111;
  cursor: pointer;
  overflow: hidden;
  display: block;
  opacity: 0;
  transition: opacity 0.5s ease, filter 0.3s ease;
}

.gallery-item.visible {
  opacity: 1;
}

.gallery-item img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.gallery-item:hover img {
  filter: brightness(1.08);
}

/* ── Gallery (mobile: 2-column fixed grid) ── */
@media (max-width: 639px) {
  .gallery {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    padding: 3px;
    gap: 3px;
    flex-direction: unset;
  }

  .gallery-row {
    display: contents;
  }

  .gallery-item {
    width: 100% !important;
    height: 180px !important;
  }
}

/* ── Lightbox ── */
.lightbox-overlay {
  position: fixed;
  inset: 0;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: lb-in 0.25s ease forwards;
}

@keyframes lb-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.lightbox-overlay.closing {
  animation: lb-out 0.2s ease forwards;
}

@keyframes lb-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}

.lightbox-image {
  max-width: 95vw;
  max-height: 95vh;
  object-fit: contain;
  display: block;
  animation: lb-img-in 0.25s ease forwards;
}

@keyframes lb-img-in {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: scale(1); }
}

.lightbox-image.fading {
  animation: lb-img-fade 0.2s ease forwards;
}

@keyframes lb-img-fade {
  from { opacity: 1; }
  to   { opacity: 0; }
}

.lightbox-arrow {
  position: fixed;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  font-size: 48px;
  line-height: 1;
  cursor: pointer;
  padding: 16px 20px;
  transition: opacity 0.3s ease, color 0.2s ease;
  user-select: none;
}

.lightbox-arrow:hover {
  color: #fff;
}

.lightbox-prev { left: 8px; }
.lightbox-next { right: 8px; }

.lightbox-arrow.hidden {
  opacity: 0;
  pointer-events: none;
}

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  .gallery-item,
  .lightbox-overlay,
  .lightbox-image,
  .lightbox-arrow {
    animation: none !important;
    transition: none !important;
    opacity: 1 !important;
  }

  .gallery-item.visible {
    opacity: 1;
  }
}
```

- [ ] **Step 2: Write `src/App.jsx` (shell only — Gallery and Lightbox added in later tasks)**

```jsx
export default function App() {
  return (
    <>
      <header className="site-header">
        <span className="site-name">Faiz</span>
      </header>
    </>
  );
}
```

- [ ] **Step 3: Verify in browser**

```bash
npm run dev
```

Open `http://localhost:5173`. Expected: pure black page, "FAIZ" in small uppercase top-left. Stop server.

- [ ] **Step 4: Commit**

```bash
git add src/index.css src/App.jsx
git commit -m "feat: add global styles and app shell"
```

---

## Task 4: buildRows Algorithm (TDD)

**Files:**
- Create: `src/lib/buildRows.js`
- Create: `src/lib/buildRows.test.js`

The justified layout algorithm takes a flat list of images (each with an `aspectRatio`), a container width, a target row height, and a gap size. It returns an array of rows; each row is an array of image objects with computed `width` and `height`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/buildRows.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildRows } from './buildRows';

describe('buildRows', () => {
  it('returns empty array for no images', () => {
    expect(buildRows([], 1000, 220, 3)).toEqual([]);
  });

  it('returns empty array when containerWidth is 0', () => {
    const imgs = [{ src: 'a.jpg', aspectRatio: 1.5 }];
    expect(buildRows(imgs, 0, 220, 3)).toEqual([]);
  });

  it('single image: row uses targetRowHeight', () => {
    const imgs = [{ src: 'a.jpg', aspectRatio: 2.0 }];
    const rows = buildRows(imgs, 1000, 220, 3);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(1);
    expect(rows[0][0].height).toBe(220);
    expect(rows[0][0].width).toBeCloseTo(220 * 2.0);
  });

  it('fills a row when combined width reaches targetRowHeight', () => {
    // 5 wide images (aspectRatio 4.0) in a 1000px container
    // n=1: height = 1000/4 = 250 > 220 → continue
    // n=2: height = (1000-3)/8 = 124.6 ≤ 220 → row fills at 2
    // So we get rows of 2, 2, 1
    const imgs = Array.from({ length: 5 }, (_, i) => ({
      src: `${i}.jpg`,
      aspectRatio: 4.0,
    }));
    const rows = buildRows(imgs, 1000, 220, 3);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveLength(2);
    expect(rows[1]).toHaveLength(2);
    expect(rows[2]).toHaveLength(1);
  });

  it('full rows have height ≤ targetRowHeight', () => {
    const imgs = Array.from({ length: 10 }, (_, i) => ({
      src: `${i}.jpg`,
      aspectRatio: 1.5,
    }));
    const rows = buildRows(imgs, 1000, 220, 3);
    rows.slice(0, -1).forEach(row => {
      expect(row[0].height).toBeLessThanOrEqual(220);
    });
  });

  it('last incomplete row uses targetRowHeight', () => {
    // 3 portrait images (0.75) — they are narrow so many fit in a row before filling
    // With targetRowHeight=220 and containerWidth=1000:
    // n=1: 1000/0.75 = 1333 > 220
    // n=2: 997/1.5 = 664 > 220
    // ... keep going until height ≤ 220
    // n=7: (1000-18)/5.25 = 187 ≤ 220 → row fills before last image
    // Use just 3 images — they form one incomplete last row
    const imgs = [
      { src: 'a.jpg', aspectRatio: 0.75 },
      { src: 'b.jpg', aspectRatio: 0.75 },
      { src: 'c.jpg', aspectRatio: 0.75 },
    ];
    const rows = buildRows(imgs, 1000, 220, 3);
    // All 3 fit in one row before triggering height ≤ 220 (last image → use targetRowHeight)
    expect(rows).toHaveLength(1);
    expect(rows[0][0].height).toBe(220);
  });

  it('image width = aspectRatio × height', () => {
    const imgs = [
      { src: 'a.jpg', aspectRatio: 1.5 },
      { src: 'b.jpg', aspectRatio: 0.75 },
    ];
    const rows = buildRows(imgs, 1000, 220, 3);
    rows.flat().forEach(img => {
      expect(img.width).toBeCloseTo(img.aspectRatio * img.height, 1);
    });
  });

  it('output preserves src from input', () => {
    const imgs = [{ src: 'DSCF0185.JPG', aspectRatio: 1.5 }];
    const rows = buildRows(imgs, 1000, 220, 3);
    expect(rows[0][0].src).toBe('DSCF0185.JPG');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test
```

Expected: all tests fail with `Cannot find module './buildRows'`.

- [ ] **Step 3: Write `src/lib/buildRows.js`**

```js
/**
 * Justified layout algorithm.
 * Groups images into rows so each row shares the same height and fills
 * the full container width, while images keep their natural aspect ratios.
 *
 * @param {Array<{src: string, aspectRatio: number}>} images
 * @param {number} containerWidth - available pixel width
 * @param {number} targetRowHeight - ideal row height in px (e.g. 220)
 * @param {number} gap - gap between images in px (e.g. 3)
 * @returns {Array<Array<{src: string, aspectRatio: number, width: number, height: number}>>}
 */
export function buildRows(images, containerWidth, targetRowHeight, gap) {
  if (!images.length || containerWidth === 0) return [];

  const rows = [];
  let rowStart = 0;

  for (let i = 0; i < images.length; i++) {
    const rowImages = images.slice(rowStart, i + 1);
    const gapTotal = gap * (rowImages.length - 1);
    const availableWidth = containerWidth - gapTotal;
    const totalAspect = rowImages.reduce((sum, img) => sum + img.aspectRatio, 0);
    const rowHeight = availableWidth / totalAspect;

    const isLast = i === images.length - 1;
    const isFull = rowHeight <= targetRowHeight;

    if (isFull || isLast) {
      const finalHeight = isFull ? rowHeight : targetRowHeight;
      rows.push(
        rowImages.map(img => ({
          src: img.src,
          aspectRatio: img.aspectRatio,
          width: img.aspectRatio * finalHeight,
          height: finalHeight,
        }))
      );
      rowStart = i + 1;
    }
  }

  return rows;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test
```

Expected:
```
✓ src/lib/buildRows.test.js (7)
  ✓ returns empty array for no images
  ✓ returns empty array when containerWidth is 0
  ✓ single image: row uses targetRowHeight
  ✓ fills a row when combined width reaches targetRowHeight
  ✓ full rows have height ≤ targetRowHeight
  ✓ last incomplete row uses targetRowHeight
  ✓ image width = aspectRatio × height
  ✓ output preserves src from input

Test Files  1 passed (1)
Tests       7 passed (7)
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/buildRows.js src/lib/buildRows.test.js
git commit -m "feat: add justified layout algorithm with tests"
```

---

## Task 5: Gallery Component

**Files:**
- Create: `src/components/Gallery.jsx`

- [ ] **Step 1: Write `src/components/Gallery.jsx`**

```jsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { buildRows } from '../lib/buildRows';
import imageData from '../image-data';

const TARGET_ROW_HEIGHT = 220;
const GAP = 3;
const MOBILE_BREAKPOINT = 640;

export default function Gallery({ onImageClick }) {
  const containerRef = useRef(null);
  const [rows, setRows] = useState([]);
  const [isMobile, setIsMobile] = useState(window.innerWidth < MOBILE_BREAKPOINT);

  const rebuildLayout = useCallback(() => {
    if (!containerRef.current || isMobile) return;
    const width = containerRef.current.clientWidth;
    setRows(buildRows(imageData, width, TARGET_ROW_HEIGHT, GAP));
  }, [isMobile]);

  // Initial layout + rebuild on resize
  useEffect(() => {
    rebuildLayout();
    let timeout;
    const handleResize = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      clearTimeout(timeout);
      timeout = setTimeout(rebuildLayout, 100);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timeout);
    };
  }, [rebuildLayout]);

  // Scroll fade-in via IntersectionObserver
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -40px 0px', threshold: 0.1 }
    );

    const items = document.querySelectorAll('.gallery-item');
    items.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [rows, isMobile]);

  // Mobile: simple flat list, CSS handles 2-column grid
  if (isMobile) {
    return (
      <div className="gallery" ref={containerRef}>
        <div className="gallery-row">
          {imageData.map((img, idx) => (
            <GalleryItem
              key={img.src}
              src={img.src}
              width={undefined}
              height={undefined}
              onClick={() => onImageClick(idx)}
            />
          ))}
        </div>
      </div>
    );
  }

  // Desktop: justified rows
  return (
    <div className="gallery" ref={containerRef}>
      {rows.map((row, rowIdx) => {
        const rowOffset = rows.slice(0, rowIdx).reduce((acc, r) => acc + r.length, 0);
        return (
          <div key={rowIdx} className="gallery-row">
            {row.map((img, imgIdx) => (
              <GalleryItem
                key={img.src}
                src={img.src}
                width={img.width}
                height={img.height}
                onClick={() => onImageClick(rowOffset + imgIdx)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function GalleryItem({ src, width, height, onClick }) {
  const style = width !== undefined
    ? { width: `${width}px`, height: `${height}px` }
    : {};
  return (
    <button
      className="gallery-item"
      style={style}
      onClick={onClick}
      aria-label={`View photo ${src}`}
    >
      <img
        src={`/images/${src}`}
        alt=""
        loading="lazy"
        width={width}
        height={height}
      />
    </button>
  );
}
```

- [ ] **Step 2: Add Gallery to `src/App.jsx`**

```jsx
import { useState } from 'react';
import Gallery from './components/Gallery';

export default function App() {
  const [lightboxIndex, setLightboxIndex] = useState(null);

  return (
    <>
      <header className="site-header">
        <span className="site-name">Faiz</span>
      </header>
      <Gallery onImageClick={setLightboxIndex} />
      {/* Lightbox added in Task 6 */}
    </>
  );
}
```

- [ ] **Step 3: Verify in browser**

```bash
npm run dev
```

Open `http://localhost:5173`. Expected:
- Black background, "FAIZ" header
- Photos appear in justified rows — each row is the same height, images fill the full width with natural aspect ratios
- Photos fade in as you scroll down
- Clicking a photo does nothing yet (Lightbox not wired)
- Resize the window — layout reflows within ~100ms

- [ ] **Step 4: Commit**

```bash
git add src/components/Gallery.jsx src/App.jsx
git commit -m "feat: add justified gallery with scroll fade-in"
```

---

## Task 6: Lightbox Component

**Files:**
- Create: `src/components/Lightbox.jsx`

- [ ] **Step 1: Write `src/components/Lightbox.jsx`**

```jsx
import { useEffect, useRef, useState } from 'react';
import imageData from '../image-data';

export default function Lightbox({ currentIndex, onClose, onNavigate }) {
  const [arrowsVisible, setArrowsVisible] = useState(true);
  const [imgKey, setImgKey] = useState(0); // forces img re-animation on navigate
  const arrowTimer = useRef(null);
  const overlayRef = useRef(null);

  const image = imageData[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < imageData.length - 1;

  // Keyboard navigation
  useEffect(() => {
    const handleKey = e => {
      if (e.key === 'ArrowLeft' && hasPrev) onNavigate(currentIndex - 1);
      if (e.key === 'ArrowRight' && hasNext) onNavigate(currentIndex + 1);
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [currentIndex, hasPrev, hasNext, onClose, onNavigate]);

  // Arrow fade-out timer
  useEffect(() => {
    const resetTimer = () => {
      setArrowsVisible(true);
      clearTimeout(arrowTimer.current);
      arrowTimer.current = setTimeout(() => setArrowsVisible(false), 2000);
    };
    resetTimer();
    window.addEventListener('mousemove', resetTimer);
    return () => {
      window.removeEventListener('mousemove', resetTimer);
      clearTimeout(arrowTimer.current);
    };
  }, []);

  // Scroll lock
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Re-trigger image entrance animation on navigate
  useEffect(() => {
    setImgKey(k => k + 1);
  }, [currentIndex]);

  const navigate = index => {
    onNavigate(index);
  };

  return (
    <div
      className="lightbox-overlay"
      ref={overlayRef}
      onClick={onClose}
    >
      <img
        key={imgKey}
        className="lightbox-image"
        src={`/images/${image.src}`}
        alt=""
        onClick={e => e.stopPropagation()}
      />
      {hasPrev && (
        <button
          className={`lightbox-arrow lightbox-prev${arrowsVisible ? '' : ' hidden'}`}
          onClick={e => { e.stopPropagation(); navigate(currentIndex - 1); }}
          aria-label="Previous photo"
        >
          ‹
        </button>
      )}
      {hasNext && (
        <button
          className={`lightbox-arrow lightbox-next${arrowsVisible ? '' : ' hidden'}`}
          onClick={e => { e.stopPropagation(); navigate(currentIndex + 1); }}
          aria-label="Next photo"
        >
          ›
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire Lightbox into `src/App.jsx`**

```jsx
import { useState } from 'react';
import Gallery from './components/Gallery';
import Lightbox from './components/Lightbox';

export default function App() {
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const handleNavigate = index => {
    setLightboxIndex(index);
  };

  return (
    <>
      <header className="site-header">
        <span className="site-name">Faiz</span>
      </header>
      <Gallery onImageClick={setLightboxIndex} />
      {lightboxIndex !== null && (
        <Lightbox
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={handleNavigate}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: Verify in browser**

```bash
npm run dev
```

Open `http://localhost:5173`. Test:
1. Click any photo — lightbox opens with a black overlay and the image centered
2. Press `←` / `→` — navigates between photos
3. Press `Escape` — lightbox closes
4. Click outside the image — lightbox closes
5. Move mouse — arrows appear; stop moving — arrows fade out after 2s
6. On the first photo: no left arrow. On the last photo: no right arrow.

- [ ] **Step 4: Run tests to confirm nothing broke**

```bash
npm test
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Lightbox.jsx src/App.jsx
git commit -m "feat: add lightbox with keyboard navigation and fading arrows"
```

---

## Task 7: Final Polish & Build Verification

**Files:**
- Modify: `src/index.css` (verify `prefers-reduced-motion` block is correct)
- No new files

- [ ] **Step 1: Verify reduced-motion behaviour**

In your browser DevTools, go to **Rendering** tab and enable "Emulate CSS media feature prefers-reduced-motion". Reload `http://localhost:5173`.

Expected:
- Photos are already visible (no fade-in delay)
- Lightbox opens instantly (no scale animation)
- Hovering images produces no animation

Disable the emulation when done.

- [ ] **Step 2: Verify mobile layout**

In DevTools, set device to iPhone SE (375×667). Reload.

Expected:
- 2-column grid of photos, each 180px tall, cropped with `object-fit: cover`
- "FAIZ" header still visible
- Clicking a photo opens the lightbox (arrow keys still work)

- [ ] **Step 3: Run production build**

```bash
npm run build
```

Expected: no errors. Output in `dist/`.

- [ ] **Step 4: Preview production build**

```bash
npm run preview
```

Open `http://localhost:4173`. Verify the full gallery loads, justified layout appears, lightbox works. Stop preview server.

- [ ] **Step 5: Run tests one final time**

```bash
npm test
```

Expected: 7 tests pass, 0 failures.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete Faiz portfolio — justified gallery, lightbox, responsive"
```

---

## Self-Review Notes

**Spec coverage:**
- ✅ Vite + React SPA
- ✅ `public/images/` asset location
- ✅ `src/image-data.js` manifest (generated, not hardcoded)
- ✅ Justified layout algorithm (TDD, pure function)
- ✅ `#0A0A0A` background, `3px` gap
- ✅ Archivo Light font, uppercase name, `letter-spacing: 0.3em`
- ✅ Hover: `brightness(1.08)`, `0.3s ease`
- ✅ Scroll fade-in via IntersectionObserver
- ✅ Mobile: 2-column, 180px fixed height, `object-fit: cover`
- ✅ Lightbox: `←/→` keys, `Escape`, click-outside, fading arrows
- ✅ Body scroll lock while lightbox open
- ✅ `prefers-reduced-motion` handled in CSS
- ✅ Lightbox image entrance animation (scale + fade)

**No placeholders:** All steps contain complete code.

**Type consistency:** `imageData` (from `image-data.js`) shape is `{ src, aspectRatio }` throughout. `buildRows` output extends this with `{ width, height }`. Used consistently in Gallery and Lightbox.
