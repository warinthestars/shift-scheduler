import api from '../api/client';

/**
 * Phase 32: file helpers (no extra packages).
 */

/** Shrinks a photo in the browser to at most `max` px on the long side and returns a JPEG File. */
export function resizeImage(file, max = 640, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('Please pick a photo (JPG, PNG or WebP).'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => (blob ? resolve(new File([blob], 'photo.jpg', { type: 'image/jpeg' })) : reject(new Error('Could not read that photo.'))),
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that photo.'));
    };
    img.src = url;
  });
}

/** POST a single file as multipart/form-data. */
export function uploadFile(path, file) {
  const form = new FormData();
  form.append('file', file);
  return api.post(path, form, { headers: { 'Content-Type': 'multipart/form-data' } });
}

/**
 * Opens a private file (certificate scan) in a new tab. The file needs the login token, so it's
 * fetched with axios and shown from a blob URL. The tab is opened first so pop-up blockers allow it.
 */
export async function openProtectedFile(fileId) {
  const win = window.open('', '_blank');
  try {
    const res = await api.get(`/files/${fileId}`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    if (win) win.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    if (win) win.close();
    throw err;
  }
}
