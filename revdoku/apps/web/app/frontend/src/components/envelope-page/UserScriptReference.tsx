import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import referenceText from '@/config/user-script-reference.txt?raw';
import referenceHtml from '@/config/user-script-reference.html?raw';

export default function UserScriptReference() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      const htmlBlob = new Blob([referenceHtml], { type: 'text/html' });
      const textBlob = new Blob([referenceText], { type: 'text/plain' });
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob })
      ]);
    } catch {
      await navigator.clipboard.writeText(referenceText);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none hover:text-foreground transition-colors">
        Script Reference
      </summary>
      <div className="mt-2 p-2 rounded border bg-muted/50 font-mono whitespace-pre-wrap relative leading-relaxed">
        <button
          onClick={handleCopy}
          className="absolute top-1.5 right-1.5 p-1 rounded hover:bg-background/80"
          title="Copy reference"
        >
          {copied
            ? <Check className="h-3 w-3 text-green-600" />
            : <Copy className="h-3 w-3" />
          }
        </button>
        {referenceText}
      </div>
    </details>
  );
}
