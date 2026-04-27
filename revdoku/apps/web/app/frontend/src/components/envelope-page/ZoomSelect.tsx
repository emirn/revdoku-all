import { useState, useRef, useEffect, useCallback } from "react";

export type ZoomMode = "fit-width" | "fit-page" | "custom";

interface ZoomSelectProps {
  zoomMode: ZoomMode;
  zoomLevel: number;
  onSelect: (mode: ZoomMode, level?: number) => void;
}

const PRESET_OPTIONS: { label: string; mode: ZoomMode; level?: number }[] = [
  { label: "Width", mode: "fit-width" },
  { label: "Page", mode: "fit-page" },
];

const ZOOM_PRESETS = [25, 50, 75, 100, 125, 150, 200, 300];

function getDisplayText(zoomMode: ZoomMode, zoomLevel: number): string {
  if (zoomMode === "fit-width") return "Width";
  if (zoomMode === "fit-page") return "Page";
  return `${Math.round(zoomLevel * 100)}%`;
}

export function ZoomSelect({ zoomMode, zoomLevel, onSelect }: ZoomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(() =>
    getDisplayText(zoomMode, zoomLevel)
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync display text when props change (and dropdown is closed)
  useEffect(() => {
    if (!isOpen) {
      setInputValue(getDisplayText(zoomMode, zoomLevel));
    }
  }, [zoomMode, zoomLevel, isOpen]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setInputValue(getDisplayText(zoomMode, zoomLevel));
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, zoomMode, zoomLevel]);

  // Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        setInputValue(getDisplayText(zoomMode, zoomLevel));
        inputRef.current?.blur();
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, zoomMode, zoomLevel]);

  const handleInputClick = useCallback(() => {
    setIsOpen(true);
    // Select all text so user can type a replacement
    setTimeout(() => inputRef.current?.select(), 0);
  }, []);

  const handleOptionClick = useCallback(
    (mode: ZoomMode, level?: number) => {
      onSelect(mode, level);
      setIsOpen(false);
      inputRef.current?.blur();
    },
    [onSelect]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const raw = inputValue.replace(/[^0-9]/g, "");
        const num = parseInt(raw, 10);
        if (!isNaN(num) && num > 0) {
          const clamped = Math.max(1, Math.min(1000, num));
          onSelect("custom", clamped / 100);
        }
        setIsOpen(false);
        inputRef.current?.blur();
      }
    },
    [inputValue, onSelect]
  );

  return (
    <div ref={containerRef} className="relative">
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onClick={handleInputClick}
          onKeyDown={handleKeyDown}
          className="h-7 w-[80px] text-center text-sm bg-secondary text-secondary-foreground rounded border-0 cursor-pointer hover:bg-accent transition-colors focus:outline-none focus:ring-1 focus:ring-ring pr-5"
          title="Zoom level — click to select or type a number"
        />
        <svg
          className={`absolute right-1 w-3 h-3 text-muted-foreground pointer-events-none transition-transform ${isOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
          viewBox="0 0 12 12"
          fill="currentColor"
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-[100px] bg-popover text-popover-foreground border border-border rounded-md shadow-md z-50 py-1">
          {PRESET_OPTIONS.map((opt) => (
            <button
              key={opt.mode}
              onClick={() => handleOptionClick(opt.mode, opt.level)}
              className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors flex items-center justify-between"
            >
              <span>{opt.label}</span>
              {zoomMode === opt.mode && (
                <span className="text-xs">&#10003;</span>
              )}
            </button>
          ))}

          <div className="h-px bg-border mx-2 my-1" />

          {ZOOM_PRESETS.map((pct) => (
            <button
              key={pct}
              onClick={() => handleOptionClick("custom", pct / 100)}
              className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors flex items-center justify-between"
            >
              <span>{pct}%</span>
              {zoomMode === "custom" &&
                Math.round(zoomLevel * 100) === pct && (
                  <span className="text-xs">&#10003;</span>
                )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
