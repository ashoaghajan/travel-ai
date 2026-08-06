import { createBrowserRouter } from 'react-router-dom';
import { routes } from './routeTable';

/** The browser instance. The route table itself lives in `routeTable.tsx`. */
export const router = createBrowserRouter(routes);
