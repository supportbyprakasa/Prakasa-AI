import { useEffect, useId, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Segmented from '../../components/Segmented';
import Select from '../../components/Select';
import Textarea from '../../components/Textarea';
import { toast } from '../../components/Toast';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import { useAuth } from '../../context/AuthContext';
import {
  BAST_TITLES, CONDITION_OPTIONS, TEAMS, bastBody, bastErrors, defaultAcknowledger,
} from '../documents/docTemplateModel';

const errorOf = (error) => error?.response?.data?.error || {};

// Prakasa AI may fill the descriptive part of a BAST; who acknowledges it
// ("Mengetahui", a signatory) stays with the user, and the user presses
// "Buat BAST" (docs/prakasa-ai-rencana.md §9.9). Two registrations because the
// two subjects are saved under different permissions.
const bastFields = ({ subject, kind }) => [
  f.radio('team', 'Tim petugas', TEAMS, { required: true }),
  f.userOnly('acknowledgerUserId', 'Mengetahui', 'select'),
  ...(subject === 'phone' ? [
    f.text('holderName', 'Nama karyawan', { required: true }),
    f.text('holderPosition', 'Jabatan', { hint: 'Kosongkan: dari Direktori' }),
    f.text('holderDivision', 'Divisi', { hint: 'Kosongkan: dari Direktori' }),
  ] : []),
  f.text('accessories', kind === 'return' ? 'Kelengkapan dikembalikan' : 'Kelengkapan', { hint: subject === 'device' ? 'Misalnya: charger, tas, mouse' : 'Misalnya: kartu SIM, HP dinas' }),
  ...(subject === 'device' && kind === 'return' ? [f.select('conditionCode', 'Kondisi saat kembali', CONDITION_OPTIONS)] : []),
  f.text('condition', kind === 'return' && subject === 'device' ? 'Keterangan kondisi' : 'Kondisi', { hint: 'Misalnya: baik, layar tergores di pojok kanan' }),
  f.textarea('notes', 'Catatan', { maxLength: 1000 }),
];
const AI_BAST_DEVICE = defineAIForm({
  id: 'it-bast-device',
  title: ({ kind }) => BAST_TITLES.device[kind] || 'BAST perangkat',
  permission: ['device.handover.manage', 'ga.ops.manage'], // POST /it/assignments/:id/bast accepts either
  submitLabel: 'Buat BAST',
  fields: bastFields,
});
const AI_BAST_PHONE = defineAIForm({
  id: 'it-bast-phone',
  title: ({ kind }) => BAST_TITLES.phone[kind] || 'BAST nomor perusahaan',
  permission: ['it.infra.manage', 'ga.ops.manage'],
  submitLabel: 'Buat BAST',
  fields: bastFields,
});

// Berita acara serah terima (BAST) for a device assignment or a company
// number, made as a Google Doc with the division kop in People & Culture's
// Shared Drive folder. IT and GA work on it together: the staff name their
// team; the other team's PIC acknowledges ("Mengetahui") by default.
// subject: 'device' (target = assignment { id, holderName }) | 'phone' (target = line row).
export default function BastDialog({ open, subject, kind, target, onClose, onMade }) {
  const formId = useId();
  const { user } = useAuth();
  const [options, setOptions] = useState({ staff: [], pic: {} });
  const blank = (row) => ({
    team: 'it', acknowledgerUserId: '', accessories: '', condition: '', conditionCode: '', notes: '',
    holderName: subject === 'phone' ? (row?.holderName || '') : '', holderPosition: '', holderDivision: '',
  });
  const [values, setValues] = useState(() => blank(target));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [made, setMade] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setErrors({}); setFormError(''); setMade(null);
    setValues(blank(target));
    api.get('/it/bast/options')
      .then((r) => {
        if (!active) return;
        const data = r.data.data || { staff: [], pic: {} };
        setOptions(data);
        setValues((v) => ({ ...v, acknowledgerUserId: v.acknowledgerUserId || defaultAcknowledger(v.team, data.pic, user?.id) }));
      })
      .catch(() => { if (active) setOptions({ staff: [], pic: {} }); });
    return () => { active = false; };
  }, [open, subject, target, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (name) => (value) => { setValues((v) => ({ ...v, [name]: value })); setErrors((e) => ({ ...e, [name]: undefined })); };
  const setTeam = (team) => setValues((v) => {
    const previousDefault = defaultAcknowledger(v.team, options.pic, user?.id);
    const keep = v.acknowledgerUserId && v.acknowledgerUserId !== previousDefault;
    return { ...v, team, acknowledgerUserId: keep ? v.acknowledgerUserId : defaultAcknowledger(team, options.pic, user?.id) };
  });

  // The team goes through setTeam, like a click: the default "Mengetahui" follows it.
  const aiBindings = {
    values,
    setValues,
    setters: { team: setTeam },
    setErrors,
    initialValues: blank(target),
    context: { subject, kind },
    validate: (next) => bastErrors(subject, next),
  };
  const aiDevice = usePrakasaAIForm(AI_BAST_DEVICE, {
    ...aiBindings,
    enabled: open && subject === 'device' && Boolean(target) && !made,
  });
  const aiPhone = usePrakasaAIForm(AI_BAST_PHONE, {
    ...aiBindings,
    enabled: open && subject === 'phone' && Boolean(target) && !made,
  });
  const ai = subject === 'phone' ? aiPhone : aiDevice;

  if (!target || !subject) return null;

  const submit = async (event) => {
    event.preventDefault();
    const found = bastErrors(subject, values);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true); setFormError('');
    try {
      const url = subject === 'device' ? `/it/assignments/${target.id}/bast` : `/it/infrastructure/phone-lines/${target.id}/bast`;
      const response = await api.post(url, bastBody(subject, kind, values));
      const doc = response.data.data;
      setMade(doc);
      toast(`BAST ${doc.number} dibuat di Shared Drive ${doc.departmentName}`, 'success');
      await onMade?.(doc);
    } catch (error) {
      const { message, details } = errorOf(error);
      if (details?.field) setErrors((e) => ({ ...e, [details.field]: message }));
      else setFormError(message || 'BAST gagal dibuat.');
    } finally {
      setSaving(false);
    }
  };

  const staffOptions = options.staff.filter((s) => s.id !== user?.id).map((s) => ({ value: String(s.id), label: s.position ? `${s.name} · ${s.position}` : s.name }));
  const title = BAST_TITLES[subject][kind];

  if (made) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="BAST dibuat"
        size="sm"
        footer={(
          <>
            <Button variant="text" onClick={onClose}>Tutup</Button>
            {made.webViewLink ? <Button icon="open_in_new" href={made.webViewLink} target="_blank" rel="noreferrer">Buka di Google Docs</Button> : null}
          </>
        )}
      >
        <div className="pw-stack">
          <p>{`${made.title} tersimpan sebagai Google Docs di folder Shared Drive ${made.departmentName}.`}</p>
          <p>{`Nomor dokumen: ${made.number}.${made.withKop ? '' : ' Kop divisi belum diatur, jadi dokumen memakai header bawaan template.'}`}</p>
          <p>Cetak atau bagikan untuk ditandatangani ketiga pihak.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      title={title}
      size="md"
      footer={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>Buat BAST</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={submit} noValidate>
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        {ai.notice}
        <p className="pw-muted">
          {subject === 'device'
            ? `Untuk ${target.holderName || 'pemegang perangkat'}. Data perangkat dan karyawan diisi otomatis.`
            : `Untuk nomor ${target.number || (target.extension ? `ekstensi ${target.extension}` : '')}. Data nomor diisi otomatis.`}
        </p>
        <Segmented label="Tim petugas" options={TEAMS} value={values.team} {...ai.field('team')} onChange={setTeam} />
        <Select
          label="Mengetahui"
          value={values.acknowledgerUserId || ''}
          placeholder="Tidak ada (diisi tangan)"
          options={staffOptions}
          dataOptions
          hint="Bawaan: PIC tim lainnya (IT ↔ GA) dari pengaturan People & Culture"
          onChange={(e) => set('acknowledgerUserId')(e.target.value)}
        />
        {subject === 'phone' ? (
          <>
            <Input label="Nama karyawan" required value={values.holderName} error={errors.holderName} {...ai.field('holderName')} onChange={(e) => set('holderName')(e.target.value)} />
            <div className="pw-form-grid">
              <Input label="Jabatan" value={values.holderPosition} {...ai.field('holderPosition')} onChange={(e) => set('holderPosition')(e.target.value)} hint="Kosongkan: dari Direktori" />
              <Input label="Divisi" value={values.holderDivision} {...ai.field('holderDivision')} onChange={(e) => set('holderDivision')(e.target.value)} hint="Kosongkan: dari Direktori" />
            </div>
          </>
        ) : null}
        <Input
          label={kind === 'return' ? 'Kelengkapan dikembalikan' : 'Kelengkapan'}
          value={values.accessories}
          {...ai.field('accessories')}
          onChange={(e) => set('accessories')(e.target.value)}
          hint={subject === 'device' ? 'Misalnya: charger, tas, mouse' : 'Misalnya: kartu SIM, HP dinas'}
        />
        {subject === 'device' && kind === 'return' ? (
          <Select label="Kondisi saat kembali" value={values.conditionCode} placeholder="Pilih" options={CONDITION_OPTIONS} {...ai.field('conditionCode')} onChange={(e) => set('conditionCode')(e.target.value)} />
        ) : null}
        <Input
          label={kind === 'return' && subject === 'device' ? 'Keterangan kondisi' : 'Kondisi'}
          value={values.condition}
          {...ai.field('condition')}
          onChange={(e) => set('condition')(e.target.value)}
          hint="Misalnya: baik, layar tergores di pojok kanan"
        />
        <Textarea label="Catatan" rows={2} maxLength={1000} value={values.notes} {...ai.field('notes')} onChange={(e) => set('notes')(e.target.value)} />
      </form>
    </Modal>
  );
}
