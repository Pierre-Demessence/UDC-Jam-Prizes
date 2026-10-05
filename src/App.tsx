import { useEffect, useState } from 'react';

import { Admin } from '@/admin/Admin';
import { Gallery } from '@/gallery/Gallery';

type Route = 'admin' | 'gallery';

function routeFor(pathname: string): Route {
  return pathname === '/admin' || pathname.startsWith('/admin/') ? 'admin' : 'gallery';
}

/** Two screens, two URLs; the server serves the same HTML for both. */
export function App() {
  const [route, setRoute] = useState<Route>(() => routeFor(window.location.pathname));

  useEffect(() => {
    function onNavigate(): void {
      setRoute(routeFor(window.location.pathname));
    }

    window.addEventListener('popstate', onNavigate);
    return () => window.removeEventListener('popstate', onNavigate);
  }, []);

  return route === 'admin' ? <Admin /> : <Gallery />;
}
