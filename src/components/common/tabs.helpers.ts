/**
 * Id builders shared by `Tabs` and the panels its callers render, so
 * `aria-controls` and `aria-labelledby` always line up.
 */

export function tabId(idPrefix: string, id: string): string {
  return `${idPrefix}-tab-${id}`;
}

export function tabPanelId(idPrefix: string, id: string): string {
  return `${idPrefix}-panel-${id}`;
}
