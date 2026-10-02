import { Link } from 'react-router-dom';
import Icon from './Icon';

// The page's breadcrumb and its only way back (docs/ui-guideline.md §2.3):
// Beranda › … › current page. Phones show just the way back to the parent.
// A crumb with no `to` is a label without a page of its own. A crumb with
// `data: true` is a record's own name (never translated by the language switch).
export default function PageTrail({ trail = [] }) {
  if (!trail.length) return null;
  const parent = trail.slice(0, -1).reverse().find((item) => item.to) || { label: 'Beranda', to: '/' };
  const last = trail.length - 1;
  const zone = (item) => (item.data ? { 'data-no-translate': '' } : null);
  return (
    <nav className="prakasa-trail" aria-label="Lokasi halaman">
      <ol className="prakasa-trail__list">
        <li className="prakasa-trail__step"><Link to="/">Beranda</Link></li>
        {trail.map((item, index) => (
          <li className="prakasa-trail__step" key={`${item.to || item.label}-${index}`}>
            <Icon name="chevron_right" size="sm" className="prakasa-trail__sep" />
            {index === last
              ? <span className="prakasa-trail__current" aria-current="page" {...zone(item)}>{item.label}</span>
              : item.to ? <Link to={item.to} {...zone(item)}>{item.label}</Link> : <span {...zone(item)}>{item.label}</span>}
          </li>
        ))}
      </ol>
      <Link className="prakasa-trail__back" to={parent.to}>
        <Icon name="arrow_back" size="sm" />
        <span {...zone(parent)}>{parent.label}</span>
      </Link>
    </nav>
  );
}
