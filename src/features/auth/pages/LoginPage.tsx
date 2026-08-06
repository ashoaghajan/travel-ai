import { useId } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ROUTES } from '../../../app/routes';
import { Button } from '../../../components/common/Button';
import { useSignInForm } from '../useAuthForm';
import { FederatedSignIn } from '../components/FederatedSignIn';
import { safeNextPath } from '../next-path';
import { AuthLayout } from './AuthLayout';
import styles from './AuthPage.module.css';

/** Sign in to an existing account. */
export function LoginPage() {
  const fieldId = useId();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { draft, setField, errors, hasAttemptedSubmit, isSubmitting, submitError, submit } =
    useSignInForm();

  // Errors stay quiet until the first attempt — nobody wants to be told their
  // email is wrong while they are still typing it.
  const showErrors = hasAttemptedSubmit;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (await submit()) {
      // `replace` so Back does not return to a login form the user has
      // already passed through.
      navigate(safeNextPath(searchParams.get('next')), { replace: true });
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to reach your trips from anywhere."
      footer={
        <>
          New here?{' '}
          <Link className={styles.switchLink} to={ROUTES.register}>
            Create an account
          </Link>
        </>
      }
    >
      <FederatedSignIn text="signin_with" disabled={isSubmitting} />

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${fieldId}-email`}>
            Email
          </label>
          <input
            id={`${fieldId}-email`}
            className={styles.control}
            type="email"
            autoComplete="email"
            value={draft.email}
            onChange={(event) => setField('email', event.target.value)}
            disabled={isSubmitting}
            aria-invalid={showErrors && Boolean(errors.email)}
            aria-describedby={
              showErrors && errors.email ? `${fieldId}-email-error` : undefined
            }
          />
          {showErrors && errors.email ? (
            <p id={`${fieldId}-email-error`} className={styles.fieldError}>
              {errors.email}
            </p>
          ) : null}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${fieldId}-password`}>
            Password
          </label>
          <input
            id={`${fieldId}-password`}
            className={styles.control}
            type="password"
            autoComplete="current-password"
            value={draft.password}
            onChange={(event) => setField('password', event.target.value)}
            disabled={isSubmitting}
            aria-invalid={showErrors && Boolean(errors.password)}
            aria-describedby={
              showErrors && errors.password ? `${fieldId}-password-error` : undefined
            }
          />
          {showErrors && errors.password ? (
            <p id={`${fieldId}-password-error`} className={styles.fieldError}>
              {errors.password}
            </p>
          ) : null}
        </div>

        {submitError ? (
          <p className={styles.error} role="alert">
            {submitError}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          className={styles.submit}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
}
