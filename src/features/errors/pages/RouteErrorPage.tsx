import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { ROUTES } from '../../../app/routes';
import { Button } from '../../../components/common/Button';
import { EmptyState } from '../../../components/common/EmptyState';
import { ShieldCheckIcon } from '../../../components/common/icons';
import styles from './ErrorPages.module.css';

function describe(error: unknown): string {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`;
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred.';
}

/**
 * Last line of defence: a render error anywhere in the tree lands here instead
 * of leaving a blank page. Rendered outside the shell because the shell itself
 * may be what failed.
 */
export function RouteErrorPage() {
  const error = useRouteError();

  return (
    <div className={styles.standalone}>
      <div className={styles.content}>
        <EmptyState
          icon={<ShieldCheckIcon size={26} />}
          title="Something went wrong"
          description="The page failed to load. Your saved trips are untouched — they live in this browser."
          action={
            <Button to={ROUTES.planner} variant="primary" size="md" reloadDocument>
              Reload the app
            </Button>
          }
        />

        <p className={styles.detail}>{describe(error)}</p>
      </div>
    </div>
  );
}
