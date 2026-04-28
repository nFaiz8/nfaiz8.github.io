import { useCallback, useEffect, useRef, useState } from 'react';
import imageData from '../image-data';

export default function Lightbox({ currentIndex, onClose, onNavigate }) {
  const [arrowsVisible, setArrowsVisible] = useState(true);
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

  const resetArrowTimer = useCallback(() => {
    setArrowsVisible(true);
    clearTimeout(arrowTimer.current);
    arrowTimer.current = setTimeout(() => setArrowsVisible(false), 2000);
  }, []);

  // Arrow fade-out timer — reset on mouse move
  useEffect(() => {
    resetArrowTimer();
    window.addEventListener('mousemove', resetArrowTimer);
    return () => {
      window.removeEventListener('mousemove', resetArrowTimer);
      clearTimeout(arrowTimer.current);
    };
  }, [resetArrowTimer]);

  // Reset arrow visibility on navigation
  useEffect(() => {
    resetArrowTimer();
  }, [currentIndex, resetArrowTimer]);

  // Body scroll lock
  useEffect(() => {
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.paddingRight = `${scrollbarWidth}px`;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.paddingRight = '';
      document.body.style.overflow = '';
    };
  }, []);

  // Focus the overlay on open
  useEffect(() => {
    overlayRef.current?.focus();
  }, []);

  return (
    <div
      className="lightbox-overlay"
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      onClick={onClose}
    >
      <img
        key={currentIndex}
        className="lightbox-image"
        src={`/images/${image.src}`}
        alt=""
        onClick={e => e.stopPropagation()}
      />
      {hasPrev && (
        <button
          className={`lightbox-arrow lightbox-prev${arrowsVisible ? '' : ' hidden'}`}
          onClick={e => { e.stopPropagation(); onNavigate(currentIndex - 1); }}
          aria-label="Previous photo"
        >
          ‹
        </button>
      )}
      {hasNext && (
        <button
          className={`lightbox-arrow lightbox-next${arrowsVisible ? '' : ' hidden'}`}
          onClick={e => { e.stopPropagation(); onNavigate(currentIndex + 1); }}
          aria-label="Next photo"
        >
          ›
        </button>
      )}
    </div>
  );
}
