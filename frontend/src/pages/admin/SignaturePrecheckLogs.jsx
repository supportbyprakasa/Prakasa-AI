import { Eye, PlayCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import api from '../../api/client';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import DataTable from '../../components/DataTable';
import FilterBar from '../../components/FilterBar';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import SignaturePrecheckPanel from '../../components/SignaturePrecheckPanel';
import { toast } from '../../components/Toast';

const STATUS_TONE = {
  passed: 'success',
  warning: 'warning',
  failed: 'error',
  skipped: 'default',
};

export default function SignaturePrecheckLogs() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [filters, setFilters] = useState({
    status: '',
    documentId: '',
  });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [runOpen, setRunOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get('/signature-precheck', {
        params: {
          page,
          limit: 20,
          status: filters.status || undefined,
          documentId: filters.documentId || undefined,
        },
      });
      setRows(response.data.data || []);
      setMeta(response.data.meta || null);
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal memuat precheck log', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [page, filters.status, filters.documentId]);

  const openDetail = async (row) => {
    try {
      const response = await api.get(`/signature-precheck/${row.id}`);
      setSelected(response.data.data);
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal membuka precheck', 'error');
    }
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'center',
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Signature Precheck</h2>
          <div
            style={{
              color: 'var(--color-text-muted)',
              fontSize: 13,
              marginTop: 4,
            }}
          >
            Log AI precheck bersifat advisory dan tidak menggantikan keputusan approval.
          </div>
        </div>
        <Button onClick={() => setRunOpen(true)}>
          <PlayCircle size={14} />
          Run Precheck
        </Button>
      </div>

      <FilterBar
        filters={[
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { value: 'passed', label: 'Passed' },
              { value: 'warning', label: 'Warning' },
              { value: 'failed', label: 'Failed' },
              { value: 'skipped', label: 'Skipped' },
            ],
          },
          {
            name: 'documentId',
            label: 'Document ID',
            type: 'text',
            placeholder: 'Contoh: 15',
          },
        ]}
        values={filters}
        onChange={(next) => {
          setPage(1);
          setFilters(next);
        }}
        onReset={() => {
          setPage(1);
          setFilters({ status: '', documentId: '' });
        }}
      />

      <DataTable
        loading={loading}
        rows={rows}
        meta={meta}
        onPageChange={setPage}
        empty="Belum ada signature precheck log"
        columns={[
          { key: 'id', title: 'ID' },
          { key: 'documentId', title: 'Document' },
          {
            key: 'status',
            title: 'Status',
            render: (row) => (
              <Badge tone={STATUS_TONE[row.status] || 'default'}>{row.status}</Badge>
            ),
          },
          {
            key: 'provider',
            title: 'Provider / Model',
            render: (row) =>
              row.provider
                ? `${row.provider}${row.model ? ` · ${row.model}` : ''}`
                : '—',
          },
          {
            key: 'durationMs',
            title: 'Duration',
            render: (row) =>
              row.durationMs == null ? '—' : `${row.durationMs} ms`,
          },
          {
            key: 'createdAt',
            title: 'Waktu',
            render: (row) =>
              row.createdAt
                ? new Date(row.createdAt).toLocaleString('id-ID')
                : '—',
          },
          {
            key: 'actions',
            title: 'Aksi',
            render: (row) => (
              <Button variant="secondary" onClick={() => openDetail(row)}>
                <Eye size={14} />
                Detail
              </Button>
            ),
          },
        ]}
      />

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `Precheck #${selected.id}` : 'Precheck'}
        maxWidth={820}
      >
        {selected && <SignaturePrecheckPanel precheck={selected} />}
      </Modal>

      <Modal
        open={runOpen}
        onClose={() => setRunOpen(false)}
        title="Run Signature Precheck"
        maxWidth={640}
      >
        <RunPrecheckForm
          onCancel={() => setRunOpen(false)}
          onDone={async (result) => {
            setRunOpen(false);
            setSelected(result);
            await load();
          }}
        />
      </Modal>
    </div>
  );
}

function RunPrecheckForm({ onCancel, onDone }) {
  const [form, setForm] = useState({
    documentId: '',
    signatureRequestId: '',
    approvalRequestId: '',
  });
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!form.documentId) {
      toast('Document ID wajib', 'error');
      return;
    }

    setRunning(true);
    try {
      const response = await api.post('/signature-precheck/run', {
        documentId: Number(form.documentId),
        signatureRequestId: form.signatureRequestId
          ? Number(form.signatureRequestId)
          : null,
        approvalRequestId: form.approvalRequestId
          ? Number(form.approvalRequestId)
          : null,
      });
      toast('Precheck selesai', 'success');
      onDone(response.data.data);
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Precheck gagal dijalankan', 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <Input
        label="Document ID *"
        type="number"
        min="1"
        value={form.documentId}
        onChange={(event) =>
          setForm((current) => ({ ...current, documentId: event.target.value }))
        }
      />
      <Input
        label="Signature Request ID"
        type="number"
        min="1"
        value={form.signatureRequestId}
        onChange={(event) =>
          setForm((current) => ({
            ...current,
            signatureRequestId: event.target.value,
          }))
        }
      />
      <Input
        label="Approval Request ID"
        type="number"
        min="1"
        value={form.approvalRequestId}
        onChange={(event) =>
          setForm((current) => ({
            ...current,
            approvalRequestId: event.target.value,
          }))
        }
      />

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          marginTop: 12,
        }}
      >
        <Button variant="secondary" onClick={onCancel} disabled={running}>
          Batal
        </Button>
        <Button onClick={run} disabled={running}>
          {running ? 'Memproses…' : 'Run Precheck'}
        </Button>
      </div>
    </div>
  );
}
