import { useState, useCallback } from 'react';
import Gallery from './components/Gallery';
import Lightbox from './components/Lightbox';

export default function App() {
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const handleClose = useCallback(() => setLightboxIndex(null), []);
  const handleNavigate = useCallback(index => setLightboxIndex(index), []);

  return (
    <>
      <header className="site-header">
        <span className="site-name">Faiz</span>
      </header>
      <Gallery onImageClick={setLightboxIndex} />
      {lightboxIndex !== null && (
        <Lightbox
          currentIndex={lightboxIndex}
          onClose={handleClose}
          onNavigate={handleNavigate}
        />
      )}
    </>
  );
}
