import {
  IEnvelope,
  IEnvelopeRevision,
  IReport,
  IDocumentFile,
  createFileRevisionLinksFromVeryLatestFileRevisions,
  createNewBaseObject,
  EnvelopeStatus
} from './common-types';
import { getFileNameFromFiles } from './string-utils';


export function createNewEnvelope(params: {
  title: string;
  report: IReport;
  comment?: string;
  document_files?: IDocumentFile[];
}): IEnvelope {
  const revision_number = 0; // the very first revision, zero based revision index!
  const firstRevision: IEnvelopeRevision = {
    ...createNewBaseObject(),
    revision_number: revision_number, // zero based revision number!
    document_file_revision_links: createFileRevisionLinksFromVeryLatestFileRevisions(params.document_files || []),
    report: params.report,
    comment: params.comment,
  };

  return {
    ...createNewBaseObject(),
    title: params.title,
    document_files: params.document_files || [],
    current_revision_index: 0,
    envelope_checklist_id: null,
    status: EnvelopeStatus.NEW,
    envelope_revisions: [firstRevision],
  } as IEnvelope;
}


export function appendEnvelopeRevision({
  envelope,
  document_files,
  comment,
}: {
  envelope: IEnvelope;
  document_files: IDocumentFile[];
  comment?: string;
}): IEnvelope {
  // in zero based revision index, first is 0, second is 1, etc.
  const revision_number: number = envelope.envelope_revisions.length; // zero based revision number!

  const previousRevision: IEnvelopeRevision = envelope.envelope_revisions[envelope.current_revision_index] as IEnvelopeRevision;

  // adding new revision
  const newEnvelopeRevision: IEnvelopeRevision =   {
    ...createNewBaseObject(),
    revision_number,
    document_file_revision_links: createFileRevisionLinksFromVeryLatestFileRevisions(document_files || []),
    report: null,
    comment: comment,
  };

  envelope.envelope_revisions.push(newEnvelopeRevision);
  envelope.current_revision_index = envelope.envelope_revisions.length - 1;

  return envelope;
}

export function getCurrentEnvelopeRevision(envelope: IEnvelope): IEnvelopeRevision | undefined {
  if (!envelope || !envelope.envelope_revisions || envelope.envelope_revisions.length === 0) {
    return undefined;
  }
  return envelope.envelope_revisions[envelope.current_revision_index];
}


export function envelopeToJSON(envelope: IEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}

export function envelopeFromJSON(json: string): IEnvelope {
  return JSON.parse(json) as IEnvelope;
}


export function rollbackToRevision(
  envelope: IEnvelope,
  revisionIndex: number,
): IEnvelope {
  if (
    revisionIndex < 0 ||
    revisionIndex >= envelope.envelope_revisions.length
  ) {
    return envelope;
  }

  envelope.envelope_revisions = envelope.envelope_revisions.slice(0, revisionIndex + 1);
  envelope.current_revision_index = envelope.envelope_revisions.length - 1;
  envelope.updated_at = new Date().toISOString();

  return envelope;
}

