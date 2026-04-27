// Core edition exposes no extra account tabs beyond the base set
// (Profile, Account, Security, AI, API).
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface AccountTab {
  value: string;
  path: string;
  label: string;
  Icon?: LucideIcon;
  Page: ComponentType;
}

export const extraAccountTabs: AccountTab[] = [];
