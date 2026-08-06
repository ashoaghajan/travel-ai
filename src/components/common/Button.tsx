import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LinkProps } from 'react-router-dom';
import { cx } from '../../utils/cx';
import styles from './Button.module.css';

export type ButtonVariant =
  /** Purple call to action — DESIGN_SPEC §4: "Primary buttons must use purple." */
  | 'primary'
  /** Muted surface button for secondary actions on light backgrounds. */
  | 'secondary'
  /** Semi-transparent button for use on photography and dark overlays. */
  | 'glass'
  /** Destructive confirmation, e.g. deleting a saved trip. */
  | 'danger';

export type ButtonSize = 'md' | 'lg';

type BaseProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  className?: string;
  children: ReactNode;
};

type ButtonAsButton = BaseProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof BaseProps> & {
    /** Omit both `to` and `href` to render a native `<button>`. */
    to?: never;
    href?: never;
  };

type ButtonAsLink = BaseProps &
  Omit<LinkProps, keyof BaseProps | 'to'> & {
    /** Providing `to` renders a router `<Link>` styled as a button. */
    to: LinkProps['to'];
    href?: never;
  };

type ButtonAsAnchor = BaseProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof BaseProps | 'href'> & {
    /** Providing `href` renders a plain `<a>` — for destinations off the app. */
    href: string;
    to?: never;
  };

export type ButtonProps = ButtonAsButton | ButtonAsLink | ButtonAsAnchor;

/**
 * The single button primitive for the app. Renders a `<button>`, a router
 * `<Link>` (`to`) or a plain `<a>` (`href`, for somewhere outside the app), so
 * navigation stays semantic without duplicating styles.
 */
export function Button(props: ButtonProps) {
  const {
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    leadingIcon,
    trailingIcon,
    className,
    children,
  } = props;

  const rootClassName = cx(
    styles.button,
    styles[variant],
    styles[size],
    fullWidth && styles.fullWidth,
    className,
  );

  const content = (
    <>
      {leadingIcon ? <span className={styles.icon}>{leadingIcon}</span> : null}
      <span className={styles.label}>{children}</span>
      {trailingIcon ? <span className={styles.icon}>{trailingIcon}</span> : null}
    </>
  );

  if (props.href !== undefined) {
    const {
      variant: _variant,
      size: _size,
      fullWidth: _fullWidth,
      leadingIcon: _leadingIcon,
      trailingIcon: _trailingIcon,
      className: _className,
      children: _children,
      to: _to,
      // Outbound links open away from the app — the house convention, matching
      // the photo credits on activity cards.
      target = '_blank',
      rel = 'noreferrer nofollow',
      ...anchorProps
    } = props;

    return (
      <a {...anchorProps} target={target} rel={rel} className={rootClassName}>
        {content}
      </a>
    );
  }

  if (props.to !== undefined) {
    const {
      variant: _variant,
      size: _size,
      fullWidth: _fullWidth,
      leadingIcon: _leadingIcon,
      trailingIcon: _trailingIcon,
      className: _className,
      children: _children,
      href: _href,
      ...linkProps
    } = props;

    return (
      <Link {...linkProps} className={rootClassName}>
        {content}
      </Link>
    );
  }

  const {
    variant: _variant,
    size: _size,
    fullWidth: _fullWidth,
    leadingIcon: _leadingIcon,
    trailingIcon: _trailingIcon,
    className: _className,
    children: _children,
    to: _to,
    href: _href,
    type = 'button',
    ...buttonProps
  } = props;

  return (
    <button {...buttonProps} type={type} className={rootClassName}>
      {content}
    </button>
  );
}
