import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../Banner';
import Button from '../Button';
import Input from '../Input';
import Segmented from '../Segmented';
import Select from '../Select';
import SideSheet from '../SideSheet';
import Textarea from '../Textarea';
import { toast } from '../Toast';
import usePrakasaAIForm from '../ai/usePrakasaAIForm';
import { EMPTY_HELP, HELP_CATEGORIES, HELP_PRIORITIES, helpPayload, helpSentMessage, validateHelp } from './itHelpModel';

// "Butuh bantuan IT" (owner, 1 Oct 2026): open from the top bar on every page,
// for every role. The request becomes an IT ticket (Tiket IT) and a copy goes to
// the IT support mailbox; the page it came from is sent along for context.
export default function ItHelpSheet({ open, onClose }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [values, setValues] = useState(EMPTY_HELP);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState([]);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    api.get('/it/tickets/my-devices')
      .then((r) => { if (alive) setDevices(Array.isArray(r.data?.data) ? r.data.data : []); })
      .catch(() => { if (alive) setDevices([]); });
    return () => { alive = false; };
  }, [open]);

  const set = (key) => (event) => {
    const value = event?.target ? event.target.value : event;
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  // Prakasa AI may fill this sheet; the user reviews it and presses "Kirim ke
  // tim IT" (docs/prakasa-ai-rencana.md §9.8).
  const deviceOptions = devices.map((d) => ({ value: String(d.id), label: [d.assetCode, d.brand, d.model].filter(Boolean).join(' · ') || `Perangkat #${d.id}` }));
  const ai = usePrakasaAIForm({
    id: 'it-help',
    title: 'Butuh bantuan IT',
    permission: 'it_ticket.create',
    submitLabel: 'Kirim ke tim IT',
    enabled: open,
    initialValues: EMPTY_HELP,
    fields: [
      { name: 'category', label: 'Jenis masalah', type: 'select', options: HELP_CATEGORIES, required: true },
      { name: 'title', label: 'Judul singkat', type: 'text', required: true, maxLength: 190 },
      { name: 'description', label: 'Ceritakan masalahnya', type: 'textarea', required: true, maxLength: 4000, hint: 'Apa yang terjadi, sejak kapan, dan apa yang sudah dicoba. Jangan tulis password.' },
      { name: 'priority', label: 'Urgensi', type: 'radio', options: HELP_PRIORITIES },
      ...(deviceOptions.length ? [{ name: 'deviceId', label: 'Perangkat (bila terkait)', type: 'select', options: deviceOptions }] : []),
    ],
    getValues: () => values,
    setValues: (patch) => {
      setValues((current) => ({ ...current, ...patch }));
      setErrors((current) => ({ ...current, ...Object.fromEntries(Object.keys(patch).map((key) => [key, undefined])) }));
    },
    validate: validateHelp,
  });

  async function submit(event) {
    event.preventDefault();
    const found = validateHelp(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFormError('');
    try {
      const r = await api.post('/it/tickets', helpPayload(values, pathname));
      const result = r.data?.data || {};
      setValues(EMPTY_HELP);
      onClose();
      toast(helpSentMessage(result), 'success', result.id ? { action: { label: 'Lihat tiket', onClick: () => navigate(`/it/tickets/${result.id}`) } } : undefined);
    } catch (error) {
      setFormError(error?.response?.data?.error?.message || 'Tiket belum terkirim. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SideSheet
      open={open}
      onClose={busy ? undefined : onClose}
      title="Butuh bantuan IT?"
      footer={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={busy}>Batal</Button>
          <Button type="submit" form="it-help-form" icon="send" loading={busy}>Kirim ke tim IT</Button>
        </>
      )}
    >
      <form id="it-help-form" className="pw-stack" onSubmit={submit} noValidate>
        <p className="pw-text-helper">Permintaan Anda menjadi tiket di Tiket IT dan dikirim ke email tim IT. Jangan tulis password di sini.</p>
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        {ai.notice}
        <Select
          label="Jenis masalah *"
          value={values.category}
          {...ai.field('category')}
          onChange={set('category')}
          options={HELP_CATEGORIES}
          placeholder=""
          error={errors.category}
        />
        <Input label="Judul singkat *" value={values.title} {...ai.field('title')} onChange={set('title')} maxLength={190} error={errors.title} hint="Contoh: Laptop tidak bisa menyala" />
        <Textarea
          label="Ceritakan masalahnya *"
          value={values.description}
          {...ai.field('description')}
          onChange={set('description')}
          rows={5}
          maxLength={4000}
          error={errors.description}
          hint="Apa yang terjadi, sejak kapan, dan apa yang sudah dicoba."
        />
        <Segmented label="Urgensi" value={values.priority} {...ai.field('priority')} onChange={set('priority')} options={HELP_PRIORITIES} />
        {devices.length ? (
          <Select
            label="Perangkat (bila terkait)"
            value={values.deviceId}
            {...ai.field('deviceId')}
            onChange={set('deviceId')}
            dataOptions
            options={[{ value: '', label: 'Tidak terkait perangkat', translate: true }, ...deviceOptions]}
          />
        ) : null}
      </form>
    </SideSheet>
  );
}
