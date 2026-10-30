import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform();

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Guarda un archivo generado por la app. En Android lo escribe en Documentos
 * y abre el menú para compartir; en el navegador lo descarga.
 */
export async function saveFile(blob: Blob, fileName: string, opts: { share?: boolean } = {}): Promise<string> {
  const safe = fileName.replace(/[\\/:*?"<>|]+/g, '_');
  if (isNative) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const data = await blobToBase64(blob);
    const res = await Filesystem.writeFile({ path: `StudyOS/${safe}`, data, directory: Directory.Documents, recursive: true });
    if (opts.share !== false) {
      try {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title: safe, url: res.uri, dialogTitle: 'Compartir archivo' });
      } catch {
        /* el usuario cerró el menú de compartir */
      }
    }
    return `Documentos/StudyOS/${safe}`;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safe;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return safe;
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
