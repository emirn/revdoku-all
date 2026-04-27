import { PDFDocument, PDFPage, PageSizes } from 'pdf-lib';
import { IPageInfo, IDocumentFileRevision } from '@revdoku/lib';

interface IConvertedFileForDisplay {
  file: File;
  documentPagesToDisplayImageDimensions: IPageInfo[];
}

interface IConvertedBase64ForDisplay {
  base64: string;
  pdfBytes: Uint8Array;
  documentPagesToDisplayImageDimensions: IPageInfo[];
}

function getPdfPageDimensions(page: PDFPage): IPageInfo {
  return {
    width: page.getWidth(),
    height: page.getHeight(),
    original_width: page.getWidth(),
    original_height: page.getHeight(),
    scaling_factor: 1.0,
  };
}

function collectPdfPageDimensions(pdfDoc: PDFDocument): IPageInfo[] {
  const dimensions: IPageInfo[] = [];
  for (let i = 0; i < pdfDoc.getPageCount(); i++) {
    dimensions.push(getPdfPageDimensions(pdfDoc.getPage(i)));
  }
  return dimensions;
}

/**
 * Convert an array of image/pdf Files into a single merged PDF.
 * @param files Array of File objects (png, jpg, gif, or pdf)
 * @returns Promise resolving to an object with the merged PDF File and scaling ratios
 */
export async function convertInputFilesToPdfForDisplay(files: File[]): Promise<IConvertedFileForDisplay> {
  // Special case: if we only have one PDF file, just collect dimensions and return the original
  if (files.length === 1 && files[0].type === 'application/pdf') {
    const file = files[0];
    const buffer = await file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const documentPagesToDisplayImageDimensions = collectPdfPageDimensions(pdfDoc);

    return { file, documentPagesToDisplayImageDimensions };
  }

  // 1. Create a fresh PDF document
  const pdfDoc = await PDFDocument.create();
  const documentPagesToDisplayImageDimensions: IPageInfo[] = [];

  // 2. Process each file in order
  for (const file of files) {

    const buffer = await file.arrayBuffer();

    if (file.type === 'application/pdf') {
      // 2a. Merge existing PDF pages
      const donorPdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const copiedPages = await pdfDoc.copyPages(donorPdf, donorPdf.getPageIndices());
      copiedPages.forEach(page => {
        pdfDoc.addPage(page);
        documentPagesToDisplayImageDimensions.push(getPdfPageDimensions(page));
      });

    } else if (file.type.startsWith('image/')) {
      // 2b. Embed image
      let imageEmbed;
      let originalImageWidth: number;
      let originalImageHeight: number;

      if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
        imageEmbed = await pdfDoc.embedJpg(buffer);
        const dims = imageEmbed.scale(1);
        originalImageWidth = dims.width;
        originalImageHeight = dims.height;
      } else {
        // Convert PNG/GIF/other to PNG via canvas
        const imgEl = await loadImageFromBuffer(buffer);
        originalImageWidth = imgEl.width;
        originalImageHeight = imgEl.height;

        const canvas = document.createElement('canvas');
        canvas.width = imgEl.width;
        canvas.height = imgEl.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to get canvas context');
        ctx.drawImage(imgEl, 0, 0);
        const pngBytes = await new Promise<ArrayBuffer>((resolve, reject) => {
          canvas.toBlob(blob => {
            if (!blob) return reject(new Error('Failed to convert canvas to blob'));
            blob.arrayBuffer().then(resolve, reject);
          }, 'image/png');
        });
        imageEmbed = await pdfDoc.embedPng(pngBytes);
      }

      // add Letter page to pdf
      const page = pdfDoc.addPage(PageSizes.Letter);
      const { width: pdfWidth, height: pdfHeight } = page.getSize();
      page.drawImage(imageEmbed, { x: 0, y: 0, width: pdfWidth, height: pdfHeight });
      const scaling_factor = originalImageWidth / pdfWidth;
      const currentImageDimensions: IPageInfo = {
        width: pdfWidth,
        height: pdfHeight,
        original_width: originalImageWidth,
        original_height: originalImageHeight,
        scaling_factor: scaling_factor
      };
      documentPagesToDisplayImageDimensions.push(currentImageDimensions);


      console.debug(`Image to PDF scaling: ${file.name} - Original: ${originalImageWidth}x${originalImageHeight}, PDF: ${pdfWidth}x${pdfHeight}, ScalingFactor: ${scaling_factor}`);

    } else {
      console.debug(`Skipping unsupported file type: ${file.type}`);
    }
  }

  // 5. Save and wrap in a File
  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  const pdfFile = new File([pdfBytes], 'merged.pdf', { type: 'application/pdf' });

  return { file: pdfFile, documentPagesToDisplayImageDimensions };
}

/**
 * Helper: turn an ArrayBuffer into an HTMLImageElement
 */
async function loadImageFromBuffer(buffer: ArrayBuffer): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buffer]);
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = err => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

/**
 * Convert an array of source file revisions with base64 data into a single merged PDF.
 * How it works:
 * - If just one single PDF file, it is used as is.
 * - If input is multiple files (images and/or PDFs) then they are merged into one single PDF
 * Finally, we use this PDF for displaying in the doc viewer pdf in envelopes/view. 
 * @param fileRevisions Array of IDocumentFileRevision objects with base64 data
 * @returns Promise resolving to an object with the merged PDF as base64 and scaling ratios
 */
export async function convertFileRevisionsToBase64PdfForDisplay(
  fileRevisions: IDocumentFileRevision[]
): Promise<IConvertedBase64ForDisplay> {
  // Validate that all revisions have data
  const revisionsWithoutData = fileRevisions.filter(r => !r.data);
  if (revisionsWithoutData.length > 0) {
    throw new Error(`${revisionsWithoutData.length} file revision(s) are missing base64 data. Make sure the API includes data field.`);
  }
  // Special case: if we only have one PDF file, just collect dimensions and return it
  if (fileRevisions.length === 1 && fileRevisions[0].mime_type === 'application/pdf') {
    const revision = fileRevisions[0];
    // Strip data URI prefix if present
    const base64Data = revision.data;//.replace(/^data:.*?;base64,/, '');
    const buffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const documentPagesToDisplayImageDimensions = collectPdfPageDimensions(pdfDoc);

    return { base64: `data:application/pdf;base64,${revision.data}`, pdfBytes: buffer, documentPagesToDisplayImageDimensions };
  }

  // Create a fresh PDF document
  const pdfDoc = await PDFDocument.create();
  const documentPagesToDisplayImageDimensions: IPageInfo[] = [];

  // Process each file revision in order
  for (const revision of fileRevisions) {
    // Strip data URI prefix if present
    const base64Data = revision.data.replace(/^data:.*?;base64,/, '');
    const buffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

    if (revision.mime_type === 'application/pdf') {
      // Merge existing PDF pages
      const donorPdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const copiedPages = await pdfDoc.copyPages(donorPdf, donorPdf.getPageIndices());
      copiedPages.forEach((page) => {
        pdfDoc.addPage(page);
        documentPagesToDisplayImageDimensions.push(getPdfPageDimensions(page));
      });
    } else if (revision.mime_type.startsWith('image/')) {
      // Embed image
      let embeddedImage;
      if (revision.mime_type === 'image/jpeg' || revision.mime_type === 'image/jpg') {
        embeddedImage = await pdfDoc.embedJpg(buffer);
      } else if (revision.mime_type === 'image/png') {
        embeddedImage = await pdfDoc.embedPng(buffer);
      } else {
        // WebP, GIF, TIFF, etc. — convert to PNG via canvas
        const imgEl = await loadImageFromBuffer(buffer.buffer as ArrayBuffer);
        const canvas = document.createElement('canvas');
        canvas.width = imgEl.width;
        canvas.height = imgEl.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { console.debug(`Failed to get canvas context for ${revision.mime_type}`); continue; }
        ctx.drawImage(imgEl, 0, 0);
        const pngBytes = await new Promise<ArrayBuffer>((resolve, reject) => {
          canvas.toBlob(blob => {
            if (!blob) return reject(new Error('Failed to convert canvas to blob'));
            blob.arrayBuffer().then(resolve, reject);
          }, 'image/png');
        });
        embeddedImage = await pdfDoc.embedPng(pngBytes);
      }

      // Create a page sized to the image (no centering offset)
      const imageWidth = embeddedImage.width;
      const imageHeight = embeddedImage.height;
      const page = pdfDoc.addPage([imageWidth, imageHeight]);

      // Draw image at origin, full size
      page.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: imageWidth,
        height: imageHeight,
      });

      const currentImageDimensions: IPageInfo = {
        width: imageWidth,
        height: imageHeight,
        original_width: imageWidth,
        original_height: imageHeight,
        scaling_factor: 1.0
      };
      documentPagesToDisplayImageDimensions.push(currentImageDimensions);
    }
  }

  // Save the PDF as base64
  const pdfBytes = await pdfDoc.save();
  // Convert Uint8Array to base64 efficiently
  let binary = '';
  const chunkSize = 8192; // Process in chunks to avoid call stack issues
  for (let i = 0; i < pdfBytes.length; i += chunkSize) {
    const chunk = pdfBytes.slice(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  const base64 = btoa(binary);
  const base64WithPrefix = `data:application/pdf;base64,${base64}`;

  return { base64: base64WithPrefix, pdfBytes, documentPagesToDisplayImageDimensions };
}