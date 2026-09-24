import { Link, Navigate, useParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useNavConfig } from '../components/Sidebar';
import { divisions, visibleSections } from '../components/navigation';

const groups = {
  kerja: [
    ['KERJA & TIM', '/tasks', '/chat', '/meetings'],
    ['PERSETUJUAN & TANDA TANGAN', '/approvals', '/admin/approval-delegations', '/signatures', '/signatures/asset'],
    ['DOKUMEN & FORMULIR', '/documents', '/templates', '/forms', '/forms/submissions'],
  ],
  admin: [
    ['IDENTITAS & AKSES', '/admin/users', '/admin/entities', '/admin/departments', '/admin/roles', '/admin/permissions'],
    ['ATURAN APPROVAL & SIGNATURE', '/admin/approval-matrix', '/admin/signature-rules', '/admin/signature-precheck'],
    ['FORMULIR & DOKUMEN', '/admin/forms', '/admin/document-types', '/admin/folder-rules'],
    ['SISTEM', '/admin/dashboard-layouts', '/admin/integration-logs', '/admin/ai-usage', '/admin/ai-provider-settings'],
  ],
};

export default function DivisionHub() {
  const { slug } = useParams();
  const sections = useNavConfig();
  const division = divisions.find((entry) => entry.slug === slug && slug !== 'ai');
  if (!division) return <Navigate to="/" replace />;
  const accessible = visibleSections(division, sections);
  if (!accessible.length) return <Navigate to="/" replace />;
  const Icon = division.icon;
  const items = accessible.flatMap((section) => section.items);
  if (items.length === 1) return <Navigate to={items[0].to} replace />;
  const moduleGroups = groups[slug]
    ? groups[slug].map(([title, ...paths]) => ({ title, items: paths.map((path) => items.find((item) => item.to === path)).filter(Boolean) })).filter((group) => group.items.length)
    : [{ title: 'MODUL', items }];
  return <div className="hub-division fade-in">
    <div className="hub-division__heading"><span className="hub-division__mark"><Icon size={22} strokeWidth={1.6} /></span><div><h1>{division.title}</h1><p>{division.summary}</p></div></div>
    {moduleGroups.map((group) => <section className="hub-module-section" key={group.title}>
      <h2>{group.title}</h2>
      <div className="hub-module-grid">{group.items.map((item) => {
        const ItemIcon = item.icon;
        return <Link className="hub-module-card" key={item.to} to={item.to}>
          <span className="hub-icon"><ItemIcon size={20} strokeWidth={1.6} /></span>
          <span className="hub-module-card__copy"><strong>{item.label}</strong><small>{item.description || `Buka ${item.label} di Prakasa Workspace.`}</small><em>{item.to}</em></span>
          <ChevronRight className="hub-module-card__arrow" size={16} />
        </Link>;
      })}</div>
    </section>)}
  </div>;
}
