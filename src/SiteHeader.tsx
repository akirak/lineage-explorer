import { Link, useSearch } from '@tanstack/react-router';
import { Network, Rows3 } from 'lucide-react';

/** Global navigation shared by every page. */
export default function SiteHeader() {
  // Forward the current query parameters when switching views. The target
  // route's common search schema keeps the shared filters and drops the rest.
  const search = useSearch({ strict: false });

  return (
    <header className="topbar">
      <h1>Lineage explorer</h1>
      <nav className="nav" aria-label="Views">
        <Link
          to="/"
          search={search}
          className="nav-link"
          activeProps={{ className: 'on' }}
          activeOptions={{ exact: true }}
        >
          <Network size={16} aria-hidden="true" />
          Graph
        </Link>
        <Link to="/nodes" search={search} className="nav-link" activeProps={{ className: 'on' }}>
          <Rows3 size={16} aria-hidden="true" />
          Nodes
        </Link>
      </nav>
    </header>
  );
}
