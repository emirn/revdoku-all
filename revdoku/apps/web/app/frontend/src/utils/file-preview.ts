import { pdfjs } from 'react-pdf';

// NOTE: PDF.js worker is configured once in application.tsx using Vite's ?url import.
// Do NOT set GlobalWorkerOptions.workerSrc here — it would overwrite the correct URL
// with an import.meta.url resolution that breaks in production chunk splitting.

/**
 * Creates a thumbnail preview for an image file
 * @param file The image file to preview
 * @returns Promise resolving to base64 data URL of the thumbnail
 */
export const createImagePreview = (file: File | Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      // Set canvas size for thumbnail (max 600px on longest side)
      const maxSize = 600;
      let { width, height } = img;

      if (width > height) {
        if (width > maxSize) {
          height = (height * maxSize) / width;
          width = maxSize;
        }
      } else {
        if (height > maxSize) {
          width = (width * maxSize) / height;
          height = maxSize;
        }
      }

      canvas.width = width;
      canvas.height = height;

      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/webp', 0.8));
    };

    img.onerror = () => reject(new Error('Failed to load image'));

    const reader = new FileReader();
    reader.onload = (e) => {
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    
    if (file instanceof File) {
      reader.readAsDataURL(file);
    } else {
      // For Blob, we need to convert it first
      reader.readAsDataURL(file);
    }
  });
};

/**
 * Creates a thumbnail preview for a PDF file
 * @param file The PDF file to preview
 * @returns Promise resolving to base64 data URL of the thumbnail
 */
export const createPdfPreview = (file: File | Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const fileUrl = URL.createObjectURL(file);

    pdfjs
      .getDocument(fileUrl)
      .promise.then((pdf) => {
        pdf
          .getPage(1)
          .then((page) => {
            const viewport = page.getViewport({ scale: 0.5 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');

            canvas.height = viewport.height;
            canvas.width = viewport.width;

            const renderContext = {
              canvasContext: context!,
              viewport: viewport,
            };

            page
              .render(renderContext)
              .promise.then(() => {
                URL.revokeObjectURL(fileUrl);
                resolve(canvas.toDataURL('image/webp', 0.8));
              })
              .catch(reject);
          })
          .catch(reject);
      })
      .catch(reject);
  });
};

/**
 * Creates a preview from base64 data
 * @param base64Data The base64 encoded file data
 * @param mimeType The MIME type of the file
 * @returns Promise resolving to base64 data URL of the thumbnail
 */
export const createPreviewFromBase64 = async (
  base64Data: string, 
  mimeType: string
): Promise<string> => {
  // Convert base64 to blob
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });

  // Generate preview based on type
  if (mimeType.startsWith('image/')) {
    return createImagePreview(blob);
  } else if (mimeType === 'application/pdf') {
    return createPdfPreview(blob);
  } else {
    throw new Error(`Unsupported file type: ${mimeType}`);
  }
};

/**
 * Generates a preview for a file or base64 data
 * @param fileOrData Either a File object or base64 string
 * @param mimeType MIME type (required if fileOrData is base64)
 * @returns Promise resolving to base64 data URL of the thumbnail, or null if unsupported
 */
export const generatePreview = async (
  fileOrData: File | string,
  mimeType?: string
): Promise<string | null> => {
  try {
    if (typeof fileOrData === 'string') {
      // Base64 data
      if (!mimeType) {
        throw new Error('MIME type required for base64 data');
      }
      return await createPreviewFromBase64(fileOrData, mimeType);
    } else {
      // File object
      if (fileOrData.type.startsWith('image/')) {
        return await createImagePreview(fileOrData);
      } else if (fileOrData.type === 'application/pdf') {
        return await createPdfPreview(fileOrData);
      }
    }
  } catch (error) {
    console.error('Error generating preview:', error);
  }
  return null;
};