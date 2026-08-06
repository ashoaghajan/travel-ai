import type { ReactNode } from 'react';
import { Card } from './Card';
import { cx } from '../../utils/cx';
import styles from './EmptyState.module.css';

export type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  /** Optional call to action, typically a `Button`. */
  action?: ReactNode;
  className?: string;
};

/** Shared empty state (DESIGN_SPEC rule 18). */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <Card padding="lg" elevation="soft" className={cx(styles.empty, className)}>
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      <h3 className={styles.title}>{title}</h3>
      {description ? <p className={styles.description}>{description}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </Card>
  );
}
