import { Link, Navigate, useParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useNavConfig } from '../components/Sidebar';
import { divisions, visibleSections } from '../components/navigation';

const descriptions = {
  documents: 'Kelola dokumen, task, persetujuan, tanda tangan, dan kolaborasi tim.',
  sales: 'Pipeline penjualan, data customer, sample request, field bot, dan operasional gudang.',
  it: 'Perangkat, langganan software, dan operasional teknologi.',
  finance: 'Permintaan pembayaran dan alur kerja tim HRGA.',
  advanced: 'Workspace lintas divisi, insight, pengetahuan, dan otomasi.',
  admin: 'Kelola pengguna, akses, data induk, dan konfigurasi sistem.',
};

const groups = {
  documents: [
    ['KERJA & TIM', '/tasks', '/chat', '/meetings'],
    ['PERSETUJUAN & TANDA TANGAN', '/approvals', '/signatures', '/signatures/asset'],
    ['DOKUMEN', '/documents', '/templates'],
    ['FORMULIR & WORKFLOW', '/forms', '/forms/submissions'],
  ],
  advanced: [
    ['INSIGHT', '/brief', '/management', '/timeline'],
    ['PENGETAHUAN & OTOMASI', '/kb', '/automation', '/decision-log'],
    ['RUANG KERJA', '/workspaces', '/workspaces-cross', '/data-classification'],
  ],
  admin: [
    ['IDENTITAS & AKSES', '/admin/users', '/admin/entities', '/admin/departments', '/admin/roles', '/admin/permissions'],
    ['ATURAN APPROVAL & SIGNATURE', '/admin/approval-matrix', '/admin/approval-delegations', '/admin/signature-rules', '/admin/signature-precheck'],
    ['FORMULIR & WORKFLOW', '/admin/forms', '/admin/workflows', '/admin/document-types', '/admin/folder-rules'],
    ['SISTEM', '/admin/dashboard-layouts', '/admin/integration-logs', '/admin/ai-usage', '/activity-logs'],
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
  const moduleGroups = groups[slug]
    ? groups[slug].map(([title, ...paths]) => ({ title, items: paths.map((path) => items.find((item) => item.to === path)).filter(Boolean) })).filter((group) => group.items.length)
    : [{ title: 'MODUL', items }];
  return <div className="hub-division fade-in">
    <div className="hub-division__heading"><span className="hub-division__mark"><Icon size={22} strokeWidth={1.6} /></span><div><h1>{division.title}</h1><p>{descriptions[slug]}</p></div></div>
    {moduleGroups.map((group) => <section className="hub-module-section" key={group.title}>
      <h2>{group.title}</h2>
      <div className="hub-module-grid">{group.items.map((item) => {
        const ItemIcon = item.icon;
        return <Link className="hub-module-card" key={item.to} to={item.to}>
          <span className="hub-icon"><ItemIcon size={20} strokeWidth={1.6} /></span>
          <span className="hub-module-card__copy"><strong>{item.label}</strong><small>{item.description || `Buka ${item.label} di Prakasa Work OS.`}</small><em>{item.to}</em></span>
          <ChevronRight className="hub-module-card__arrow" size={16} />
        </Link>;
      })}</div>
    </section>)}
  </div>;
}
