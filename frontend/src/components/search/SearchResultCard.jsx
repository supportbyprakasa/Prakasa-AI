import { useNavigate } from 'react-router-dom';
import {
  FileText, CheckSquare, Users, TrendingUp, CalendarDays,
  MonitorSmartphone, AppWindow, Wallet, UserRound, BookOpen,
  ScrollText, CheckCircle, PenTool, Circle,
} from 'lucide-react';
import Card from '../Card';
import Badge from '../Badge';

const TYPE_META = {
  document: { label: 'Dokumen', icon: FileText, tone: 'default' },
  task: { label: 'Task', icon: CheckSquare, tone: 'info' },
  customer: { label: 'Customer', icon: Users, tone: 'default' },
  sales_pipeline: { label: 'Pipeline', icon: TrendingUp, tone: 'info' },
  meeting: { label: 'Meeting', icon: CalendarDays, tone: 'default' },
  device: { label: 'Device', icon: MonitorSmartphone, tone: 'default' },
  subscription: { label: 'Subscription', icon: AppWindow, tone: 'default' },
  finance_workflow: { label: 'Finance', icon: Wallet, tone: 'success' },
  hrga_workflow: { label: 'HRGA', icon: UserRound, tone: 'info' },
  kb_document: { label: 'Knowledge Base', icon: BookOpen, tone: 'default' },
  decision_log: { label: 'Decision', icon: ScrollText, tone: 'default' },
  approval_request: { label: 'Approval', icon: CheckCircle, tone: 'warning' },
  signature_request: { label: 'Signature', icon: PenTool, tone: 'warning' },
};

/**
 * Safe internal path check — trust backend, but re-verify defensively.
 */
function safeInternalPath(url) {
  if (typeof url !== 'string') return null;
  const s = url.trim();
  if (!s.startsWith('/')) return null;
  if (s.startsWith('//')) return null;
  if (s.includes('://')) return null;
  return s;
}

/**
 * Render meta safely — only whitelisted keys.
 */
function renderMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const safe = [];
  if (meta.priority) safe.push(['priority', meta.priority]);
  if (meta.dueDate) safe.push(['due', meta.dueDate]);
  if (meta.city) safe.push(['kota', meta.city]);
  if (meta.stage) safe.push(['stage', meta.stage]);
  if (meta.deviceType) safe.push(['tipe', meta.deviceType]);
  if (meta.renewalDate) safe.push(['renewal', meta.renewalDate]);
  if (meta.currency) safe.push(['mata uang', meta.currency]);
  if (meta.workflowType) safe.push(['workflow', meta.workflowType]);
  if (meta.category) safe.push(['kategori', meta.category]);
  if (meta.visibility) safe.push(['visibilitas', meta.visibility]);

  if (!safe.length) return null;
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
      {safe.map(([k, v]) => (
        <span key={k} style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {k}: <b>{String(v)}</b>
        </span>
      ))}
    </div>
  );
}

export default function SearchResultCard({ result }) {
  const nav = useNavigate();
  const meta = TYPE_META[result.type] || { label: result.type, icon: Circle, tone: 'default' };
  const Icon = meta.icon;

  const target = safeInternalPath(result.actionUrl);
  const clickable = !!target;

  const onClick = () => {
    if (!clickable) return;
    nav(target);
  };

  return (
    <div
      onClick={onClick}
      style={{
        cursor: clickable ? 'pointer' : 'default',
        opacity: clickable ? 1 : 0.85,
      }}
    >
      <Card>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, flexShrink: 0,
            background: '#f1f5f9',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--color-text-muted)',
          }}>
            <Icon size={18} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div style={{
                fontSize: 14, fontWeight: 600,
                overflow: 'hidden', textOverflow: 'ellipsis',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              }}>
                {result.title}
              </div>
              <Badge tone={meta.tone}>{meta.label}</Badge>
            </div>

            {result.subtitle && (
              <div style={{
                fontSize: 12, color: 'var(--color-text-muted)',
                marginTop: 2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {result.subtitle}
              </div>
            )}

            {renderMeta(result.meta)}

            <div style={{
              display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap',
              fontSize: 11, color: 'var(--color-text-muted)',
            }}>
              {result.status && <span>Status: <b>{result.status}</b></span>}
              {result.createdAt && <span>{new Date(result.createdAt).toLocaleDateString('id-ID')}</span>}
              {result.entityId != null && <span>Entity #{result.entityId}</span>}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}