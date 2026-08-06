import { RouterProvider } from 'react-router-dom';
import { AuthBootstrap } from './AuthBootstrap';
import { router } from './router';
import { useAppliedTheme } from './useAppliedTheme';

export default function App() {
  // Above the router, because the theme is a property of the document rather
  // than of any one route.
  useAppliedTheme();

  // Outside the router: the session has to be known before the first route
  // renders, or every reload flashes past the guard to the login page.
  return (
    <AuthBootstrap>
      <RouterProvider router={router} />
    </AuthBootstrap>
  );
}
