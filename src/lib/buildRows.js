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
