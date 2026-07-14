/** Longest edge an embedded image is allowed to have, in pixels. */
const MAX_DIMENSION = 1600;

/** Files at or below this size are embedded as-is (no re-encode). */
const DIRECT_EMBED_LIMIT = 300 * 1024;

export interface ProcessedImage {
  /** Data URL suitable for an <img> src, embedded in the document bundle. */
  src: string;
  width: number;
  height: number;
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read image file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = src;
  });
}

/**
 * Convert an image file into a data URL for embedding in the document bundle.
 * Large images are downscaled and re-encoded so documents stay within
 * localStorage / sync payload budgets.
 */
export async function processImageFile(file: File): Promise<ProcessedImage> {
  const dataUrl = await readAsDataURL(file);
  const img = await loadImage(dataUrl);
  const width = img.naturalWidth;
  const height = img.naturalHeight;

  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height, 1));
  const keepOriginal =
    (scale === 1 && file.size <= DIRECT_EMBED_LIMIT) ||
    // Re-encoding a GIF through canvas would drop animation frames.
    file.type === 'image/gif';
  if (keepOriginal) {
    return { src: dataUrl, width, height };
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return { src: dataUrl, width, height };
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // PNG keeps transparency; everything else compresses better as JPEG.
  const wantsPng = file.type === 'image/png' || file.type === 'image/svg+xml';
  const src = wantsPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
  return { src, width: canvas.width, height: canvas.height };
}
