import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import Avatar from '../../components/Avatar';
import Button from '../../components/Button';
import Card from '../../components/Card';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import StatusBadge from '../../components/StatusBadge';
import { formatNumber } from '../../components/format';
import { Mixed, data } from '../../i18n/NoTranslate';
import { orgForest, personMarks } from './directoryModel';

function OrgNode({ node, linkTo }) {
  const marks = personMarks(node, false);
  const managerLine = node.managerOutside && node.managerName ? `atasan: ${node.managerName}` : null;
  const meta = node.position || managerLine ? <Mixed parts={[data(node.position), managerLine]} /> : null;
  return (
    <li className="people-org__node">
      <Link className="people-org__person pw-state-layer" to={linkTo(node.key)}>
        <Avatar name={node.name} size="md" tone="auto" />
        <span className="pw-cell">
          <span data-no-translate="" className="pw-cell__title">{node.name}</span>
          {meta ? <span className="pw-cell__meta">{meta}</span> : null}
        </span>
        {marks.map((m) => <StatusBadge key={m} status={m} />)}
      </Link>
      {node.children.length ? (
        <ul className="people-org__tree">
          {node.children.map((child) => <OrgNode key={child.key} node={child} linkTo={linkTo} />)}
        </ul>
      ) : null}
    </li>
  );
}

// Bagan organisasi: active, non-excluded people as an indented tree by direct
// manager, one card per division (GET /people/directory/org).
export default function OrgChart({ departmentId, linkTo }) {
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await api.get('/people/directory/org', { params: departmentId ? { departmentId } : {} });
      setOrg(r.data.data || { roots: [], nodes: [] });
    } catch (e) {
      setError(e.response?.data?.error?.message || 'Periksa koneksi, lalu coba lagi.');
    } finally {
      setLoading(false);
    }
  }, [departmentId]);
  useEffect(() => { load(); }, [load]);

  if (loading && !org) return <LoadingState label="Memuat bagan organisasi" />;
  if (error) {
    return <EmptyState tone="error" title="Bagan organisasi gagal dimuat" description={error} action={<Button variant="secondary" onClick={load}>Coba lagi</Button>} />;
  }
  const groups = orgForest(org);
  if (!groups.length) {
    return <EmptyState icon="account_tree" title="Belum ada orang di bagan" description="Isi atasan langsung setiap orang di direktori supaya bagan organisasinya terbentuk." />;
  }
  return (
    <div className="pw-stack pw-stack--lg">
      {groups.map((group) => (
        <Card key={group.division} variant="panel" size="sm" title={group.division} subtitle={`${formatNumber(group.people)} orang`}>
          <ul className="people-org__tree people-org__tree--root">
            {group.roots.map((node) => <OrgNode key={node.key} node={node} linkTo={linkTo} />)}
          </ul>
        </Card>
      ))}
    </div>
  );
}
