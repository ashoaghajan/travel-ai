import type { ReactNode } from 'react';
import { Card } from '../common/Card';
import { cx } from '../../utils/cx';
import styles from './FeatureCard.module.css';

export type FeatureCardProps = {
  icon: ReactNode;
  title: string;
  description: string;
  /** Render inside a `<ul>` when the cards form a list. */
  as?: 'div' | 'li';
  className?: string;
};

/**
 * White card with a small purple icon, a title and one supporting line
 * (DESIGN_SPEC Screen 1: "Feature cards should be white with small purple icons").
 */
export function FeatureCard({ icon, title, description, as = 'div', className }: FeatureCardProps) {
  return (
    <Card as={as} padding="lg" elevation="card" className={cx(styles.card, className)}>
      <span className={styles.icon}>{icon}</span>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.description}>{description}</p>
    </Card>
  );
}
