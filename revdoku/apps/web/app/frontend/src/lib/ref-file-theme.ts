// Shared color tokens for reference-file UI surfaces.
//
// One visual identity for the whole reference-file thread:
//   - "Reference Files Required" section in the Review dialog
//   - `#file[…]` chips inside the checklist rule prompt editor
//   - `ref:filename` citation links rendered inside check descriptions
//   - The floating reference-file viewer panel (active tab underline,
//     highlight mark backgrounds, panel outline)
//
// Change here, everything follows. Avoid hard-coding blue-500 / blue-600
// in ref-file components — import the token instead.
//
// Design intent (blue, not indigo/amber): indigo is the Revdoku primary
// brand (buttons, checklist accents); keeping ref files on a distinct
// blue keeps them visually separate from "run action" UI. Amber was
// previously used on the viewer tab but conflicts with warning/credits
// semantics elsewhere.

export const REF_FILE_THEME = {
  // Subtle tinted background + matching border — use for the ref-files
  // container in the Review dialog and the viewer panel chrome.
  bgClass: "bg-blue-50 dark:bg-blue-950/30",
  borderClass: "border-blue-200 dark:border-blue-900",
  // Full combined class for the common "tinted card" pattern.
  sectionClass:
    "bg-blue-50 border border-blue-200 dark:bg-blue-950/30 dark:border-blue-900",

  // Accent: chips, citation links, active tab text, small iconography.
  accentTextClass: "text-blue-700 dark:text-blue-300",
  accentTextStrongClass: "text-blue-600 dark:text-blue-400",
  accentBgClass: "bg-blue-100 dark:bg-blue-900/40",
  accentBorderClass: "border-blue-200 dark:border-blue-900",
  accentHoverBgClass: "hover:bg-blue-100 dark:hover:bg-blue-900/60",

  // Raw values for inline styles / CSS-in-JS (the ref-file viewer uses
  // plain style objects for its floating panel + <style> block).
  accentColor: "#2563eb", // blue-600
  accentColorLight: "#3b82f6", // blue-500
  markBgSolid: "#dbeafe", // blue-100
  markBgTranslucent: "rgba(37, 99, 235, 0.22)",
  markOutline: "rgba(37, 99, 235, 0.55)",
} as const;
