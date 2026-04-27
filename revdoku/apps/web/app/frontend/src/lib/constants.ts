export const AI_DISCLAIMER = "AI can make mistakes. Always verify important information.";

// Mirror of Revdoku::MAX_AD_HOC_REF_FILES (config/initializers/00_revdoku.rb).
// Cap on how many ad-hoc reference files a user can attach to a single
// review via the "Add note" section in ReviewCustomDialog. Keep both
// values in lockstep — backend rejects payloads that exceed this.
export const MAX_AD_HOC_REF_FILES = 1;

// Upper bound on the free-text review_note a user can enter in the
// Review dialog. Mirrors the server-side check in ReportsController#create.
export const MAX_REVIEW_NOTE_LENGTH = 2000;
