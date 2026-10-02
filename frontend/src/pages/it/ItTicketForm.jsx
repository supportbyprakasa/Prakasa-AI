import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import FullScreenDialog from '../../components/FullScreenDialog';
import Input from '../../components/Input';
import Select from '../../components/Select';
import Textarea from '../../components/Textarea';
import { toast } from '../../components/Toast';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import { PRIORITY_LABELS } from '../../components/statusTone';
import { CATEGORY_LABELS } from './itTicketModel';
import './it-tickets.css';

const EMPTY_FORM = { category: 'device_damage', title: '', description: '', priority: 'normal', deviceId: '' };
const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'urgent'].map((value) => ({ value, label: PRIORITY_LABELS[value] }));
const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }));
const deviceLabel = (device) => `${device.assetCode} · ${[device.brand, device.model].filter(Boolean).join(' ') || device.deviceType}`;
const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;

// Route-based form page (/it/tickets/new) in the full-screen dialog look
// (docs/ui-guideline.md §3.3): the X and Batal go back to the ticket list.
export default function ItTicketForm() {
  const navigate = useNavigate();
  const formId = useId();
  const [devices, setDevices] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/it/tickets/my-devices').then((response) => setDevices(response.data.data || [])).catch(() => {});
  }, []);

  // Prakasa AI may fill this form; the user reviews it and presses "Ajukan tiket"
  // (docs/prakasa-ai-rencana.md §9.8).
  const deviceOptions = devices.map((device) => ({ value: String(device.id), label: deviceLabel(device) }));
  const ai = usePrakasaAIForm({
    id: 'it-ticket',
    title: 'Tiket IT',
    permission: 'it_ticket.create',
    submitLabel: 'Ajukan tiket',
    initialValues: EMPTY_FORM,
    fields: [
      { name: 'category', label: 'Kategori', type: 'select', options: CATEGORY_OPTIONS, required: true },
      { name: 'priority', label: 'Prioritas', type: 'select', options: PRIORITY_OPTIONS, required: true },
      { name: 'title', label: 'Judul', type: 'text', required: true, maxLength: 190, hint: 'Ringkasan singkat kebutuhan.' },
      { name: 'description', label: 'Deskripsi', type: 'textarea', required: true, hint: 'Masalah atau kebutuhan selengkapnya.' },
      ...(form.category === 'device_damage' && deviceOptions.length
        ? [{ name: 'deviceId', label: 'Perangkat terkait', type: 'select', options: deviceOptions, hint: 'Opsional; hanya perangkat atas nama pengguna.' }]
        : []),
    ],
    getValues: () => form,
    // Same as choosing by hand: another category clears the chosen device.
    setValues: (patch) => setForm((current) => ({ ...current, ...('category' in patch && !('deviceId' in patch) ? { deviceId: '' } : {}), ...patch })),
  });

  const close = () => navigate('/it/tickets');
  // This dialog is a route: leaving with typed changes asks first. The X and
  // Escape ask through the dialog's `dirty`; Batal asks here.
  const dirty = Object.keys(EMPTY_FORM).some((key) => String(form[key] ?? '') !== String(EMPTY_FORM[key]));
  const cancel = () => (dirty ? setConfirmDiscard(true) : close());

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await api.post('/it/tickets', {
        category: form.category,
        title: form.title.trim(),
        description: form.description.trim(),
        priority: form.priority,
        deviceId: form.category === 'device_damage' && form.deviceId ? Number(form.deviceId) : null,
      });
      toast('Tiket berhasil diajukan', 'success');
      navigate(`/it/tickets/${response.data.data.id}`);
    } catch (submitError) {
      setError(errorMessage(submitError, 'Tiket gagal diajukan'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FullScreenDialog
      open
      asPage
      onClose={close}
      dirty={dirty}
      title="Buat tiket IT"
      sectionTitle="Kebutuhan IT"
      actions={(
        <>
          <Button type="button" variant="text" onClick={cancel} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} icon="send" loading={saving}>Ajukan tiket</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={submit}>
        {error ? <Banner tone="error">{error}</Banner> : null}
        {ai.notice}

        <div className="pw-fsdialog__fields">
          <Select
            label="Kategori"
            value={form.category}
            options={CATEGORY_OPTIONS}
            {...ai.field('category')}
            onChange={(event) => setForm((current) => ({ ...current, category: event.target.value, deviceId: '' }))}
          />

          <Select
            label="Prioritas"
            value={form.priority}
            options={PRIORITY_OPTIONS}
            {...ai.field('priority')}
            onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
          />
        </div>

        <Input
          label="Judul"
          value={form.title}
          maxLength={190}
          {...ai.field('title')}
          required
          hint="Ringkasan singkat kebutuhan Anda."
          onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
        />

        <Textarea
          label="Deskripsi"
          rows={5}
          required
          hint="Jelaskan masalah atau kebutuhan Anda selengkapnya."
          value={form.description}
          {...ai.field('description')}
          onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
        />

        {form.category === 'device_damage' && (
          <Select
            label="Perangkat terkait"
            value={form.deviceId}
            {...ai.field('deviceId')}
            placeholder="Tidak terkait perangkat tertentu"
            hint={devices.length ? 'Opsional.' : 'Tidak ada perangkat yang terdaftar atas nama Anda.'}
            dataOptions
            options={deviceOptions}
            onChange={(event) => setForm((current) => ({ ...current, deviceId: event.target.value }))}
          />
        )}
      </form>
      <ConfirmDialog
        open={confirmDiscard}
        title="Buang perubahan?"
        message="Isian tiket ini belum diajukan dan akan hilang."
        confirmLabel="Buang"
        tone="danger"
        onClose={() => setConfirmDiscard(false)}
        onConfirm={close}
      />
    </FullScreenDialog>
  );
}
