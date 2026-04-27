/**
 * Lightweight pub/sub bridge between useNotifications (ActionCable consumer)
 * and useInspection (polling loop).
 *
 * When an ActionCable notification arrives for a report that belongs to the
 * envelope currently being inspected, useNotifications calls
 * signalInspectionComplete(). useInspection's pollForReportCompletion
 * subscribes via subscribeInspectionComplete() and immediately triggers a
 * poll instead of waiting for the next backoff interval.
 */

type CompletionCallback = (envelopeId: string, reportId: string) => void;

let activeEnvelopeId: string | null = null;
const listeners = new Set<CompletionCallback>();

/** Called by useInspection when inspection starts/ends */
export function setActiveInspection(envelopeId: string | null) {
  activeEnvelopeId = envelopeId;
}

/** Called by useNotifications to check if a notification is for the active inspection */
export function getActiveInspection(): string | null {
  return activeEnvelopeId;
}

/** Called by useInspection's pollForReportCompletion to listen for ActionCable shortcut */
export function subscribeInspectionComplete(cb: CompletionCallback): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Called by useNotifications when report_completed/report_failed arrives for active envelope */
export function signalInspectionComplete(envelopeId: string, reportId: string) {
  listeners.forEach(cb => cb(envelopeId, reportId));
}
