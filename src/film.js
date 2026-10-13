// Is this photo a film scan? Pure, used by scripts/prepare-photos.mjs and the tests.
//  - the scanner writes its own name where a camera would go (Noritsu, Frontier, Epson, …)
//  - a lab scan with no metadata still has the lab's numeric file name (e.g. 000091570014.jpg)
//  - or the photo sits in a photos/film/ folder

const SCANNERS = /noritsu|frontier|pakon|epson|plustek|imacon|flextight|coolscan|nikon scan|canoscan|reflecta|pacific image|dimage scan|scanner/i;
const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

// rel: path inside photos/; make, model: from EXIF (may be missing).
export function filmInfo(rel, make, model) {
  const kit = `${make || ''} ${model || ''}`;
  if (SCANNERS.test(kit)) {
    const scanner = /noritsu/i.test(kit) ? 'Noritsu' : /frontier/i.test(kit) ? 'Frontier' : make ? titleCase(make.trim().split(/\s+/)[0]) : null;
    return { film: true, scanner };
  }
  if (/(^|[\\/])film[\\/]/i.test(rel)) return { film: true, scanner: null };
  const name = rel.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  if (!make && !model && /^\d{6,}$/.test(name)) return { film: true, scanner: null };
  return { film: false, scanner: null };
}
