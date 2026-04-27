import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { KEYBOARD_SHORTCUTS, type KeyCombo } from '@/config/keyboard-shortcuts';

const isMacPlatform = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function KeyCap({ label }: { label: string }) {
  return (
    <kbd
      className="inline-flex items-center justify-center min-w-[28px] h-[26px] px-1.5 rounded-md
        bg-muted border border-border/60 text-[11px] font-medium font-mono text-muted-foreground
        shadow-[0_1px_0_0_hsl(var(--border))]"
    >
      {label}
    </kbd>
  );
}

function ShortcutKeys({ combo, platform }: { combo: KeyCombo; platform: 'mac' | 'win' }) {
  const keys = platform === 'mac' ? combo.mac : combo.win;
  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((key, i) => (
        <KeyCap key={i} label={key} />
      ))}
    </span>
  );
}

function ShortcutRow({ label, keys, context, platform }: {
  label: string;
  keys: KeyCombo[];
  context?: string;
  platform: 'mac' | 'win';
}) {
  return (
    <div className="flex items-center justify-between py-1.5 px-1">
      <span className="text-sm text-foreground">{label}</span>
      <span className="flex items-center gap-2 ml-4 shrink-0">
        {context && (
          <span className="text-[10px] text-muted-foreground italic mr-1">{context}</span>
        )}
        {keys.map((combo, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground text-xs">/</span>}
            <ShortcutKeys combo={combo} platform={platform} />
          </span>
        ))}
      </span>
    </div>
  );
}

export default function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [platform, setPlatform] = useState<'mac' | 'win'>(isMacPlatform ? 'mac' : 'win');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-row items-center justify-between pr-8">
          <DialogTitle className="text-base font-semibold">Keyboard Shortcuts</DialogTitle>
          <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
            <button
              onClick={() => setPlatform('mac')}
              className={`px-2.5 py-1 transition-colors ${
                platform === 'mac'
                  ? 'bg-foreground text-background font-medium'
                  : 'bg-background text-muted-foreground hover:bg-muted'
              }`}
            >
              Mac
            </button>
            <button
              onClick={() => setPlatform('win')}
              className={`px-2.5 py-1 border-l border-border transition-colors ${
                platform === 'win'
                  ? 'bg-foreground text-background font-medium'
                  : 'bg-background text-muted-foreground hover:bg-muted'
              }`}
            >
              Win
            </button>
          </div>
        </DialogHeader>

        <div className="overflow-y-auto -mx-6 px-6 pb-2">
          {KEYBOARD_SHORTCUTS.map((group) => (
            <div key={group.title} className="mb-4">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 mt-2">
                {group.title}
              </h3>
              <div className="divide-y divide-border/40">
                {group.shortcuts.map((shortcut) => (
                  <ShortcutRow
                    key={shortcut.id}
                    label={shortcut.label}
                    keys={shortcut.keys}
                    context={shortcut.context}
                    platform={platform}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
