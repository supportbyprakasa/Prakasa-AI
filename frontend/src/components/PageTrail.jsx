import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';

export default function PageTrail({ trail = [] }) {
  if (!trail.length) return null;
  const parent = trail.length > 1 ? trail[trail.length - 2].to : '/';
  return (
    <div className="prakasa-subnav">
      <Link className="prakasa-navbar__back" to={parent}><ArrowLeft size={15} /> Kembali</Link>
      <span className="prakasa-navbar__divider" aria-hidden="true" />
      <nav className="prakasa-navbar__trail" aria-label="Lokasi halaman">
        <Link to="/">Home</Link>
        {trail.map((item, index) => <span className="prakasa-navbar__trail-step" key={`${item.to}-${index}`}>
          <ChevronRight size={11} aria-hidden="true" />
          {index === trail.length - 1 ? <strong aria-current="page">{item.label}</strong> : <Link to={item.to}>{item.label}</Link>}
        </span>)}
      </nav>
    </div>
  );
}
