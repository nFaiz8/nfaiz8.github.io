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
    const imgs = [
      { src: 'a.jpg', aspectRatio: 0.75 },
      { src: 'b.jpg', aspectRatio: 0.75 },
      { src: 'c.jpg', aspectRatio: 0.75 },
    ];
    const rows = buildRows(imgs, 1000, 220, 3);
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
