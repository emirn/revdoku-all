import type { IEnvelope, ICheck, IChecklist, IReport, ICheckFlatten } from '@revdoku/lib';


export interface ICheckResponse {
    check: ICheck;
    checklist?: IChecklist;  // Updated checklist with new rules (for manual checks)
    report?: { report: IReport };  // Full report with updated checks
}

export interface ICreateCheckResponse {
    check: ICheck;
    checklist: IChecklist;  // The report's checklist with the new manual rule added
    report?: { report: IReport };  // Full report with the new check
}

export interface IDeleteCheckResponse {
    // Check deletion returns no content (204)
}
