import { createPatch } from 'diff';
import type { IPageDiff, IPageText } from '@revdoku/lib';

export function computePageDiffs(previous: IPageText[], current: IPageText[]): IPageDiff[] {
  const prevMap = new Map(previous.map(p => [p.page, p.text]));
  const allPages = new Set([...previous.map(p => p.page), ...current.map(p => p.page)]);

  return Array.from(allPages).sort((a, b) => a - b).map(page => {
    const oldText = prevMap.get(page) || '';
    const newText = current.find(p => p.page === page)?.text || '';
    const diff = createPatch(`page-${page}`, oldText, newText, 'previous', 'current');
    const has_changes = oldText !== newText;
    return { page, diff, has_changes };
  });
}
