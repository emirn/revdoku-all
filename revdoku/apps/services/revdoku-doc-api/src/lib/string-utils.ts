// import

// Constants for filename display
const MAX_FILENAME_LENGTH = 40; // Maximum length for displayed filenames


export const escapeHtml = (text: string): string => {
  return text.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/`/g, '&#96;');
};

// Helper function to truncate filenames
export const truncateFilename = (filename: string, maxLength: number = MAX_FILENAME_LENGTH): string => {
  if (filename.length <= maxLength) return filename;
  
  // Split filename and extension
  const lastDotIndex = filename.lastIndexOf('.');
  if (lastDotIndex === -1) {
    // No extension, just truncate
    return filename.substring(0, maxLength - 3) + '...';
  }
  
  const name = filename.substring(0, lastDotIndex);
  const extension = filename.substring(lastDotIndex);
  
  // Calculate available space for name (accounting for extension and ellipsis)
  const availableSpace = maxLength - extension.length - 3; // 3 for "..."
  
  if (availableSpace <= 0) {
    // Extension is too long, just truncate everything
    return filename.substring(0, maxLength - 3) + '...';
  }
  
  return name.substring(0, availableSpace) + '...' + extension;
};
