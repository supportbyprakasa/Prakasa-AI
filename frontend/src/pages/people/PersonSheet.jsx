import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import Avatar from '../../components/Avatar';
import Button from '../../components/Button';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import KeyValue from '../../components/KeyValue';
import SideSheet from '../../components/SideSheet';
import StatusBadge from '../../components/StatusBadge';
import { formatDate, formatDateTime } from '../../components/format';
import { Mixed, data } from '../../i18n/NoTranslate';
import {
  ACCOUNT_STATUS_LABELS, PERSON_KIND_LABELS, RESIGN_SOURCE_LABELS, personDateMarks, personMarks, personStatusKey, runningWorkflowLabel,
} from './directoryModel';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import { workflowBadge } from '../hrga/hrgaModel';

// A person's work profile in a side sheet. Everyone sees the work contact;
// People & Culture also sees kind, exclusion, resign details and notes.
export default function PersonSheet({ personKey, manage, linkTo, onClose, onEdit, reloadKey = 0 }) {
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!personKey) return;
    setLoading(true);
    setError('');
    try {
      const r = await api.get(`/people/directory/${personKey}`);
      setEntry(r.data.data);
    } catch (e) {
      setEntry(null);
      setError(e.response?.data?.error?.message || 'Profil gagal dimuat.');
    } finally {
      setLoading(false);
    }
  }, [personKey]);
  useEffect(() => { load(); }, [load, reloadKey]);

  // The person's active company lines (number/extension only; wave 2, row 2.3).
  const [lines, setLines] = useState([]);
  const personId = entry && entry.key === personKey ? entry.personId : null;
  useEffect(() => {
    let active = true;
    setLines([]);
    if (personId) {
      api.get(`/it/phone-lines/person/${personId}`)
        .then((r) => { if (active) setLines(r.data.data || []); })
        .catch(() => { /* optional row: the profile shows without it */ });
    }
    return () => { active = false; };
  }, [personId, reloadKey]);

  const open = Boolean(personKey);
  const shown = entry && entry.key === personKey ? entry : null;
  // /people/directory/<key>?ubah=1 opens the profile form once the person has loaded.
  useOpenFromUrl('ubah', () => onEdit(shown), { enabled: Boolean(manage && shown && !loading), keepUnsaved: true });
  let body;
  if (loading && !shown) body = <LoadingState label="Memuat profil" />;
  else if (error) {
    body = <EmptyState tone="error" compact title="Profil tidak dapat dimuat" description={error} action={<Button variant="text" onClick={load}>Coba lagi</Button>} />;
  } else if (shown) {
    const marks = personMarks(shown, manage);
    const dates = personDateMarks(shown);
    const workflow = shown.runningWorkflow || null;
    const contact = [
      { label: 'Jabatan', value: shown.position },
      { label: 'Divisi', translate: true, value: shown.departmentName },
      { label: 'Atasan langsung', value: shown.managerKey ? <Link data-no-translate="" to={linkTo(shown.managerKey)}>{shown.managerName}</Link> : shown.managerName },
      { label: 'Email kerja', value: shown.workEmail ? <a data-no-translate="" href={`mailto:${shown.workEmail}`}>{shown.workEmail}</a> : null },
      { label: 'Telepon kerja', value: shown.workPhone },
      lines.length ? {
        label: 'Nomor perusahaan',
        value: lines.map((l) => [l.number, l.extension ? `ext. ${l.extension}` : null].filter(Boolean).join(' · ')).join(', '),
      } : null,
      { label: 'Lokasi kerja', value: shown.locationName },
    ];
    const hr = manage ? [
      { label: 'Jenis', translate: true, value: shown.kindLabel || PERSON_KIND_LABELS[shown.kind] },
      shown.kind === 'excluded' ? { label: 'Alasan dikecualikan', value: shown.excludedReason } : null,
      { label: 'Status', value: <StatusBadge status={personStatusKey(shown)} label={shown.kind === 'excluded' ? 'Dikecualikan' : shown.statusLabel} /> },
      shown.status === 'resigned' ? {
        label: 'Tanggal resign',
        value: <Mixed parts={[shown.resignedOn ? formatDate(shown.resignedOn) : null, shown.resignedOnSourceLabel || RESIGN_SOURCE_LABELS[shown.resignedOnSource]]} />,
      } : null,
      { label: 'Akun aplikasi', translate: true, value: shown.hasAccount ? (ACCOUNT_STATUS_LABELS[shown.accountStatus] || 'Ada') : 'Tanpa akun' },
      { label: 'Catatan', value: shown.notes },
      { label: 'Diperbarui', value: shown.updatedAt ? formatDateTime(shown.updatedAt) : null },
    ] : [];
    body = (
      <div className="pw-stack">
        <div className="people-sheet__head">
          <Avatar name={shown.name} size="lg" tone="auto" />
          <div className="pw-cell">
            <span data-no-translate="" className="people-sheet__name">{shown.name}</span>
            {shown.position ? <span className="pw-cell__meta" data-no-translate="">{shown.position}</span> : null}
            {marks.length || dates.length ? (
              <span className="pw-row">
                {dates.map((d) => <StatusBadge key={d.status} status={d.status} label={d.label} />)}
                {marks.map((m) => <StatusBadge key={m} status={m} />)}
              </span>
            ) : null}
          </div>
        </div>
        {manage && shown.reviewed === false ? (
          <p className="people-sheet__note">Akun ini belum ditinjau People & Culture. Simpan profilnya untuk menandai sudah ditinjau.</p>
        ) : null}
        {workflow ? (
          <Link className="people-sheet__report pw-state-layer" to={`/hrga/workflows/${workflow.id}`}>
            <span className="pw-cell">
              <span className="pw-cell__title" data-no-translate="">{runningWorkflowLabel(workflow)}</span>
              <span className="pw-cell__meta"><StatusBadge {...workflowBadge(workflow.status)} /></span>
            </span>
          </Link>
        ) : null}
        <section className="pw-stack pw-stack--sm" aria-label="Kontak kerja">
          <h3 className="pw-overline people-heading">Kontak kerja</h3>
          <KeyValue items={contact} />
        </section>
        {hr.length ? (
          <section className="pw-stack pw-stack--sm" aria-label="Data People & Culture">
            <h3 className="pw-overline people-heading">Data People & Culture</h3>
            <KeyValue items={hr} />
          </section>
        ) : null}
        <section className="pw-stack pw-stack--sm" aria-label="Bawahan langsung">
          <h3 className="pw-overline people-heading">{`Bawahan langsung (${(shown.directReports || []).length})`}</h3>
          {shown.directReports?.length ? (
            <ul className="people-sheet__reports">
              {shown.directReports.map((r) => (
                <li key={r.key}>
                  <Link className="people-sheet__report pw-state-layer" to={linkTo(r.key)}>
                    <Avatar name={r.name} size="sm" tone="auto" />
                    <span className="pw-cell">
                      <span data-no-translate="" className="pw-cell__title">{r.name}</span>
                      <span className="pw-cell__meta">{r.position || r.departmentName ? <Mixed parts={[data(r.position), r.departmentName]} /> : '—'}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <span className="pw-text-helper">Tidak ada.</span>}
        </section>
        {shown.hasAccount && manage ? (
          <span className="pw-text-helper">Nama, email kerja, dan divisi orang yang punya akun diubah di Admin → Pengguna.</span>
        ) : null}
      </div>
    );
  }

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title="Profil kerja"
      footer={manage && shown ? <Button icon="edit" onClick={() => onEdit(shown)}>Ubah profil</Button> : null}
    >
      {body}
    </SideSheet>
  );
}
