/**
 * Permission checking utilities
 */

/**
 * Check if a permission object has a specific permission
 */
export function canPerform(permissions: Record<string, boolean | undefined>, permission: string): boolean {
  return permissions[permission] === true;
}

/**
 * Check if a permission object has any of the specified permissions
 */
export function canPerformAny(permissions: Record<string, boolean>, permissionList: string[]): boolean {
  return permissionList.some(permission => permissions[permission] === true);
}

/**
 * Check if a permission object has all of the specified permissions
 */
export function canPerformAll(permissions: Record<string, boolean>, permissionList: string[]): boolean {
  return permissionList.every(permission => permissions[permission] === true);
}
