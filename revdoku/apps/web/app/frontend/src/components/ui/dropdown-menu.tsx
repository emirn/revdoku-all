import * as React from 'react';
import { cn } from '@/lib/utils';

interface DropdownMenuProps {
  children: React.ReactNode;
}

interface DropdownMenuTriggerProps {
  children: React.ReactNode;
  asChild?: boolean;
}

interface DropdownMenuContentProps {
  children: React.ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
}

interface DropdownMenuItemProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  destructive?: boolean;
  disabled?: boolean;
}

interface DropdownMenuSeparatorProps {
  className?: string;
}

interface DropdownMenuLabelProps {
  children: React.ReactNode;
  className?: string;
}

const DropdownMenuContext = React.createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
  containerRef: React.RefObject<HTMLDivElement> | null;
}>({
  open: false,
  setOpen: () => {},
  containerRef: null,
});

export function DropdownMenu({ children }: DropdownMenuProps) {
  const [open, setOpen] = React.useState(false);

  // Close on click outside
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  // Close on escape
  React.useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [open]);

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen, containerRef: ref }}>
      <div ref={ref} className="relative inline-flex text-left">
        {children}
      </div>
    </DropdownMenuContext.Provider>
  );
}

export function DropdownMenuTrigger({ children, asChild }: DropdownMenuTriggerProps) {
  const { open, setOpen } = React.useContext(DropdownMenuContext);

  const handleClick = () => {
    setOpen(!open);
  };

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, {
      onClick: handleClick,
      'aria-expanded': open,
      'aria-haspopup': true,
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-expanded={open}
      aria-haspopup={true}
    >
      {children}
    </button>
  );
}

export function DropdownMenuContent({ children, align = 'end', className }: DropdownMenuContentProps) {
  const { open, setOpen, containerRef } = React.useContext(DropdownMenuContext);
  const [openUpward, setOpenUpward] = React.useState(false);

  React.useEffect(() => {
    if (open && containerRef?.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUpward(spaceBelow < 150);
    }
  }, [open, containerRef]);

  if (!open) return null;

  return (
    <div
      className={cn(
        'absolute z-50 min-w-[200px] rounded-md border border-border bg-popover p-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none',
        openUpward ? 'bottom-full mb-2' : 'mt-2',
        align === 'start' && 'left-0',
        align === 'center' && 'left-1/2 -translate-x-1/2',
        align === 'end' && 'right-0',
        className
      )}
      role="menu"
      aria-orientation="vertical"
    >
      {children}
    </div>
  );
}

export function DropdownMenuItem({ children, onClick, className, destructive, disabled }: DropdownMenuItemProps) {
  const { setOpen } = React.useContext(DropdownMenuContext);

  const handleClick = () => {
    if (disabled) return;
    onClick?.();
    setOpen(false);
  };

  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'flex w-full items-center rounded-sm px-3 py-2 text-sm text-left transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        'focus:bg-accent focus:text-accent-foreground focus:outline-none',
        destructive && 'text-destructive hover:bg-destructive/10 hover:text-destructive',
        disabled && 'opacity-50 cursor-default',
        className
      )}
      role="menuitem"
      onClick={handleClick}
    >
      {children}
    </button>
  );
}

export function DropdownMenuSeparator({ className }: DropdownMenuSeparatorProps) {
  return <div className={cn('my-1 h-px bg-border', className)} role="separator" />;
}

export function DropdownMenuLabel({ children, className }: DropdownMenuLabelProps) {
  return (
    <div className={cn('px-3 py-2 text-sm font-semibold text-foreground', className)}>
      {children}
    </div>
  );
}

// --- Submenu primitives ---

interface DropdownMenuSubProps {
  children: React.ReactNode;
}

const DropdownMenuSubContext = React.createContext<{
  subOpen: boolean;
  setSubOpen: (open: boolean) => void;
}>({ subOpen: false, setSubOpen: () => {} });

export function DropdownMenuSub({ children }: DropdownMenuSubProps) {
  const [subOpen, setSubOpen] = React.useState(false);
  const enterTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const leaveTimer = React.useRef<ReturnType<typeof setTimeout>>();

  const handleMouseEnter = () => {
    clearTimeout(leaveTimer.current);
    enterTimer.current = setTimeout(() => setSubOpen(true), 50);
  };

  const handleMouseLeave = () => {
    clearTimeout(enterTimer.current);
    leaveTimer.current = setTimeout(() => setSubOpen(false), 150);
  };

  React.useEffect(() => {
    return () => {
      clearTimeout(enterTimer.current);
      clearTimeout(leaveTimer.current);
    };
  }, []);

  return (
    <DropdownMenuSubContext.Provider value={{ subOpen, setSubOpen }}>
      <div
        className="relative"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </div>
    </DropdownMenuSubContext.Provider>
  );
}

interface DropdownMenuSubTriggerProps {
  children: React.ReactNode;
  className?: string;
}

export function DropdownMenuSubTrigger({ children, className }: DropdownMenuSubTriggerProps) {
  const { subOpen, setSubOpen } = React.useContext(DropdownMenuSubContext);

  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center rounded-sm px-3 py-2 text-sm text-left transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        'focus:bg-accent focus:text-accent-foreground focus:outline-none',
        subOpen && 'bg-accent text-accent-foreground',
        className
      )}
      role="menuitem"
      aria-haspopup="true"
      aria-expanded={subOpen}
      onClick={() => setSubOpen(!subOpen)}
    >
      {children}
      <svg className="ml-auto h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

interface DropdownMenuSubContentProps {
  children: React.ReactNode;
  className?: string;
}

export function DropdownMenuSubContent({ children, className }: DropdownMenuSubContentProps) {
  const { subOpen } = React.useContext(DropdownMenuSubContext);

  if (!subOpen) return null;

  return (
    <div
      className={cn(
        'absolute right-full top-0 mr-1 z-50 min-w-[200px] rounded-md border border-border bg-popover p-1 shadow-lg ring-1 ring-black ring-opacity-5',
        className
      )}
      role="menu"
      aria-orientation="vertical"
    >
      {children}
    </div>
  );
}

interface DropdownMenuCheckboxItemProps {
  children: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}

export function DropdownMenuCheckboxItem({ children, checked, onCheckedChange, className }: DropdownMenuCheckboxItemProps) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center whitespace-nowrap rounded-sm px-3 py-2 text-sm transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        'focus:bg-accent focus:text-accent-foreground focus:outline-none',
        className
      )}
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
    >
      <span className="w-4 h-4 mr-2 flex items-center justify-center">
        {checked && (
          <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>
      {children}
    </button>
  );
}
