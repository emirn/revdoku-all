import { useState, useRef, useEffect } from 'react';
import { SCRIPT_TEMPLATES } from '@/config/envelope-script-templates';
import UserScriptReference from '@/components/envelope-page/UserScriptReference';
import { ChevronDown } from 'lucide-react';

interface UserScriptEditorProps {
  code: string;
  onCodeChange: (code: string) => void;
  onTemplateSelect?: (id: string, name: string) => void;
}

const MONO_STYLE = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: '12px',
  lineHeight: '1.6',
  tabSize: 2,
};

export default function UserScriptEditor({
  code,
  onCodeChange,
  onTemplateSelect,
}: UserScriptEditorProps) {
  const [samplesOpen, setSamplesOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!samplesOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSamplesOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [samplesOpen]);

  const handleSampleInsert = (idx: number) => {
    const sample = SCRIPT_TEMPLATES[idx];
    if (!sample) return;
    if (code.trim() && !window.confirm('Replace current script with this template?')) {
      return;
    }
    onCodeChange(sample.code);
    onTemplateSelect?.(sample.id, sample.title);
    setSamplesOpen(false);
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground">Script</label>
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setSamplesOpen(!samplesOpen)}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border border-border bg-background hover:bg-muted text-foreground"
            >
              Sample Scripts
              <ChevronDown className="h-3 w-3" />
            </button>
            {samplesOpen && (
              <div className="absolute right-0 top-full mt-1 w-80 rounded-md border border-border bg-popover shadow-md z-50 py-1 max-h-72 overflow-y-auto">
                {SCRIPT_TEMPLATES.map((t, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSampleInsert(i)}
                    className="w-full text-left px-3 py-2 hover:bg-muted text-foreground"
                  >
                    <div className="text-xs font-medium">{t.title}</div>
                    {t.description && <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{t.description}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <textarea
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
          style={{ ...MONO_STYLE, minHeight: '240px' }}
          placeholder={'// Define template at top:\n// script_template = `<b>Total: {{total}}</b>`;\n\n// Then compute data:\n// return { data: { total: 42 } };'}
          spellCheck={false}
        />
      </div>

      <UserScriptReference />
    </div>
  );
}
