export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

export async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function areFilesIdentical(fileA: File, fileB: File): Promise<boolean> {
  if (fileA.size !== fileB.size) return false;
  const [hashA, hashB] = await Promise.all([computeFileHash(fileA), computeFileHash(fileB)]);
  return hashA === hashB;
}

export function base64ToFile(base64: string, filename: string, mime_type: string): File {
  // Handle null or undefined base64 data
  if (!base64) {
    console.debug(`base64ToFile: Received null/undefined base64 for file ${filename}`);
    // Return an empty file to prevent crashes
    return new File([], filename, { type: mime_type });
  }
  
  // Remove data URI prefix if present (e.g., "data:image/jpeg;base64,")
  const base64Data = base64.replace(/^data:.*?;base64,/, '');
  
  const binary = atob(base64Data);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return new File([array], filename, { type: mime_type });
}
