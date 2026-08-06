import { useLocation } from 'react-router-dom';
import { ROUTES } from '../../../app/routes';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Button } from '../../../components/common/Button';
import { EmptyState } from '../../../components/common/EmptyState';
import { CompassIcon } from '../../../components/common/icons';
import styles from './ErrorPages.module.css';

/**
 * Unmatched URL. Rendered inside the shell so navigation stays available
 * instead of dumping the user back on the marketing page.
 */
export function NotFoundPage() {
  const { pathname } = useLocation();

  return (
    <div className={styles.page}>
      <PageHeader title="Page not found" />

      <div className={styles.content}>
        <EmptyState
          icon={<CompassIcon size={26} />}
          title="We couldn't find that page"
          description={`Nothing lives at ${pathname}. It may have moved, or the link may be out of date.`}
          action={
            <Button to={ROUTES.planner} variant="primary" size="md">
              Back to the planner
            </Button>
          }
        />
      </div>
    </div>
  );
}
