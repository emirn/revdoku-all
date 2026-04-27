import type { ITag } from '@revdoku/lib';

export interface TagTreeNode {
  tag: ITag;
  children: TagTreeNode[];
  depth: number;
}

/**
 * Build a tree from a flat list of tags using parent_id references.
 * Tags whose parent_id is not in the list are treated as roots (defensive).
 */
export function buildTagTree(tags: ITag[]): TagTreeNode[] {
  const tagMap = new Map<string, ITag>();
  tags.forEach(t => tagMap.set(t.id, t));

  const childrenMap = new Map<string, ITag[]>();
  const roots: ITag[] = [];

  tags.forEach(tag => {
    if (tag.parent_id && tagMap.has(tag.parent_id)) {
      const siblings = childrenMap.get(tag.parent_id) || [];
      siblings.push(tag);
      childrenMap.set(tag.parent_id, siblings);
    } else {
      roots.push(tag);
    }
  });

  function buildNode(tag: ITag, depth: number): TagTreeNode {
    const childTags = (childrenMap.get(tag.id) || []).sort((a, b) => a.name.localeCompare(b.name));
    return {
      tag,
      children: childTags.map(c => buildNode(c, depth + 1)),
      depth,
    };
  }

  return roots.sort((a, b) => a.name.localeCompare(b.name)).map(r => buildNode(r, 0));
}

/**
 * Get the set of IDs for a tag and all its descendants.
 */
export function getSelfAndDescendantIds(tags: ITag[], rootId: string): Set<string> {
  const childrenMap = new Map<string, string[]>();
  tags.forEach(tag => {
    if (tag.parent_id) {
      const siblings = childrenMap.get(tag.parent_id) || [];
      siblings.push(tag.id);
      childrenMap.set(tag.parent_id, siblings);
    }
  });

  const result = new Set<string>();

  function collect(id: string) {
    result.add(id);
    const children = childrenMap.get(id);
    if (children) {
      children.forEach(collect);
    }
  }

  collect(rootId);
  return result;
}

/**
 * Get the set of ancestor IDs for a given tag (for auto-expanding).
 */
export function getAncestorIds(tags: ITag[], tagId: string): Set<string> {
  const parentMap = new Map<string, string>();
  tags.forEach(t => {
    if (t.parent_id) parentMap.set(t.id, t.parent_id);
  });

  const result = new Set<string>();
  let current = parentMap.get(tagId);
  while (current) {
    result.add(current);
    current = parentMap.get(current);
  }
  return result;
}
