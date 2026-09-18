import { useEffect, useState } from 'react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import { toast } from '../../components/Toast';

export default function ApprovalInbox() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/approvals').then((r) => setRows(r.data.data)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const decide = async (action) => {
    try {
      await api.patch(`/approvals/${selected.id}`, { action, note });
      toast('Keputusan tersimpan', 'success');
      setSelected(null); setNote('');
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  return (
    <div>
      <h2>Approval Inbox</h2>
      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          { key: 'id', title: 'ID' },
          { key: 'title', title: 'Judul' },
          { key: 'approvalType', title: 'Tipe' },
          { key: 'currentLevel', title: 'Level' },
          { key: 'status', title: 'Status' },
          { key: 'requesterName', title: 'Requester' },
          {
            key: 'actions', title: 'Aksi',
            render: (r) => r.status === 'pending'
              ? <Button onClick={() => setSelected(r)}>Buka</Button>
              : <span style={{ color: 'var(--color-text-muted)' }}>—</span>,
          },
        ]}
      />

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.title || ''}>
        {selected && (
          <>
            <p style={{ fontSize: 14 }}>Status: <b>{selected.status}</b> · Level <b>{selected.currentLevel}</b></p>
            <Input label="Catatan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => decide('request_revision')}>Minta Revisi</Button>
              <Button variant="danger" onClick={() => decide('reject')}>Tolak</Button>
              <Button onClick={() => decide('approve')}>Setujui</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
