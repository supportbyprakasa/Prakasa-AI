import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import DataTable from './DataTable';
import Button from './Button';

/**
 * Tab Meeting generik untuk konteks customer/project/dll.
 * Props:
 *  - contextRecordId: ID dari context_records (Fase 2)
 *  - linkedType / linkedId: alternatif lookup via meeting_links
 */
export default function ContextMeetingTab({ contextRecordId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!contextRecordId) { setLoading(false); return; }
    setLoading(true);
    api.get('/meetings', { params: { contextRecordId, limit: 50 } })
      .then((r) => setRows(r.data.data))
      .finally(() => setLoading(false));
  }, [contextRecordId]);

  return (
    <div>
      <DataTable
        loading={loading}
        rows={rows}
        empty="Belum ada meeting terkait"
        columns={[
          { key: 'title', title: 'Judul',
            render: (r) => <Link to={`/meetings/${r.id}`}>{r.title}</Link> },
          { key: 'startTime', title: 'Mulai',
            render: (r) => new Date(r.startTime).toLocaleString('id-ID') },
          { key: 'organizerName', title: 'Organizer' },
          { key: 'status', title: 'Status' },
          { key: 'aiSummaryId', title: 'AI Summary',
            render: (r) => r.aiSummaryId ? '✅' : '—' },
        ]}
      />
    </div>
  );
}
