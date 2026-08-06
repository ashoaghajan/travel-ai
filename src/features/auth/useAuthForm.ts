import { useCallback, useMemo, useState } from 'react';
import { authStore } from '../../store/auth.store';
import { describeAuthError } from './auth.messages';
import { hasErrors, validateSignIn, validateSignUp } from './auth.form';
import type { AuthErrors, SignInDraft, SignUpDraft } from './auth.form';

/**
 * State for the sign-in and sign-up forms.
 *
 * Follows `useCreateTrip`: one piece of state holding the whole draft,
 * validation derived on every keystroke but kept quiet until the first submit
 * attempt, and a `saveError` carrying a finished sentence rather than an
 * exception.
 */

export type AuthFormState<Draft> = {
  draft: Draft;
  setField: <Field extends keyof Draft>(field: Field, value: Draft[Field]) => void;
  errors: AuthErrors;
  /** True once a submit has been attempted — errors stay quiet until then. */
  hasAttemptedSubmit: boolean;
  isSubmitting: boolean;
  submitError: string | null;
  /** Resolves true when the session opened, false when it did not. */
  submit: () => Promise<boolean>;
};

function useAuthForm<Draft extends SignInDraft>(
  initial: Draft,
  validate: (draft: Draft) => AuthErrors,
  send: (draft: Draft) => Promise<unknown>,
): AuthFormState<Draft> {
  const [draft, setDraft] = useState<Draft>(initial);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const errors = useMemo(() => validate(draft), [validate, draft]);

  const setField = useCallback(<Field extends keyof Draft>(field: Field, value: Draft[Field]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    // A stale server error next to freshly typed input reads as if the new
    // attempt already failed.
    setSubmitError(null);
  }, []);

  const submit = useCallback(async (): Promise<boolean> => {
    setHasAttemptedSubmit(true);

    if (hasErrors(validate(draft))) return false;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await send(draft);
      return true;
    } catch (caught) {
      setSubmitError(describeAuthError(caught));
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [draft, send, validate]);

  return { draft, setField, errors, hasAttemptedSubmit, isSubmitting, submitError, submit };
}

export function useSignInForm(): AuthFormState<SignInDraft> {
  return useAuthForm(
    { email: '', password: '' },
    validateSignIn,
    useCallback(
      (draft: SignInDraft) =>
        authStore.signIn({ email: draft.email.trim(), password: draft.password }),
      [],
    ),
  );
}

export function useSignUpForm(): AuthFormState<SignUpDraft> {
  return useAuthForm(
    { name: '', email: '', password: '' },
    validateSignUp,
    useCallback(
      (draft: SignUpDraft) =>
        authStore.signUp({
          name: draft.name.trim(),
          email: draft.email.trim(),
          password: draft.password,
        }),
      [],
    ),
  );
}
