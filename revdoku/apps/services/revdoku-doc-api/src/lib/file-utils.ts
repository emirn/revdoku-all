import { EInputFileMimeType } from '@revdoku/lib';

export function getInputMimeTypeFromBase64Data(base64Data: string): EInputFileMimeType {
  
  const base64Truncated: string = base64Data.trim().slice(0, 100);
  console.debug(`base64Truncated: ${base64Truncated}`);
    // Basic MIME type detection from base64 prefix or file extension
  if (base64Truncated.startsWith('data:application/pdf')) {
    return EInputFileMimeType.PDF;  
  }

  // PDF signature: 25 50 44 46 (JVBERi in base64)
  if (base64Truncated.startsWith('JVBERi')) {
    return EInputFileMimeType.PDF;
  }
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A (iVBORw0KGgo in base64)
  if (base64Truncated.startsWith('data:image/png') || 
      base64Truncated.startsWith('iVBORw0KGgo')) { 
    return EInputFileMimeType.PNG;
  }

  // TIFF signature: 49 49 2A 00 (SUkqAA in base64) or 4D 4D 00 2A (TU0AKg in base64)
  if (base64Truncated.startsWith('data:image/tiff') || 
      base64Truncated.startsWith('SUkqAA') ||
      base64Truncated.startsWith('TU0AKg')) {
    return EInputFileMimeType.TIFF;
  }

  // GIF signature: 47 49 46 38 (R0lGOD in base64)
  if (base64Truncated.startsWith('data:image/gif') || 
      base64Truncated.startsWith('R0lGOD')) {
    return EInputFileMimeType.GIF;
  }

  // JPEG signature: FF D8 FF (/9j/ in base64)
  if (base64Truncated.startsWith('data:image/jpeg') || 
      base64Truncated.startsWith('/9j/')) {
    return EInputFileMimeType.JPEG;
  }

  // add check against TIF signature: 49 49 2A 00 (SUkqAA in base64) or 4D 4D 00 2A (TU0AKg in base64)
  if (base64Truncated.startsWith('SUkqAA') ||
      base64Truncated.startsWith('TU0AKg')) {
    return EInputFileMimeType.TIFF;
  }

  // WEBP signature: RIFF header (52 49 46 46) + WEBP at offset 8 (UklGR in base64)
  if (base64Truncated.startsWith('data:image/webp') || 
      base64Truncated.startsWith('UklGR')) {
    return EInputFileMimeType.WEBP;
  }
  
  // if we came here it means we don't know the file type
  // so we need to put error into the console with first 30 bytes of the base64 data
  console.error(`ERROR: Unknown file type for base64 data: ${base64Data.slice(0, 30)}`);
  return EInputFileMimeType.UNKNOWN;
}
