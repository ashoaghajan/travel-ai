/**
 * Joins class names, dropping anything falsy.
 * Keeps CSS Module composition readable without pulling in a dependency.
 */
export function cx(...classNames: Array<string | false | null | undefined>): string {
  return classNames.filter(Boolean).join(' ');
}
