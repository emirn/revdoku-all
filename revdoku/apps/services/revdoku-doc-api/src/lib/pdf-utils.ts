import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PDFJS_PATHS = {
  cMapUrl: path.join(__dirname, '../../node_modules/pdfjs-dist/cmaps/'),
  standardFontDataUrl: path.join(__dirname, '../../node_modules/pdfjs-dist/standard_fonts/'),
  buildDir: path.resolve(__dirname, '../../node_modules/pdfjs-dist/build'),
  cmapsDir: path.resolve(__dirname, '../../node_modules/pdfjs-dist/cmaps'),
  standardFontsDir: path.resolve(__dirname, '../../node_modules/pdfjs-dist/standard_fonts'),
} as const;

import { createCanvas, Image } from 'canvas';

import { RenderParameters } from 'pdfjs-dist/types/src/display/api';
import jsPDF from 'jspdf';
import { checkImageHasContent } from './image-utils';
import os from 'os';
import puppeteer, { Browser } from 'puppeteer';
import { PDFToImage } from 'pdf-to-image-generator';
import { IEnvelopeRevisionToImageRenderingOptions } from '../schemas/common-server';
import { IPageInfo } from '@revdoku/lib';
import sharp from 'sharp';
import { RENDERED_PAGES_JPEG_QUALITY, RENDERED_PAGES_PDF_DEFAULT_DPI, RENDERED_PAGES_PDF_TO_PNG_OUTPUT_DPI, MIN_PDF_RENDER_DPI, CONVERT_TO_JPEG_BEFORE_SENDING_TO_AI } from './constants';

const PUPPETEER_TEMP_PREFIX = 'revdoku-doc-api-puppeteer-';

/**
 * Removes a temp directory with retry logic.
 * Puppeteer/Chrome may hold file locks briefly after browser.close(),
 * so a single rmSync can fail on busy filesystems.
 */
async function cleanupTempDir(dirPath: string, maxRetries = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt < maxRetries) {
        const delayMs = attempt * 200;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        console.warn(`Failed to clean up temp dir after ${maxRetries} attempts: ${dirPath}`, err);
      }
    }
  }
}

// Clean up orphaned Puppeteer temp dirs from previous process crashes (best-effort)
(async () => {
  try {
    const tmpBase = os.tmpdir();
    const orphaned = fs.readdirSync(tmpBase).filter(d => d.startsWith(PUPPETEER_TEMP_PREFIX));
    for (const dir of orphaned) {
      await cleanupTempDir(path.join(tmpBase, dir));
    }
    if (orphaned.length > 0) {
      console.debug('pdf-utils', `Cleaned up ${orphaned.length} orphaned Puppeteer temp dir(s)`);
    }
  } catch (err) { console.debug('pdf-utils', 'Error during orphaned temp dir cleanup (best-effort):', err); }
})();

export async function convertHtmlToPdf(html: string, fileName: string): Promise<string> {
  // Create properly formatted HTML document with meta tags and styling
  const formattedHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Review Report</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background: white;
            color: #333;
            line-height: 1.4;
        }
        .container {
            max-width: 100%;
            margin: 0 auto;
        }
        img {
            max-width: 100%;
            height: auto;
            page-break-inside: avoid;
        }
        table {
            border-collapse: collapse;
            width: 100%;
        }
        .page-break {
            page-break-before: always;
        }
        @media print {
            body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
    </style>
</head>
<body>
    <div class="container">
        ${html}
    </div>
</body>
</html>`;

  let browser: Browser | null = null;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), PUPPETEER_TEMP_PREFIX));
  fs.chmodSync(userDataDir, 0o700);

  try {
    console.debug('input', `Converting HTML to PDF using Puppeteer for file: ${fileName}`);
    console.debug('input', `HTML length: ${formattedHtml.length} characters`);

    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: true,
      userDataDir,
    });
    const page = await browser.newPage();
    await page.setContent(formattedHtml, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: {
        top: '0.75in',
        right: '0.75in',
        bottom: '0.75in',
        left: '0.75in',
      },
      displayHeaderFooter: false,
      preferCSSPageSize: true,
    });

    console.debug('input', `Raw PDF buffer type: ${typeof pdfBuffer}, constructor: ${pdfBuffer.constructor.name}`);
    console.debug('input', `Raw PDF buffer length: ${pdfBuffer.length}`);
    console.debug('input', `First 20 bytes as string: ${pdfBuffer.toString().substring(0, 50)}`);

    // Ensure we have a proper Buffer object
    let properBuffer: Buffer;
    if (Buffer.isBuffer(pdfBuffer)) {
      properBuffer = pdfBuffer;
    } else if (pdfBuffer instanceof Uint8Array) {
      properBuffer = Buffer.from(pdfBuffer);
    } else if (typeof pdfBuffer === 'string') {
      // If it's a comma-separated string of bytes, parse it
      if ((pdfBuffer as string).includes(',')) {
        const byteArray = (pdfBuffer as string).split(',').map((s: string) => parseInt(s.trim(), 10));
        properBuffer = Buffer.from(byteArray);
      } else {
        // If it's a regular string, convert to buffer
        properBuffer = Buffer.from(pdfBuffer as string, 'binary');
      }
    } else {
      // Try to convert whatever it is to Buffer
      properBuffer = Buffer.from(pdfBuffer as any);
    }

    console.debug('input', `Proper buffer type: ${typeof properBuffer}, constructor: ${properBuffer.constructor.name}`);
    console.debug('input', `Proper buffer length: ${properBuffer.length}`);

    if (!properBuffer || properBuffer.length === 0) {
      throw new Error('PDF generation resulted in zero bytes output. This may indicate a Puppeteer configuration issue or invalid HTML content.');
    }

    if (properBuffer.length < 100) {
      throw new Error(`PDF generation resulted in suspiciously small output (${properBuffer.length} bytes). This may indicate a corrupted or incomplete PDF.`);
    }

    // Check PDF header
    const pdfHeader = properBuffer.slice(0, 5).toString('ascii');
    console.debug('input', `PDF header: ${pdfHeader}`);
    if (!pdfHeader.startsWith('%PDF-')) {
      throw new Error(`Generated output does not appear to be a valid PDF (header: ${pdfHeader}). This indicates a Puppeteer processing error.`);
    }

    const base64String = properBuffer.toString('base64');
    console.debug('input', `PDF conversion completed successfully, size: ${properBuffer.length} bytes, base64 length: ${base64String.length} characters`);
    return base64String;
  } catch (error) {
    console.debug('errors', `Error in convertHtmlToPdf (Puppeteer): ${error}`);
    throw error;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.debug('errors', `Error closing Puppeteer browser: ${closeError}`);
      }
    }
    await cleanupTempDir(userDataDir);
  }
}

/*
export async function getPdfLoadingOptions(pdfData: Uint8Array): Promise<any> {

  const pdfRenderingOptions: any = {
      // base options for all pdf producers
      cMapUrl: '/node_modules/pdfjs-dist/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/node_modules/pdfjs-dist/standard_fonts/'
  };

  // try to get the pdf producer
  try {

     // make a copy of pdf data input to avoid detaching the buffer
    const tempData = new Uint8Array(pdfData);

    try {
      // Create a temporary loading task with minimal options
      // This avoids fully loading the document twice
      const loadingTask = pdfjsLib.getDocument({ data: tempData });
      const pdfDoc = await loadingTask.promise;
      const metadata = await pdfDoc.getMetadata();
      // Access the Producer property using type assertion
      const producer = metadata?.info ? (metadata.info as any).Producer : undefined;
      const isPyFPDF = producer?.includes('PyFPDF') || false;
      
      // Properly clean up the document to avoid memory leaks
      await pdfDoc.destroy();
      
      console.debug('input', `PDF producer check: ${isPyFPDF ? 'PyFPDF detected' : 'Standard PDF'}`);
      
      // adjust settings based on the pdf producer
      if(isPyFPDF) {
        // specific options for PyFPDF
        // we need to disable font face to avoid issues with fonts not being rendered in PyFPDF
        pdfRenderingOptions.disableFontFace = false;
      }
      else {
        // do nothing yet, use default options
      }

    } catch (metadataError) {
      // If we can't extract metadata, log it but continue with default options
      console.debug('errors', `Error extracting PDF metadata: ${metadataError}`);
    }
    

  } catch (error) {
    console.debug('errors', `Error checking PDF producer: ${error}`);
    // In case of any error, return default options
  }

  // finally return options for PDF rendering
  return pdfRenderingOptions;
  
}
*/


// input stirng contains date from PDF like this 'D:20250607103651Z'
function formatPdfDate(dateString: string): string {
  // PDF date format: D:YYYYMMDDHHmmSSZ (e.g., D:20250607103651Z)
  const match = /^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(dateString);
  if (!match) {
    // fallback to default parsing if format is unexpected
    const fallbackDate = new Date(dateString);
    return fallbackDate.toLocaleString('en-US', { timeZone: 'UTC' });
  }
  const [, year, month, day, hour, minute] = match;
  // Create a Date object in UTC
  const date = new Date(Date.UTC(
    parseInt(year, 10),
    parseInt(month, 10) - 1,
    parseInt(day, 10),
    parseInt(hour, 10),
    parseInt(minute, 10)
  ));
  // Format: YEAR MONTH-full-name DAY hour:minute UTC
  const monthName = date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const dayNum = date.getUTCDate();
  const yearNum = date.getUTCFullYear();
  const hourStr = String(date.getUTCHours()).padStart(2, '0');
  const minuteStr = String(date.getUTCMinutes()).padStart(2, '0');
  return `${yearNum} ${monthName} ${dayNum} ${hourStr}:${minuteStr} UTC`;
}


export interface IPDFToImageResult {
  images: string[];
  metadata: string;
  page_dimensions: IPageInfo[];
  rendering_method: RenderingMode;
  totalPageCount: number;  // total pages in the PDF (even when only a subset was rendered)
}

/*
export async function OLD_convertPdfToImages(
    fileName: string,
    pdfData: Uint8Array, 
    options: IPDFToImageOptions
  ): Promise<IPDFToImageResult> {

    if (!fileName || !pdfData) {
        throw new Error('fileName and pdfData are required');
    }

    try {
      const result: Uint8Array[] = [];
      const imageDimensions: IImageDimensions[] = [];
      
      // Make a copy of the buffer to avoid detached buffer issues
      // Convert Buffer to ArrayBuffer for pdf.js
      const arrayBuffer = new ArrayBuffer(pdfData.length);
      const uint8 = new Uint8Array(arrayBuffer);
      for (let i = 0; i < pdfData.length; i++) {
        uint8[i] = pdfData[i];
      }
  
      // Load the PDF document with producer-specific options
      console.debug('input', `Loading PDF document from copy, data size: ${uint8.length} bytes`);
      

      // Get proper loading options based on PDF producer
      const loadingOptions = await getPdfLoadingOptions(uint8);
      
      // setting data for pdf document loading 
      loadingOptions.data = uint8;

      const loadingTask = pdfjsLib.getDocument(loadingOptions);
      const pdfDocument = await loadingTask.promise;
      
      console.debug('input', `PDF document loaded with ${pdfDocument.numPages} pages`);

      // Retrieve PDF metadata using getMetadata()
      let info: any = {};
      try {
        if (typeof pdfDocument.getMetadata === 'function') {
          const metadata = await pdfDocument.getMetadata();
          info = metadata.info || {};
        }
      } catch (err) {
        console.debug('input', `Failed to get PDF metadata: ${err}`);
        info = {};
      }

      // Compose metadata string, falling back to fileName or empty string as needed
      const metadata = `Source Document Type: PDF
Source PDF Document Number of Pages: ${pdfDocument.numPages}
Source PDF Document Title: ${info.Title ? info.Title : fileName}
Source PDF Document Author: ${info.Author ? info.Author : ''}
Source PDF Document Producer: ${info.Producer ? info.Producer : ''}
Source PDF Document Creation Date: ${info.CreationDate ? formatPdfDate(info.CreationDate) : ''}
Source PDF Document Modification Date: ${info.ModDate ? formatPdfDate(info.ModDate) : ''}
Source PDF Document Subject: ${info.Subject ? info.Subject : ''}
Source PDF Document Keywords: ${info.Keywords ? info.Keywords : ''}
Source PDF Document Creator: ${info.Creator ? info.Creator : ''}
Source PDF Document Producer: ${info.Producer ? info.Producer : ''}
Source PDF Document Size (bytes): ${pdfData.length}`;
      
      // Process each page
      for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
        console.debug('input', `pdf to image: Processing page ${pageNum}`);
        
        // Get the page
        const page = await pdfDocument.getPage(pageNum);
        
        // Calculate scale based on options
        let viewport = page.getViewport({ scale: 1.0 });
        const scale = options.maxSideLength / (viewport.width > viewport.height ? viewport.width : viewport.height);
                
        console.debug('input', `Original pdf page size: ${viewport.width}x${viewport.height}`);
        
        // Calculate appropriate scale if maintainAspectRatio is true

        const scaledWidth = scale * viewport.width;
        const scaledHeight = scale * viewport.height;
        console.debug('input', `Scaled pdf page size: ${scaledWidth}x${scaledHeight}, unscaled: ${viewport.width}x${viewport.height}`);
  
        // saving scaled dimensions for the current page
        imageDimensions.push({
          width: scaledWidth,
          height: scaledHeight,
          original_width: viewport.width,
          original_height: viewport.height,
          scaling_factor: scale
        });
        
        // Apply the final scale
        viewport = page.getViewport({ scale });
        console.debug('input', `Scaled pdf page size: ${viewport.width}x${viewport.height}`);
        
        // Create a canvas of the desired dimensions
        const canvas = createCanvas(viewport.width, viewport.height);
        const context = canvas.getContext('2d');
        
        console.debug('input', `Created canvas with dimensions: ${viewport.width}x${viewport.height}`);
        
        // Render the page on the canvas
        const renderContext: RenderParameters = {
          canvasContext: context as any,
          viewport: viewport,
        };
        
        console.debug('input', `Starting PDF page #${pageNum} rendering...`);
        try{
          await page.render(renderContext).promise;
        }
        catch(error) {
          const errorMsg = `Error rendering PDF to image page #${pageNum}: ${error}`;
          console.debug('errors', errorMsg);
          throw new Error(errorMsg);
        }
        
        console.debug('input', `PDF page #${pageNum} rendering complete`);
        
        // Convert the canvas to PNG data and copy to a new array
        console.debug('input', 'Converting canvas to PNG...');
        const pngData = canvas.toBuffer('image/png');
        
        // Copy to a new Uint8Array to avoid any detached buffer issues
        let imageData = new Uint8Array(pngData.length);
        for (let i = 0; i < pngData.length; i++) {
          imageData[i] = pngData[i];
        }

        // pusing image rendered from pdf to the result array
        result.push(imageData);
                
        console.debug('input', `Page ${pageNum} rendered, PNG size: ${pngData.byteLength} bytes`);
        
  
      // TEMP FOR TESTING ONLY - BEGIN
      if (DEBUG_PDF_TO_IMAGE_CONVERSION) {
        try {
          // Create a directory for input images if it doesn't exist
          const inputDir = path.join(PDF_TO_IMAGE_DEBUG_FOLDER, fileName, new Date().toISOString().replace(/:/g, '-'));  
          if (!fs.existsSync(inputDir)) {
            fs.mkdirSync(inputDir, { recursive: true });
          }
  
          // Save original pdf to the local file system
          const pdfPath = path.join(inputDir, fileName);
          console.debug('input', `Writing PDF file to: ${pdfPath}`);
          console.debug('input', `fileBuffer type: ${typeof pdfData}, length: ${pdfData.length}, is array: ${Array.isArray(pdfData)}, isBuffer: ${Buffer.isBuffer(pdfData)}`);
          
          // Write using the dedicated file buffer that wasn't used for other operations
          try {
            console.debug('input', "Writing PDF with dedicated file buffer");
            fs.writeFileSync(pdfPath, pdfData as unknown as Uint8Array);
            const stat = fs.statSync(pdfPath);
            console.debug('input', `File written successfully - size: ${stat.size} bytes`);
          } catch (writeError) {
            const errorMsg = `Error writing PDF file: ${writeError}`;
            console.error('errors', errorMsg);
          }
          
          // Save each image to the local file system
          for(let index = 0; index < result.length; index++) {
            const imagePath = path.join(inputDir, `${fileName}-page-${index}.png`);
            
            try {
              // Write the image data directly since it's already a Uint8Array
              fs.writeFileSync(imagePath, result[index]);
              
              const imgStat = fs.statSync(imagePath);
              console.debug('input', `Saved image ${index} file size: ${imgStat.size} bytes`);
            } catch (imgError) {
              const errorMsg = `Error saving image ${index}: ${imgError}`;
              console.debug('errors', errorMsg);
            }
            
          };
          
          console.debug('input', `PDF and images saved to ${inputDir}`);
        } catch (saveError) {
          const errorMsg = 'Error saving files for testing: ' + saveError;
          console.error('errors', errorMsg);
          throw errorMsg;
          // Continue processing even if saving fails
        }
  
      }
      // TEMP FOR TESTING ONLY - END          
        // Verify the image has actual content
        const hasContent = await checkImageHasContent(pngData.toString('base64'));
        console.debug('input', `Image content check: Has visible content: ${hasContent}`);
        
        if (!hasContent) {
          console.debug('input', 'Warning: Generated image appears to have no visible content!');
        }
      }
            
      return {
        images: result,
        metadata: metadata,
        imageDimensions: imageDimensions,
      };

  } catch (error) {
      const errorMsg = 'Error converting PDF to images: ' + error;
      console.error('errors', errorMsg);
      throw error;
  }
}
*/


type RenderingMode = 'pdfjs-canvas' | 'puppeteer';

interface IPdfProducerInfo {
  producer: string;
  creator: string;
  renderingMode: RenderingMode;
  disableFontFace: boolean;
}

/**
 * Determines rendering settings from PDF producer/creator metadata.
 * Pure function — no I/O, no PDF loading.
 *
 * To add a new producer case: add a detection branch here,
 * then add a test fixture entry in tests/pdf-rendering.test.ts.
 */
function getProducerConfig(producer: string, creator: string): Omit<IPdfProducerInfo, 'producer' | 'creator'> {
  // Quartz PDFContext PDFs need Puppeteer fallback — pdfjs + node-canvas
  // cannot render their reprocessed fonts correctly.
  if (producer.includes('Quartz PDFContext')) {
    return { renderingMode: 'puppeteer', disableFontFace: true };
  }

  // Default: pdfjs + node-canvas with path-based rendering.
  // With useSystemFonts: false, this works correctly for PyFPDF, Qt,
  // WeasyPrint, and most PDFs with standard or embedded fonts.
  return { renderingMode: 'pdfjs-canvas', disableFontFace: true };
}

/**
 * Checks whether a PDF contains subset-embedded fonts that may not render
 * correctly with pdfjs + node-canvas.
 *
 * Subset-embedded fonts use the naming convention "XXXXXX+FontName"
 * (6 uppercase letters + plus sign). In Node.js, pdfjs cannot use the
 * Font Loading API (document.fonts), so subset TrueType/OpenType fonts
 * often render with missing glyphs. Puppeteer (headless Chrome) handles
 * these correctly via its full browser font APIs.
 *
 * Scans the first few pages' operator lists for setFont references
 * and checks their names against the subset pattern.
 */
async function hasSubsetEmbeddedFonts(pdfDoc: any): Promise<boolean> {
  const SUBSET_FONT_PREFIX = /^[A-Z]{6}\+/;
  const pagesToCheck = Math.min(pdfDoc.numPages, 3);

  for (let i = 1; i <= pagesToCheck; i++) {
    const page = await pdfDoc.getPage(i);
    const opList = await page.getOperatorList();

    for (let j = 0; j < opList.fnArray.length; j++) {
      // OPS.setFont = 1
      if (opList.fnArray[j] === 1) {
        const fontRef = opList.argsArray[j]?.[0];
        if (fontRef && page.commonObjs.has(fontRef)) {
          const font = page.commonObjs.get(fontRef);
          const fontName = font?.name || '';
          if (SUBSET_FONT_PREFIX.test(fontName)) {
            console.debug('convertPdfToImages', `Detected subset-embedded font: ${fontName} (page ${i})`);
            return true;
          }
        }
      }
    }
  }

  return false;
}

/**
 * Detects PDFs with non-embedded fonts that pdfjs + node-canvas cannot render.
 *
 * When a PDF references fonts without embedding them, pdfjs creates font
 * objects with `data == null` (no font file data). In Node.js without the
 * Font Loading API (`document.fonts`), these fonts render as blank/missing
 * glyphs because node-canvas cannot load them.
 *
 * The 14 standard PDF base fonts (Times, Helvetica, Courier, Symbol,
 * ZapfDingbats) are whitelisted because pdfjs can render them via
 * `standardFontDataUrl` even without embedding.
 *
 * Note: pdfjs does NOT set `missingFile = true` for all non-embedded fonts
 * (e.g. ArialMT referenced but not embedded). Instead we check for
 * `data == null` which reliably indicates no font file is available.
 */
async function hasNonEmbeddedFonts(pdfDoc: any): Promise<boolean> {
  const STANDARD_FONT_PREFIXES = ['Times', 'Helvetica', 'Courier', 'Symbol', 'ZapfDingbats'];
  const pagesToCheck = Math.min(pdfDoc.numPages, 3);

  for (let i = 1; i <= pagesToCheck; i++) {
    const page = await pdfDoc.getPage(i);
    const opList = await page.getOperatorList();

    for (let j = 0; j < opList.fnArray.length; j++) {
      // OPS.setFont = 1
      if (opList.fnArray[j] === 1) {
        const fontRef = opList.argsArray[j]?.[0];
        if (fontRef && page.commonObjs.has(fontRef)) {
          const font = page.commonObjs.get(fontRef);
          if (font && font.data == null) {
            const fontName = font.name || '';
            const isStandard = STANDARD_FONT_PREFIXES.some(prefix => fontName.startsWith(prefix));
            if (!isStandard) {
              console.debug('convertPdfToImages', `Detected non-embedded font: ${fontName} (page ${i})`);
              return true;
            }
          }
        }
      }
    }
  }

  return false;
}

/**
 * Builds a metadata string from PDF document info.
 */
function buildMetadataString(info: any, numPages: number, fileName: string, sizeBytes: number): string {
  return `Source Document Type: PDF
    Source PDF Document Number of Pages: ${numPages}
    Source PDF Document Title: ${info.Title ? info.Title : fileName}
    Source PDF Document Author: ${info.Author ? info.Author : ''}
    Source PDF Document Producer: ${info.Producer ? info.Producer : ''}
    Source PDF Document Creation Date: ${info.CreationDate ? formatPdfDate(info.CreationDate) : ''}
    Source PDF Document Modification Date: ${info.ModDate ? formatPdfDate(info.ModDate) : ''}
    Source PDF Document Subject: ${info.Subject ? info.Subject : ''}
    Source PDF Document Keywords: ${info.Keywords ? info.Keywords : ''}
    Source PDF Document Creator: ${info.Creator ? info.Creator : ''}
    Source PDF Document Producer: ${info.Producer ? info.Producer : ''}
    Source PDF Document Size (bytes): ${sizeBytes}`;
}

/**
 * Calculates page dimensions and scaling factors for pages in a PDF document.
 *
 * When `pageNumbers` is provided (batched mode), only those pages are measured
 * — we load just the requested pages via `pdfDoc.getPage(i)` and compute their
 * viewports. This cuts batched-run overhead from O(total_pages) per batch down
 * to O(batch_size) per batch. For a 150-page document reviewed in 75 two-page
 * batches, that's ~150 getPage calls across the whole run instead of 11,250.
 *
 * The returned `page_dimensions` array is sized to the full document
 * (`pdfDoc.numPages`) so downstream code can index directly by 1-based page
 * number (`page_dimensions[pn - 1]`). Entries for pages not in `pageNumbers`
 * are left as `undefined`, and `effectiveDims = pageNumbers.map(...)` in the
 * renderers filters them out.
 *
 * When `pageNumbers` is not provided (whole-document mode), behaviour is
 * unchanged: every page is measured and `maxScalingFactor` is the largest
 * across the full document.
 */
async function calculatePageDimensions(
  pdfDoc: any,
  options: IEnvelopeRevisionToImageRenderingOptions,
  pageNumbers?: number[]
): Promise<{ page_dimensions: IPageInfo[]; maxScalingFactor: number; renderScale: number }> {
  const totalPages = pdfDoc.numPages;
  const pagesToMeasure = pageNumbers && pageNumbers.length > 0 ? pageNumbers : Array.from({ length: totalPages }, (_, i) => i + 1);
  // Allocate full-size sparse array so downstream code can index by (pn - 1)
  // without having to translate absolute page numbers into dense indices.
  const page_dimensions: IPageInfo[] = new Array(totalPages);

  console.debug('convertPdfToImages', `calculatePageDimensions: measuring ${pagesToMeasure.length} page(s) out of ${totalPages}${pageNumbers ? ` (batched mode, pages ${pagesToMeasure[0]}-${pagesToMeasure[pagesToMeasure.length - 1]})` : ' (whole document)'}`);

  for (const pageNum of pagesToMeasure) {
    const pageObj = await pdfDoc.getPage(pageNum);
    const viewport = pageObj.getViewport({ scale: 1.0 });

    let scaling_factor: number;
    if (Math.max(viewport.width, viewport.height) > options.maxSideSize) {
      scaling_factor = options.maxSideSize / Math.max(viewport.width, viewport.height);
    } else if (Math.min(viewport.width, viewport.height) < options.minSideSize) {
      scaling_factor = options.minSideSize / Math.min(viewport.width, viewport.height);
    } else {
      scaling_factor = 1.0;
    }

    page_dimensions[pageNum - 1] = {
      width: -1,
      height: -1,
      original_width: viewport.width,
      original_height: viewport.height,
      scaling_factor: scaling_factor,
    };
  }

  // Compute maxScalingFactor over only the measured pages, then apply it to
  // those same pages (so pages within this batch render at a uniform scale).
  const measured = pagesToMeasure.map(pn => page_dimensions[pn - 1]);
  const maxScalingFactor = Math.max(...measured.map(p => p.scaling_factor));
  measured.forEach(p => { p.scaling_factor = maxScalingFactor; });

  // Render at higher DPI than target for sharper output, then downscale.
  // PDF viewport at scale 1.0 = 72 DPI. If target scale produces < MIN_PDF_RENDER_DPI,
  // render at the minimum DPI and downscale to target dimensions afterwards.
  const renderScale = Math.max(maxScalingFactor, MIN_PDF_RENDER_DPI / RENDERED_PAGES_PDF_DEFAULT_DPI);

  const effectiveDpi = Math.round(renderScale * RENDERED_PAGES_PDF_DEFAULT_DPI);
  console.debug('convertPdfToImages', `calculatePageDimensions: measured=${measured.length}, maxScalingFactor=${maxScalingFactor.toFixed(4)}, renderScale=${renderScale.toFixed(3)} (${effectiveDpi} DPI)`);

  return { page_dimensions, maxScalingFactor, renderScale };
}

/**
 * Renders PDF pages to images using pdfjs + node-canvas via pdf-to-image-generator.
 * This is the default rendering path for most PDFs.
 *
 * Renders at `renderScale` (which may be higher than `maxScalingFactor` for sharper output),
 * then downscales to target dimensions using sharp.
 */
async function renderWithPdfjsCanvas(
  pdfToImage: InstanceType<typeof PDFToImage>,
  pdfDoc: any,
  pageDimensions: IPageInfo[],
  maxScalingFactor: number,
  renderScale: number,
  metadata: string,
  pageNumbers?: number[]  // 1-indexed page numbers to render (undefined = all)
): Promise<IPDFToImageResult> {
  try {
    const needsDownscale = renderScale > maxScalingFactor;
    const renderLabel = pageNumbers ? `pages ${pageNumbers[0]}-${pageNumbers[pageNumbers.length - 1]}` : 'all pages';
    console.debug('convertPdfToImages', `Starting PDF to images conversion (${renderLabel}): renderScale=${renderScale.toFixed(3)}, targetScale=${maxScalingFactor.toFixed(3)}, downscale=${needsDownscale}`);
    const pages = await pdfToImage.convert({
      viewportScale: renderScale,
      type: 'png',
      includeBufferContent: true,
      ...(pageNumbers ? { pages: pageNumbers } : {}),
    });

    console.debug('convertPdfToImages', `PDF to images conversion complete. Got ${pages.length} images.`);

    // When rendering a subset, filter pageDimensions to match
    const effectiveDims = pageNumbers
      ? pageNumbers.map(pn => pageDimensions[pn - 1]).filter(Boolean)
      : pageDimensions;

    const outputImages: string[] = [];

    for (let i: number = 0; i < effectiveDims.length; i++) {
      const pageLabel = pageNumbers ? pageNumbers[i] : i + 1;
      console.debug('convertPdfToImages', `Processing page ${pageLabel} (${i + 1} of ${effectiveDims.length})`);
      const page = pages[i];
      const pageDim = effectiveDims[i];
      if (!page.content) {
        console.error('convertPdfToImages', `Page ${i + 1} content is empty and was not converted`);
        throw new Error('Page content is empty and was not converted');
      }

      const rawBuffer = new Uint8Array(page.content);

      // Downscale from high-DPI render to target dimensions if needed
      let imageForOutput: Buffer;
      if (needsDownscale) {
        const targetWidth = Math.round(pageDim.original_width * maxScalingFactor);
        const targetHeight = Math.round(pageDim.original_height * maxScalingFactor);
        imageForOutput = await sharp(rawBuffer, { density: RENDERED_PAGES_PDF_DEFAULT_DPI })
          .resize(targetWidth, targetHeight, { fit: 'inside' })
          .toBuffer();
        console.debug('convertPdfToImages', `Page ${i + 1}: downscaled from ${Math.round(renderScale * RENDERED_PAGES_PDF_DEFAULT_DPI)} DPI to ${targetWidth}x${targetHeight}`);
      } else {
        imageForOutput = Buffer.from(rawBuffer);
      }

      const renderedImage = sharp(imageForOutput, { density: RENDERED_PAGES_PDF_DEFAULT_DPI });
      const sharpMeta = await renderedImage.metadata();
      pageDim.width = sharpMeta.width || 0;
      pageDim.height = sharpMeta.height || 0;
      console.debug('convertPdfToImages', `Page ${i + 1} final dimensions: ${pageDim.width}x${pageDim.height}`);

      const finalImageBuffer = CONVERT_TO_JPEG_BEFORE_SENDING_TO_AI
        ? await renderedImage.jpeg({ quality: RENDERED_PAGES_JPEG_QUALITY }).toBuffer()
        : await renderedImage.png().toBuffer();
      outputImages.push(finalImageBuffer.toString('base64'));
      console.debug('convertPdfToImages', `Page ${i + 1} rendered, ${CONVERT_TO_JPEG_BEFORE_SENDING_TO_AI ? 'JPEG' : 'PNG'} size: ${finalImageBuffer.byteLength} bytes`);
    }

    console.debug('convertPdfToImages', `PDF to images conversion complete. Got ${outputImages.length} images.`);

    return { images: outputImages, metadata, page_dimensions: effectiveDims, rendering_method: 'pdfjs-canvas', totalPageCount: pageDimensions.length };
  } finally {
    // No-op in memory-only mode (no outputFolderName passed), kept as safety net
    await pdfToImage.removeGeneratedImagesOnDisk();
  }
}

/**
 * Renders PDF pages to images using Puppeteer (headless Chrome).
 * Used as a fallback for PDFs that don't render correctly with pdfjs + node-canvas
 * (e.g. macOS Quartz PDFContext PDFs with reprocessed fonts).
 *
 * Chrome has full font APIs, system font access, and Skia text rendering,
 * producing the same quality as pdfjs in a browser.
 */
async function convertPdfToImagesWithPuppeteer(
  fileName: string,
  pdfData: Uint8Array,
  metadata: string,
  pageDimensions: IPageInfo[],
  maxScalingFactor: number,
  renderScale: number,
  pageNumbers?: number[]  // 1-indexed page numbers to render (undefined = all)
): Promise<IPDFToImageResult> {
  let browser: Browser | null = null;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), PUPPETEER_TEMP_PREFIX));
  fs.chmodSync(tempDir, 0o700);

  try {
    const needsDownscale = renderScale > maxScalingFactor;

    // Build per-page scale array — render at high DPI for quality
    // When rendering a subset, filter dimensions to match
    const effectiveDims = pageNumbers
      ? pageNumbers.map(pn => pageDimensions[pn - 1]).filter(Boolean)
      : pageDimensions;
    // Log AFTER computing effectiveDims so the message reflects the real render count
    // (was previously logging pageDimensions.length which is always the full PDF size).
    console.debug('convertPdfToImages', `Puppeteer fallback: rendering ${fileName} (${effectiveDims.length} of ${pageDimensions.length} pages, renderScale=${renderScale.toFixed(3)}, targetScale=${maxScalingFactor.toFixed(3)})`);
    const scales = effectiveDims.map(() => renderScale);
    // 0-indexed page indices for Puppeteer JS (convert from 1-based pageNumbers)
    const pageIndices = pageNumbers ? pageNumbers.map(pn => pn - 1) : null;

    // Resolve pdfjs paths for file:// URLs in the HTML
    const { buildDir: pdfjsBuildDir, cmapsDir, standardFontsDir } = PDFJS_PATHS;

    // Encode PDF as base64 to embed in HTML
    const pdfBase64 = Buffer.from(pdfData).toString('base64');

    // Build self-contained HTML that loads pdfjs and renders all pages
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>body{margin:0;background:white}</style></head>
<body>
<script type="module">
  import * as pdfjsLib from 'file://${pdfjsBuildDir}/pdf.min.mjs';
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'file://${pdfjsBuildDir}/pdf.worker.min.mjs';

  try {
    const pdfBytes = Uint8Array.from(atob("${pdfBase64}"), c => c.charCodeAt(0));
    const pdf = await pdfjsLib.getDocument({
      data: pdfBytes,
      cMapUrl: 'file://${cmapsDir}/',
      cMapPacked: true,
      standardFontDataUrl: 'file://${standardFontsDir}/',
    }).promise;

    const scales = ${JSON.stringify(scales)};
    const pageIndices = ${JSON.stringify(pageIndices)};
    const pagesToRender = pageIndices || Array.from({length: pdf.numPages}, (_, i) => i);
    const results = [];

    for (let idx = 0; idx < pagesToRender.length; idx++) {
      const i = pagesToRender[idx];
      const page = await pdf.getPage(i + 1);
      const scale = scales[idx] || scales[0] || 1.0;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      results.push({
        width: canvas.width,
        height: canvas.height,
        dataUrl: canvas.toDataURL('image/png')
      });
    }

    window.__PDF_RENDER_RESULTS = results;
    window.__PDF_RENDERED = true;
  } catch (err) {
    window.__PDF_RENDER_ERROR = err.message || String(err);
    window.__PDF_RENDERED = true;
  }
</script>
</body></html>`;

    // Write HTML to temp file
    const htmlPath = path.join(tempDir, 'render.html');
    fs.writeFileSync(htmlPath, html);

    // Launch Puppeteer and render
    browser = await puppeteer.launch({
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--allow-file-access-from-files',
      ],
      headless: true,
      userDataDir: path.join(tempDir, 'chrome-data'),
    });

    const page = await browser.newPage();
    await page.goto(`file://${htmlPath}`, { waitUntil: 'domcontentloaded' });

    // Wait for rendering to complete
    await page.waitForFunction('window.__PDF_RENDERED === true', { timeout: 120000 });

    // Check for errors
    const renderError = await page.evaluate(() => (window as any).__PDF_RENDER_ERROR);
    if (renderError) {
      throw new Error(`Puppeteer pdfjs rendering failed: ${renderError}`);
    }

    // Extract rendered results
    const renderResults: Array<{ width: number; height: number; dataUrl: string }> =
      await page.evaluate(() => (window as any).__PDF_RENDER_RESULTS);

    if (!renderResults || renderResults.length === 0) {
      throw new Error('Puppeteer pdfjs rendering returned no results');
    }

    console.debug('convertPdfToImages', `Puppeteer rendered ${renderResults.length} pages`);

    // Process each page through sharp: downscale from high-DPI render if needed, then encode as JPEG
    const outputImages: string[] = [];
    for (let i = 0; i < renderResults.length; i++) {
      const result = renderResults[i];
      // Extract base64 PNG data from data URL
      const base64Data = result.dataUrl.replace(/^data:image\/png;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');

      // Downscale from high-DPI render to target dimensions if needed
      let imageForOutput: Buffer;
      if (needsDownscale && i < effectiveDims.length) {
        const targetWidth = Math.round(effectiveDims[i].original_width * maxScalingFactor);
        const targetHeight = Math.round(effectiveDims[i].original_height * maxScalingFactor);
        imageForOutput = await sharp(imageBuffer, { density: RENDERED_PAGES_PDF_DEFAULT_DPI })
          .resize(targetWidth, targetHeight, { fit: 'inside' })
          .toBuffer();
        console.debug('convertPdfToImages', `Puppeteer page ${i + 1}: downscaled to ${targetWidth}x${targetHeight}`);
      } else {
        imageForOutput = imageBuffer;
      }

      const sharpImage = sharp(imageForOutput, { density: RENDERED_PAGES_PDF_DEFAULT_DPI });
      const sharpMeta = await sharpImage.metadata();
      const finalBuffer = CONVERT_TO_JPEG_BEFORE_SENDING_TO_AI
        ? await sharpImage.jpeg({ quality: RENDERED_PAGES_JPEG_QUALITY }).toBuffer()
        : await sharpImage.png().toBuffer();

      // Update page dimensions with actual output sizes
      if (i < effectiveDims.length) {
        effectiveDims[i].width = sharpMeta.width || result.width;
        effectiveDims[i].height = sharpMeta.height || result.height;
      }

      outputImages.push(finalBuffer.toString('base64'));
      console.debug('convertPdfToImages', `Puppeteer page ${i + 1}: ${sharpMeta.width}x${sharpMeta.height}, ${finalBuffer.length} bytes`);
    }

    return { images: outputImages, metadata, page_dimensions: effectiveDims, rendering_method: 'puppeteer', totalPageCount: pageDimensions.length };
  } catch (error) {
    console.debug('convertPdfToImages', `Puppeteer fallback error: ${error}`);
    throw error;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.debug('convertPdfToImages', `Error closing Puppeteer browser: ${closeError}`);
      }
    }
    await cleanupTempDir(tempDir);
  }
}

/**
 * Lightweight page count: loads the PDF document header and returns numPages.
 * No rendering, no dimension calculation — just the page count.
 * Used by batch processing to discover total document size without rendering all pages.
 */
export async function getPdfPageCount(pdfData: Uint8Array): Promise<number> {
  const pdfOptions: any = {
    cMapUrl: PDFJS_PATHS.cMapUrl,
    cMapPacked: true,
    standardFontDataUrl: PDFJS_PATHS.standardFontDataUrl,
    disableFontFace: true,
    useSystemFonts: false,
  };
  const pdfToImage = await new PDFToImage().load(Buffer.from(pdfData), pdfOptions);
  const count = pdfToImage.document.numPages;
  await pdfToImage.removeGeneratedImagesOnDisk();
  return count;
}

export async function convertPdfToImages(
  fileName: string,
  pdfData: Uint8Array,
  pdfToImageOptions: IEnvelopeRevisionToImageRenderingOptions,
  pageNumbers?: number[]  // 1-indexed page numbers to render (undefined = all pages)
): Promise<IPDFToImageResult> {

  console.debug('convertPdfToImages', `Starting PDF to images conversion for ${fileName}, size: ${pdfData.length} bytes`);

  const pdfBuffer = Buffer.from(pdfData);

  // 1. Load PDF once with base options
  const pdfOptions = {
    cMapUrl: PDFJS_PATHS.cMapUrl,
    cMapPacked: true,
    standardFontDataUrl: PDFJS_PATHS.standardFontDataUrl,
    disableFontFace: true,
    // CRITICAL: Override pdf-to-image-generator's useSystemFonts: true default.
    // In Node.js, pdfjs's system font loading requires the Font Loading API
    // (document.fonts) which doesn't exist. With useSystemFonts: true, pdfjs
    // skips loading standard font data from files and instead tries system font
    // substitution — which always fails in Node.js, rendering text as squares.
    // Setting false restores pdfjs's own Node.js default behavior.
    useSystemFonts: false,
  };

  const pdfToImage = await new PDFToImage().load(pdfBuffer, pdfOptions);
  const pdfDoc = pdfToImage.document;
  console.debug('convertPdfToImages', `PDF document loaded with ${pdfDoc.numPages} pages`);

  // 2. Extract metadata from loaded document (single getMetadata call)
  let info: any = {};
  try {
    const rawMetadata: any = await pdfDoc.getMetadata();
    info = rawMetadata.info || {};
  } catch (err) {
    console.debug('convertPdfToImages', `Failed to get PDF metadata: ${err}`);
    info = {};
  }


  // 3. Determine rendering config from producer metadata (pure, instant)
  const producer = info.Producer || '';
  const creator = info.Creator || '';
  const config: IPdfProducerInfo = {
    producer,
    creator,
    ...getProducerConfig(producer, creator),
  };

  console.debug('convertPdfToImages', `PDF producer: "${producer}", creator: "${creator}", renderingMode: ${config.renderingMode}`);

  // 3b. If producer-based detection didn't trigger Puppeteer, check for
  // subset-embedded fonts that break in pdfjs + node-canvas.
  if (config.renderingMode === 'pdfjs-canvas') {
    const hasSubsetFonts = await hasSubsetEmbeddedFonts(pdfDoc);
    if (hasSubsetFonts) {
      console.debug('convertPdfToImages', `Switching to Puppeteer: subset-embedded fonts detected in ${fileName}`);
      config.renderingMode = 'puppeteer';
    }
  }

  // 3c. If still on pdfjs-canvas, check for non-embedded fonts that
  // pdfjs + node-canvas cannot render (e.g. ArialMT without embedding).
  if (config.renderingMode === 'pdfjs-canvas') {
    const hasNonEmbedded = await hasNonEmbeddedFonts(pdfDoc);
    if (hasNonEmbedded) {
      console.debug('convertPdfToImages', `Switching to Puppeteer: non-embedded fonts detected in ${fileName}`);
      config.renderingMode = 'puppeteer';
    }
  }

  // 4. Build metadata string
  const metadata = buildMetadataString(info, pdfDoc.numPages, fileName, pdfData.length);

  // 5. Calculate page dimensions. When rendering a subset (batched mode),
  //    measure only those pages — avoids O(total_pages) per-batch overhead.
  const { page_dimensions, maxScalingFactor, renderScale } = await calculatePageDimensions(pdfDoc, pdfToImageOptions, pageNumbers);
  const totalPageCount = pdfDoc.numPages;

  // 6. Render based on config
  if (config.renderingMode === 'puppeteer') {
    console.debug('convertPdfToImages', `Using Puppeteer fallback for ${fileName}`);
    // Clean up pdfToImage before switching to Puppeteer
    await pdfToImage.removeGeneratedImagesOnDisk();
    const puppeteerResult = await convertPdfToImagesWithPuppeteer(
      fileName, pdfData, metadata, page_dimensions, maxScalingFactor, renderScale, pageNumbers
    );
    puppeteerResult.totalPageCount = totalPageCount;
    return puppeteerResult;
  }

  // Default: pdfjs-canvas
  const canvasResult = await renderWithPdfjsCanvas(pdfToImage, pdfDoc, page_dimensions, maxScalingFactor, renderScale, metadata, pageNumbers);
  canvasResult.totalPageCount = totalPageCount;
  return canvasResult;
}


/**
 * Converts an image file to a PDF document
 * @param imageData The image data as an ArrayBuffer or Uint8Array
 * @param imageType The type of image (png, jpg, jpeg, webp)
 * @returns A Uint8Array containing the PDF document
 */
export async function convertImageToPdf(imageData: ArrayBuffer | Uint8Array, imageType: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      console.debug('input', `Starting image to PDF conversion for ${imageType} image, size: ${imageData.byteLength} bytes`);

      // Create an image object to get dimensions
      const img = new Image();

      // Set up image load handlers
      img.onload = () => {
        try {
          console.debug('input', `Image loaded successfully, dimensions: ${img.width}x${img.height}`);

          // Create a canvas to draw the image
          const canvas = createCanvas(img.width, img.height);
          const ctx = canvas.getContext('2d');

          // Draw the image on the canvas
          ctx.drawImage(img, 0, 0);

          // Get raw image data as base64 for jsPDF
          const imageBase64 = canvas.toBuffer('image/png').toString('base64');

          // Standard PDF points are 72 DPI
          const pxToPt = 0.75; // conversion factor

          // US Letter page size in points (72 DPI)
          const letterPageSize = { width: 612, height: 792 }; // 8.5" x 11" at 72 DPI

          // Calculate image dimensions in points
          const imageWidth = img.width * pxToPt;
          const imageHeight = img.height * pxToPt;

          // Calculate scaling factor to fit the page while maintaining aspect ratio
          const scaleX = letterPageSize.width / imageWidth;
          const scaleY = letterPageSize.height / imageHeight;
          const scale = Math.min(scaleX, scaleY);

          // Calculate final dimensions
          const finalWidth = imageWidth * scale;
          const finalHeight = imageHeight * scale;

          // Top-align (no centering offset — matches frontend image-sized page approach)
          const xOffset = (letterPageSize.width - finalWidth) / 2;
          const yOffset = 0;

          console.debug('input', `Scaling image from ${imageWidth}x${imageHeight} to ${finalWidth}x${finalHeight}`);
          console.debug('input', `Creating PDF with Letter page size: ${letterPageSize.width}x${letterPageSize.height}`);

          const pdf = new jsPDF({
            orientation: img.width > img.height ? 'landscape' : 'portrait',
            unit: 'pt',
            format: 'letter',
            compress: true
          });

          // Add the image to the PDF, centered on the page
          pdf.addImage(
            `data:image/png;base64,${imageBase64}`,
            'PNG',
            xOffset,
            yOffset,
            finalWidth,
            finalHeight
          );

          // Output with specific PDF version to ensure proper structure
          const pdfOutput = pdf.output('arraybuffer');

          // Log the start of the PDF to debug headers
          const pdfBytes = new Uint8Array(pdfOutput);
          const pdfHeader = new TextDecoder().decode(pdfBytes.slice(0, 20));
          console.debug('input', `Generated PDF header: ${JSON.stringify(pdfHeader)}`);
          console.debug('input', `PDF size: ${pdfOutput.byteLength} bytes`);

          // Resolve with the PDF data
          resolve(new Uint8Array(pdfOutput));
        } catch (error) {
          console.error('input', `Error creating PDF from image: ${error}`);
          reject(error);
        }
      };

      img.onerror = (error) => {
        console.debug('input', `Error loading image: ${error}`);
        reject(new Error('Failed to load image'));
      };

      // Set the image source directly from the buffer
      try {
        const buf = Buffer.from(imageData instanceof Uint8Array ? imageData : new Uint8Array(imageData));
        img.src = buf as any;
      } catch (bufferError) {
        console.error('input', `Error creating buffer from image data: ${bufferError}`);
        reject(new Error('Failed to create buffer from image data'));
      }
    } catch (error) {
      console.debug('errors', `Error in convertImageToPdf: ${error}`);
      reject(error);
    }
  });
}
