import type { HTMLAttributes } from 'react';
import { cx } from '../../utils/cx';
import styles from './Card.module.css';

type CardElement = 'div' | 'section' | 'article' | 'li';

export type CardProps = HTMLAttributes<HTMLElement> & {
  /** Element to render — lets cards sit inside semantic lists or sections. */
  as?: CardElement;
  padding?: 'none' | 'md' | 'lg';
  elevation?: 'none' | 'soft' | 'card';
};

/**
 * White rounded surface with a soft shadow — the base of every card in the
 * app (DESIGN_SPEC §10 rules 2, 3 and 4).
 */
export function Card({
  as: Element = 'div',
  padding = 'lg',
  elevation = 'card',
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <Element
      {...rest}
      className={cx(
        styles.card,
        styles[`padding-${padding}`],
        styles[`elevation-${elevation}`],
        className,
      )}
    >
      {children}
    </Element>
  );
}
