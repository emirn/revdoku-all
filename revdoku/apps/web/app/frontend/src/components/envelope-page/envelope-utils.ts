import type { ICheck, IChecklist, IEnvelope, IReport } from "@revdoku/lib";
import { filterChecksByType, CheckFilterType } from "@revdoku/lib";
import type { CheckFilter } from "@/components/envelope-page/CheckNavigator";

export function filterChecks(checks: ICheck[], filter: CheckFilter): ICheck[] {
  return filterChecksByType(checks, filter as CheckFilterType);
}

export function updateReportInBothStates(
  newReport: IReport,
  setCurrentReport: React.Dispatch<React.SetStateAction<IReport | null>>,
  setCurrentEnvelope: React.Dispatch<React.SetStateAction<IEnvelope | null>>,
) {
  setCurrentReport(newReport);
  setCurrentEnvelope(prev => {
    if (!prev || !prev.envelope_revisions) return prev;
    return {
      ...prev,
      envelope_revisions: prev.envelope_revisions.map(rev => {
        if (rev.id === newReport.envelope_revision_id) {
          return { ...rev, report: newReport };
        }
        return rev;
      })
    };
  });
}

export function addCheckToReport(
  newCheck: ICheck,
  currentReportId: string | undefined,
  setCurrentReport: React.Dispatch<React.SetStateAction<IReport | null>>,
  setCurrentEnvelope: React.Dispatch<React.SetStateAction<IEnvelope | null>>,
  updatedChecklist?: IChecklist,
) {
  setCurrentReport(prev => {
    if (!prev) return prev;
    return {
      ...prev,
      checks: [...prev.checks, newCheck],
      ...(updatedChecklist && { checklist: updatedChecklist })
    } as IReport;
  });

  setCurrentEnvelope(prev => {
    if (!prev || !prev.envelope_revisions || !currentReportId) return prev;
    return {
      ...prev,
      envelope_revisions: prev.envelope_revisions.map(rev => {
        if (rev.report?.id === currentReportId) {
          return {
            ...rev,
            report: {
              ...rev.report,
              checks: [...(rev.report?.checks || []), newCheck]
            }
          };
        }
        return rev;
      })
    };
  });
}

export function updateCheckInReport(
  updatedCheck: ICheck,
  currentReportId: string | undefined,
  setCurrentReport: React.Dispatch<React.SetStateAction<IReport | null>>,
  setCurrentEnvelope: React.Dispatch<React.SetStateAction<IEnvelope | null>>,
) {
  setCurrentReport(prev => {
    if (!prev) return prev;
    return {
      ...prev,
      checks: prev.checks.map(c => c.id === updatedCheck.id ? updatedCheck : c)
    };
  });

  setCurrentEnvelope(prev => {
    if (!prev || !prev.envelope_revisions || !currentReportId) return prev;
    return {
      ...prev,
      envelope_revisions: prev.envelope_revisions.map(rev => {
        if (rev.report?.id === currentReportId) {
          return {
            ...rev,
            report: {
              ...rev.report,
              checks: (rev.report?.checks || []).map(c => c.id === updatedCheck.id ? updatedCheck : c)
            }
          };
        }
        return rev;
      })
    };
  });
}

export function removeCheckFromReport(
  checkId: string,
  currentReportId: string | undefined,
  setCurrentReport: React.Dispatch<React.SetStateAction<IReport | null>>,
  setCurrentEnvelope: React.Dispatch<React.SetStateAction<IEnvelope | null>>,
) {
  setCurrentReport(prev => {
    if (!prev) return prev;
    return {
      ...prev,
      checks: prev.checks.filter(c => c.id !== checkId)
    };
  });

  setCurrentEnvelope(prev => {
    if (!prev || !prev.envelope_revisions || !currentReportId) return prev;
    return {
      ...prev,
      envelope_revisions: prev.envelope_revisions.map(rev => {
        if (rev.report?.id === currentReportId) {
          return {
            ...rev,
            report: {
              ...rev.report,
              checks: (rev.report?.checks || []).filter(c => c.id !== checkId)
            }
          };
        }
        return rev;
      })
    };
  });
}
