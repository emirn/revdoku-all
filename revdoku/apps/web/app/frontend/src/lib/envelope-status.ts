import { IEnvelope, EnvelopeStatus } from '@revdoku/lib';

export type InspectionStatusLevel = 'none' | 'issues' | 'review' | 'good' | 'complete';

export interface InspectionStatus {
  level: InspectionStatusLevel;
  label: string;
  progress: number;       // 0-100
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  dotColor: string;       // tailwind bg class for the status dot
}

const STATUS_MAP: Record<InspectionStatusLevel, { label: string; dotColor: string }> = {
  none: { label: 'No review', dotColor: 'bg-gray-400' },
  issues: { label: 'Issues', dotColor: 'bg-red-500' },
  review: { label: 'Review', dotColor: 'bg-amber-500' },
  good: { label: 'Good', dotColor: 'bg-green-500' },
  complete: { label: 'Complete', dotColor: 'bg-emerald-500' },
};

export function getInspectionStatus(envelope: IEnvelope & { last_report?: any }): InspectionStatus {
  const report = envelope.last_report;
  const totalChecks = report?.total_checks ?? 0;
  const passedChecks = report?.passed_checks ?? 0;
  const failedChecks = totalChecks - passedChecks;

  if (!report || totalChecks === 0) {
    const s = STATUS_MAP.none;
    return { level: 'none', label: s.label, progress: 0, totalChecks: 0, passedChecks: 0, failedChecks: 0, dotColor: s.dotColor };
  }

  const progress = Math.round((passedChecks / totalChecks) * 100);

  let level: InspectionStatusLevel;
  if (progress === 100) level = 'complete';
  else if (progress >= 75) level = 'good';
  else if (progress >= 50) level = 'review';
  else level = 'issues';

  const s = STATUS_MAP[level];
  return { level, label: s.label, progress, totalChecks, passedChecks, failedChecks, dotColor: s.dotColor };
}

export interface WorkflowStatusConfig {
  label: string;
  badgeClass: string;
}

export function getWorkflowStatusConfig(status: EnvelopeStatus | undefined): WorkflowStatusConfig {
  switch (status) {
    case EnvelopeStatus.WORKING:
      return { label: 'Working', badgeClass: 'border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400' };
    case EnvelopeStatus.COMPLETED:
      return { label: 'Complete', badgeClass: 'border-green-300 dark:border-green-700 text-green-700 dark:text-green-400' };
    default:
      return { label: 'New', badgeClass: 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400' };
  }
}

export function getCompliancePercentColor(progress: number): string {
  if (progress >= 100) return 'text-emerald-600 dark:text-emerald-400';
  if (progress >= 75) return 'text-green-600 dark:text-green-400';
  if (progress >= 50) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}
