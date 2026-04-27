/**
 * Keyboard shortcuts definition — single source of truth.
 * Used by KeyboardShortcutsDialog and potentially for runtime shortcut registration.
 */

export type KeyCombo = {
  mac: string[];
  win: string[];
};

export type ShortcutDef = {
  id: string;
  label: string;
  keys: KeyCombo[];
  context?: string;
};

export type ShortcutGroup = {
  title: string;
  shortcuts: ShortcutDef[];
};

export const KEYBOARD_SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Document Viewer',
    shortcuts: [
      { id: 'zoom-in', label: 'Zoom in', keys: [{ mac: ['⌘', '='], win: ['Ctrl', '='] }] },
      { id: 'zoom-out', label: 'Zoom out', keys: [{ mac: ['⌘', '–'], win: ['Ctrl', '–'] }] },
      { id: 'zoom-reset', label: 'Reset zoom (fit width)', keys: [{ mac: ['⌘', '0'], win: ['Ctrl', '0'] }] },
      { id: 'zoom-scroll', label: 'Proportional zoom', keys: [{ mac: ['⌘', 'Scroll'], win: ['Ctrl', 'Scroll'] }] },
      { id: 'page-next', label: 'Next / previous page', keys: [{ mac: ['Space'], win: ['Space'] }, { mac: ['⇧', 'Space'], win: ['Shift', 'Space'] }] },
      { id: 'check-nav', label: 'Next / previous check', keys: [{ mac: ['J'], win: ['J'] }, { mac: ['K'], win: ['K'] }] },
      { id: 'check-magnify', label: 'Magnify check', keys: [{ mac: ['Z'], win: ['Z'] }] },
      { id: 'check-edit', label: 'Edit check', keys: [{ mac: ['Enter'], win: ['Enter'] }], context: 'when selected' },
      { id: 'check-delete', label: 'Delete check', keys: [{ mac: ['⌫'], win: ['Delete'] }], context: 'when selected' },
      { id: 'check-toggle', label: 'Toggle pass / fail', keys: [{ mac: ['X'], win: ['X'] }], context: 'when selected' },
      { id: 'run-inspection', label: 'Run inspection', keys: [{ mac: ['⌘', '⇧', 'R'], win: ['Ctrl', 'Shift', 'R'] }] },
    ],
  },
  {
    title: 'Sidebar',
    shortcuts: [
      { id: 'sidebar-toggle', label: 'Toggle sidebar', keys: [{ mac: ['⌘', 'B'], win: ['Ctrl', 'B'] }] },
      { id: 'sidebar-search', label: 'Focus search', keys: [{ mac: ['/'], win: ['/'] }] },
      { id: 'sidebar-nav', label: 'Navigate list', keys: [{ mac: ['J'], win: ['J'] }, { mac: ['K'], win: ['K'] }] },
      { id: 'sidebar-open', label: 'Open envelope', keys: [{ mac: ['Enter'], win: ['Enter'] }] },
    ],
  },
  {
    title: 'General',
    shortcuts: [
      { id: 'close', label: 'Close / deselect', keys: [{ mac: ['Esc'], win: ['Esc'] }] },
      { id: 'save', label: 'Save / confirm', keys: [{ mac: ['Enter'], win: ['Enter'] }] },
      { id: 'add-rule', label: 'Add checklist rule', keys: [{ mac: ['Tab'], win: ['Tab'] }], context: 'in checklist editor' },
      { id: 'shortcuts-dialog', label: 'Keyboard shortcuts', keys: [{ mac: ['⌘', '/'], win: ['Ctrl', '/'] }] },
    ],
  },
];
