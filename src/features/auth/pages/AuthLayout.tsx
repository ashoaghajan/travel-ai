import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '../../../app/routes';
import { Card } from '../../../components/common/Card';
import { Logo } from '../../../components/common/Logo';
import styles from './AuthPage.module.css';

export type AuthLayoutProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  /** The "no account yet?" line under the card. */
  footer: ReactNode;
};

/**
 * The frame both auth screens share.
 *
 * These pages sit outside `AppShell` — there is no sidebar to render for
 * someone who is not signed in — so, like the landing page, they carry their
 * own header and `main` landmark.
 */
export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to={ROUTES.landing} className={styles.brandLink} aria-label="AI Travel, home">
          <Logo size="lg" />
        </Link>
      </header>

      <main id="main-content" tabIndex={-1} className={styles.main}>
        <Card padding="lg" elevation="card" className={styles.card}>
          <h1 className={styles.heading}>{title}</h1>
          <p className={styles.subheading}>{subtitle}</p>

          {children}

          <p className={styles.switch}>{footer}</p>
        </Card>
      </main>
    </div>
  );
}
