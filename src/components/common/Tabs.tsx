import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { cx } from '../../utils/cx';
import { tabId, tabPanelId } from './tabs.helpers';
import styles from './Tabs.module.css';

export type TabItem<Id extends string = string> = {
  id: Id;
  label: string;
};

export type TabsProps<Id extends string = string> = {
  items: readonly TabItem<Id>[];
  activeId: Id;
  onChange: (id: Id) => void;
  /** Prefix for tab/panel ids so `aria-controls` can find the panel. */
  idPrefix: string;
  /** Accessible name for the tab list. */
  label: string;
  className?: string;
};

/**
 * Controlled tab list with roving arrow-key navigation. Panels are rendered by
 * the caller — pair them with `tabPanelId()` and `role="tabpanel"`.
 */
export function Tabs<Id extends string = string>({
  items,
  activeId,
  onChange,
  idPrefix,
  label,
  className,
}: TabsProps<Id>) {
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function focusTab(index: number) {
    const item = items[(index + items.length) % items.length];
    if (!item) return;

    onChange(item.id);
    tabRefs.current[item.id]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>, index: number) {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusTab(index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusTab(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusTab(0);
        break;
      case 'End':
        event.preventDefault();
        focusTab(items.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div className={cx(styles.tabs, className)} role="tablist" aria-label={label}>
      {items.map((item, index) => {
        const isActive = item.id === activeId;

        return (
          <button
            key={item.id}
            ref={(element) => {
              tabRefs.current[item.id] = element;
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, item.id)}
            aria-selected={isActive}
            aria-controls={tabPanelId(idPrefix, item.id)}
            tabIndex={isActive ? 0 : -1}
            className={cx(styles.tab, isActive && styles.active)}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
