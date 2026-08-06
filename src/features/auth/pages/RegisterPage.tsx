import { useId } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ROUTES } from '../../../app/routes';
import { Button } from '../../../components/common/Button';
import { MIN_PASSWORD_LENGTH } from '../auth.form';
import { useSignUpForm } from '../useAuthForm';
import { FederatedSignIn } from '../components/FederatedSignIn';
import { safeNextPath } from '../next-path';
import { AuthLayout } from './AuthLayout';
import styles from './AuthPage.module.css';

/** Open a new account. */
export function RegisterPage() {
  const fieldId = useId();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { draft, setField, errors, hasAttemptedSubmit, isSubmitting, submitError, submit } =
    useSignUpForm();

  const showErrors = hasAttemptedSubmit;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (await submit()) {
      navigate(safeNextPath(searchParams.get('next')), { replace: true });
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Save your trips and pick them up on any device."
      footer={
        <>
          Already have an account?{' '}
          <Link className={styles.switchLink} to={ROUTES.login}>
            Sign in
          </Link>
        </>
      }
    >
      <FederatedSignIn text="signup_with" disabled={isSubmitting} />

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${fieldId}-name`}>
            Name
          </label>
          <input
            id={`${fieldId}-name`}
            className={styles.control}
            type="text"
            autoComplete="name"
            value={draft.name}
            onChange={(event) => setField('name', event.target.value)}
            disabled={isSubmitting}
            aria-invalid={showErrors && Boolean(errors.name)}
            aria-describedby={showErrors && errors.name ? `${fieldId}-name-error` : undefined}
          />
          {showErrors && errors.name ? (
            <p id={`${fieldId}-name-error`} className={styles.fieldError}>
              {errors.name}
            </p>
          ) : null}
        </div>

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
            aria-describedby={showErrors && errors.email ? `${fieldId}-email-error` : undefined}
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
            autoComplete="new-password"
            value={draft.password}
            onChange={(event) => setField('password', event.target.value)}
            disabled={isSubmitting}
            aria-invalid={showErrors && Boolean(errors.password)}
            aria-describedby={
              showErrors && errors.password ? `${fieldId}-password-error` : `${fieldId}-password-hint`
            }
          />
          {showErrors && errors.password ? (
            <p id={`${fieldId}-password-error`} className={styles.fieldError}>
              {errors.password}
            </p>
          ) : (
            <p id={`${fieldId}-password-hint`} className={styles.hint}>
              At least {MIN_PASSWORD_LENGTH} characters. Length beats punctuation.
            </p>
          )}
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
          {isSubmitting ? 'Creating your account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
