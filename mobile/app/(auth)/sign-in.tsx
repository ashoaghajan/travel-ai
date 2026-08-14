import { SignInScreen } from '../../src/features/auth/SignInScreen';

/**
 * The only route outside the shell.
 *
 * The screen itself lives under `src/features/auth/` rather than here, so the
 * route file stays a route and the component stays testable without a router
 * — the same split `src/app/routeTable.tsx` makes on the web.
 */
export default SignInScreen;
