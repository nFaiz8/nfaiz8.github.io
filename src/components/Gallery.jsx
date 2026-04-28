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
    if (!containerRef.current) return;
    if (window.innerWidth < MOBILE_BREAKPOINT) return;
    const width = containerRef.current.clientWidth;
    setRows(buildRows(imageData, width, TARGET_ROW_HEIGHT, GAP));
  }, []);

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

    const items = containerRef.current
      ? containerRef.current.querySelectorAll('.gallery-item')
      : [];
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
          <div key={row[0].src} className="gallery-row">
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
