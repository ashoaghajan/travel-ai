import type { ReactNode } from 'react';
import { Card } from '../../../components/common/Card';
import styles from './SettingsSection.module.css';

export type SettingsSectionProps = {
  title: string;
  description?: string;
  children: ReactNode;
};

/** One titled card of related preferences, for consistent spacing. */
export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <Card as="section" padding="lg" elevation="soft" className={styles.section}>
      <header className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        {description ? <p className={styles.description}>{description}</p> : null}
      </header>

      <div className={styles.body}>{children}</div>
    </Card>
  );
}
