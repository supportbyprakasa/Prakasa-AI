import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import DataGrid from '../../components/datagrid/DataGrid';
import { apiErrorMessage, fieldErrorsFromApi } from '../../components/datagrid/gridModel';
import FormActions from '../../components/FormActions';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import SideSheet from '../../components/SideSheet';
import SignaturePrecheckPanel from '../../components/SignaturePrecheckPanel';
import StatusBadge from '../../components/StatusBadge';
import { toast } from '../../components/Toast';
import { formatNumber } from '../../components/format';
import FilterChips from './FilterChips';
import { AI_PROVIDER_LABELS, aiProviderLabel } from './aiLabels';
import { Translate } from '../../i18n/NoTranslate';

const STATUS_LABELS = {
  passed: 'Lolos',
  warning: 'Peringatan',
  failed: 'Gagal',
  skipped: 'Dilewati',
};
const NO_FILTERS = { status: '', documentId: '' };

export default function SignaturePrecheckLogs() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [runOpen, setRunOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
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
    } catch (requestError) {
      setError(apiErrorMessage(requestError, 'Log cek awal tidak dapat dimuat.'));
    } finally {
      setLoading(false);
    }
  }, [page, filters.status, filters.documentId]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (row) => {
    try {
      const response = await api.get(`/signature-precheck/${row.id}`);
      setSelected(response.data.data);
    } catch (requestError) {
      toast(apiErrorMessage(requestError, 'Detail cek awal gagal dibuka.'), 'error');
    }
  };

  const columns = [
    { key: 'id', header: 'ID', type: 'number', width: 72 },
    { key: 'documentId', header: 'ID dokumen', type: 'number' },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} label={STATUS_LABELS[row.status]} /> },
    {
      key: 'provider',
      header: 'Penyedia / model',
      render: (row) => (row.provider ? <>{AI_PROVIDER_LABELS[row.provider] ? <Translate>{aiProviderLabel(row.provider)}</Translate> : aiProviderLabel(row.provider)}{row.model ? ` · ${row.model}` : ''}</> : ''),
    },
    { key: 'durationMs', header: 'Durasi', render: (row) => (row.durationMs == null ? '' : `${formatNumber(row.durationMs)} ms`) },
    { key: 'createdAt', header: 'Waktu', type: 'datetime' },
  ];

  return (
    <Page>
      <PageHeader
        title="Cek awal tanda tangan"
        description="Log cek awal AI bersifat saran dan tidak menggantikan keputusan approval."
        actions={<Button icon="play_circle" onClick={() => setRunOpen(true)}>Jalankan cek awal</Button>}
      />

      <DataGrid
        title="Log cek awal"
        exportName="signature-precheck"
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={load}
        meta={meta || { page, limit: 20, total: rows.length }}
        onPageChange={setPage}
        filters={(
          <FilterChips
            label="Filter log cek awal"
            values={filters}
            onChange={(next) => {
              setPage(1);
              setFilters(next);
            }}
            fields={[
              { key: 'status', label: 'Status', type: 'select', options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })) },
              { key: 'documentId', label: 'ID dokumen', type: 'number', hint: 'Contoh 15.' },
            ]}
          />
        )}
        empty="Belum ada log cek awal tanda tangan"
        onRowClick={openDetail}
      />

      <SideSheet open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.id ? `Cek awal #${selected.id}` : 'Cek awal'}>
        {selected ? <SignaturePrecheckPanel precheck={selected} /> : null}
      </SideSheet>

      <Modal
        open={runOpen}
        onClose={() => { if (!running) setRunOpen(false); }}
        title="Jalankan cek awal tanda tangan"
        size="sm"
      >
        {runOpen ? (
          <RunPrecheckForm
            running={running}
            onRunningChange={setRunning}
            onCancel={() => setRunOpen(false)}
            onDone={async (result) => {
              setRunOpen(false);
              setSelected(result);
              await load();
            }}
          />
        ) : null}
      </Modal>
    </Page>
  );
}

function RunPrecheckForm({ running, onRunningChange, onCancel, onDone }) {
  const [form, setForm] = useState({
    documentId: '',
    signatureRequestId: '',
    approvalRequestId: '',
  });
  const [errors, setErrors] = useState({});

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const run = async (event) => {
    event.preventDefault();
    if (!form.documentId) {
      setErrors({ documentId: 'Isi ID dokumen.' });
      return;
    }

    onRunningChange(true);
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
      toast('Cek awal selesai', 'success');
      onRunningChange(false);
      onDone(response.data.data);
    } catch (requestError) {
      onRunningChange(false);
      const fieldErrors = fieldErrorsFromApi(requestError);
      if (Object.keys(fieldErrors).length) setErrors(fieldErrors);
      else toast(apiErrorMessage(requestError, 'Cek awal gagal dijalankan.'), 'error');
    }
  };

  return (
    <form className="pw-stack" onSubmit={run} noValidate>
      <Input
        label="ID dokumen"
        required
        type="number"
        min="1"
        inputMode="numeric"
        value={form.documentId}
        error={errors.documentId}
        onChange={(event) => set('documentId', event.target.value)}
        autoFocus
      />
      <Input
        label="ID permintaan tanda tangan"
        type="number"
        min="1"
        inputMode="numeric"
        hint="Opsional."
        value={form.signatureRequestId}
        error={errors.signatureRequestId}
        onChange={(event) => set('signatureRequestId', event.target.value)}
      />
      <Input
        label="ID permintaan approval"
        type="number"
        min="1"
        inputMode="numeric"
        hint="Opsional."
        value={form.approvalRequestId}
        error={errors.approvalRequestId}
        onChange={(event) => set('approvalRequestId', event.target.value)}
      />

      <FormActions>
        <Button variant="text" type="button" onClick={onCancel} disabled={running}>Batal</Button>
        <Button type="submit" loading={running}>Jalankan cek awal</Button>
      </FormActions>
    </form>
  );
}
