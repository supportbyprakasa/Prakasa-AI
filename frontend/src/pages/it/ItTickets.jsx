import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import Page from '../../components/Page';
import PriorityBadge from '../../components/PriorityBadge';
import StatusBadge from '../../components/StatusBadge';
import DataGrid from '../../components/datagrid/DataGrid';
import { priorityLabel } from '../../components/statusTone';
import { CATEGORY_LABELS, STATUS_LABELS } from './itTicketModel';
import SupportEmailDialog from './SupportEmailDialog';

const STATUS_FILTERS = [
  { value: '', label: 'Semua status' },
  ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

export default function ItTickets() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = Boolean(user?.permissions?.includes('it_ticket.manage'));
  const [emailOpen, setEmailOpen] = useState(false);
  const [status, setStatus] = useState('');

  const columns = [
    { key: 'id', header: 'ID', width: 64 },
    { key: 'title', header: 'Judul', required: true },
    {
      key: 'category',
      header: 'Kategori',
      translate: true,
      exportValue: (row) => CATEGORY_LABELS[row.category] || row.category,
      render: (row) => CATEGORY_LABELS[row.category] || row.category,
    },
    {
      key: 'priority',
      header: 'Prioritas',
      exportValue: (row) => priorityLabel(row.priority),
      render: (row) => <PriorityBadge priority={row.priority} />,
    },
    {
      key: 'status',
      header: 'Status',
      exportValue: (row) => STATUS_LABELS[row.status] || row.status,
      render: (row) => <StatusBadge status={row.status} label={STATUS_LABELS[row.status]} />,
    },
    ...(canManage ? [{ key: 'requesterName', header: 'Pengaju' }] : []),
    { key: 'deviceAssetCode', header: 'Perangkat' },
    { key: 'createdAt', header: 'Dibuat', type: 'datetime' },
  ];

  return (
    <Page
      title="Tiket IT"
      description={canManage
        ? 'Semua tiket IT dari seluruh divisi. Buka satu tiket untuk menanganinya.'
        : 'Ajukan kebutuhan IT Anda dan pantau statusnya di sini.'}
      actions={(
        <>
          {canManage ? <Button variant="secondary" icon="settings" onClick={() => setEmailOpen(true)}>Pengaturan</Button> : null}
          <Button icon="add" onClick={() => navigate('/it/tickets/new')}>Buat tiket</Button>
        </>
      )}
    >
      <DataGrid
        title="Tiket IT"
        showTitle={false}
        exportName="tiket-it"
        resource="/it/tickets"
        idKey="id"
        columns={columns}
        params={status ? { status } : undefined}
        onRowClick={(row) => navigate(`/it/tickets/${row.id}`)}
        empty={canManage ? 'Belum ada tiket masuk.' : 'Anda belum pernah mengajukan tiket IT.'}
        filters={STATUS_FILTERS.map((option) => (
          <Chip key={option.value || 'all'} selected={status === option.value} onClick={() => setStatus(option.value)}>
            {option.label}
          </Chip>
        ))}
      />
      {canManage ? <SupportEmailDialog open={emailOpen} onClose={() => setEmailOpen(false)} /> : null}
    </Page>
  );
}
