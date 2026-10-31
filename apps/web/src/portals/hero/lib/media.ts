import { uploadFile } from '@/lib/api';

/**
 * Downscales a camera photo to ≤ maxSide px (JPEG) before upload — phone photos are
 * 3–8 MB, which is painful on weak 4G. Falls back to the original file if decoding fails.
 */
export async function downscaleImage(file: File, maxSide = 1600, quality = 0.8): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bitmap = await loadBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap.source, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (!blob) return file;
    if (blob.size >= file.size && file.type === 'image/jpeg' && scale === 1) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}

async function loadBitmap(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const b = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: b, width: b.width, height: b.height, close: () => b.close() };
    } catch {
      /* fall through to <img> (old Safari, HEIC) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/** Downscale + upload; returns the stored file URL. */
export async function uploadPhoto(file: File, purpose: 'pod_photo' | 'attempt_photo' | 'handover_proof' | 'courier_document' | 'signature') {
  const small = await downscaleImage(file);
  const res = await uploadFile(small, purpose);
  return res.url;
}

/** Canvas → PNG File (signature pad). */
export function canvasToFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(new File([b], name, { type: 'image/png' })) : reject(new Error('canvas'))), 'image/png'),
  );
}
