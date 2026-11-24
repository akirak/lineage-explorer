import { Link } from '@tanstack/react-router';
import { Network, Rows3 } from 'lucide-react';

/** Global navigation shared by every page. */
export default function SiteHeader() {
  return (
    <header className="topbar">
      <h1>Lineage explorer</h1>
      <nav className="nav" aria-label="Views">
        <Link to="/" className="nav-link" activeProps={{ className: 'on' }} activeOptions={{ exact: true }}>
          <Network size={16} aria-hidden="true" />
          Graph
        </Link>
        <Link to="/nodes" className="nav-link" activeProps={{ className: 'on' }}>
          <Rows3 size={16} aria-hidden="true" />
          Nodes
        </Link>
      </nav>
    </header>
  );
}
