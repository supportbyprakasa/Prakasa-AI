import { useEffect, useId, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Segmented from '../../components/Segmented';
import Select from '../../components/Select';
import Switch from '../../components/Switch';
import Textarea from '../../components/Textarea';
import { toast } from '../../components/Toast';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import {
  LAYOUTS, generateBody, generateFields, kopBody, kopErrors, kopValues, templateBody, templateErrors,
} from './docTemplateModel';

const errorOf = (error) => error?.response?.data?.error || {};
const PREFIX_ERROR = 'Awalan nomor 2–12 huruf/angka.';
const SOURCE_OPTIONS = [{ value: 'blank', label: 'Template kosong' }, { value: 'copy', label: 'Salin dari Google Docs' }];

// What Prakasa AI may fill in these dialogs (docs/prakasa-ai-rencana.md §9.9).
// Copying a Google Doc (the source and its link), turning a template on or
// off, and the logo file stay with the user. "Buat dokumen" takes its fields
// from each template's own placeholders (f.dynamic): a placeholder named like
// personal data (NIK, NPWP, alamat rumah …), an infrastructure identifier, a
// bank account, a secret or a rupiah amount is listed as user-only — by name,
// here and again on the server (formCatalog.js dynamicFields).
const AI_TEMPLATE_ADD = defineAIForm({
  id: 'doc-template',
  title: 'Tambah template',
  permission: 'template.manage',
  submitLabel: 'Buat template',
  fields: ({ scopes, copying }) => [
    f.text('name', 'Nama template', { required: true, hint: 'Misalnya: Surat tugas, Memo internal' }),
    f.select('scope', 'Untuk', scopes, { required: true }),
    f.userOnly('source', 'Sumber', 'radio', { options: SOURCE_OPTIONS }),
    ...(copying ? [f.userOnly('sourceUrl', 'Tautan Google Docs')] : []),
    f.text('prefix', 'Awalan nomor', { maxLength: 12, hint: '2–12 huruf atau angka. Misalnya ST → ST-202610-0001' }),
    f.text('description', 'Keterangan'),
  ],
});
const AI_TEMPLATE_EDIT = defineAIForm({
  id: 'doc-template-edit',
  title: 'Ubah template',
  permission: 'template.manage',
  submitLabel: 'Simpan',
  mode: 'edit',
  fields: ({ builtin }) => [
    builtin ? f.readOnly('name', 'Nama template') : f.text('name', 'Nama template', { required: true }),
    f.text('prefix', 'Awalan nomor', { required: true, maxLength: 12, hint: '2–12 huruf atau angka.' }),
    f.text('description', 'Keterangan'),
    f.userOnly('isActive', 'Template dipakai', 'checkbox'),
  ],
});
const AI_GENERATE = defineAIForm({
  id: 'doc-generate',
  title: 'Buat dokumen dari template',
  permission: 'document.create',
  submitLabel: 'Buat dokumen',
  fields: ({ placeholders, templateName }) => [
    f.text('docTitle', 'Judul dokumen', { hint: `Kosongkan: "${templateName}". Nama file diakhiri nomor dokumen.` }),
    ...f.dynamic(placeholders.map((item) => ({ name: item.key, label: item.label, type: item.long ? 'textarea' : 'text' }))),
  ],
});
const AI_KOP = defineAIForm({
  id: 'doc-kop',
  title: 'Kop & footer',
  permission: 'template.manage',
  submitLabel: 'Simpan',
  mode: 'edit',
  fields: ({ layouts, withText }) => [
    f.radio('layout', 'Tata letak', layouts),
    ...(withText ? [
      f.text('companyName', 'Nama perusahaan', { required: true }),
      f.text('accentColor', 'Warna aksen', { maxLength: 7, hint: 'Berbentuk #RRGGBB, mis. #1A73E8' }),
      f.textarea('headerLines', 'Baris di bawah nama', { hint: 'Alamat, telepon, email, situs kantor — satu baris per baris, paling banyak 6' }),
      f.userOnly('logo', 'Logo'),
    ] : []),
    f.textarea('footerText', 'Teks footer', { hint: 'Misalnya alamat kantor pusat atau catatan kerahasiaan' }),
    f.checkbox('showPageNumber', 'Tampilkan nomor halaman'),
  ],
});

/** A document just made: number, where it went, and the link. */
function MadeResult({ open, made, onClose }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Dokumen dibuat"
      size="sm"
      footer={(
        <>
          <Button variant="text" onClick={onClose}>Tutup</Button>
          {made?.webViewLink ? <Button icon="open_in_new" href={made.webViewLink} target="_blank" rel="noreferrer">Buka di Google Docs</Button> : null}
        </>
      )}
    >
      {made ? (
        <div className="pw-stack">
          <p>{`${made.title} tersimpan sebagai Google Docs di folder Shared Drive ${made.departmentName}.`}</p>
          <p>{`Nomor dokumen: ${made.number}.${made.withKop ? '' : ' Kop divisi belum diatur, jadi dokumen memakai header bawaan template.'}`}</p>
        </div>
      ) : null}
    </Modal>
  );
}

// "Tambah template": a blank Google Doc with a short guide, or a copy of an
// existing Google Doc (the original stays as it is).
export function AddTemplateDialog({ open, scopes, onClose, onSaved }) {
  const formId = useId();
  const firstScope = scopes.find((s) => s.canManage);
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const emptyValues = { name: '', source: 'blank', sourceUrl: '', prefix: '', description: '', scope: firstScope ? (firstScope.departmentId == null ? 'company' : String(firstScope.departmentId)) : '' };
  useEffect(() => {
    if (!open) return;
    setValues(emptyValues);
    setErrors({}); setFormError('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (name) => (value) => { setValues((v) => ({ ...v, [name]: value })); setErrors((e) => ({ ...e, [name]: undefined })); };
  const submit = async (event) => {
    event.preventDefault();
    const found = templateErrors(values);
    if (!values.scope) found.scope = 'Pilih divisi template.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true); setFormError('');
    try {
      const r = await api.post('/doc-templates', templateBody(values));
      toast('Template dibuat di Shared Drive', 'success');
      await onSaved?.(r.data.data);
    } catch (error) {
      const { message, details } = errorOf(error);
      if (details?.field) setErrors((e) => ({ ...e, [details.field]: message }));
      else setFormError(message || 'Template gagal dibuat.');
    } finally {
      setSaving(false);
    }
  };
  const scopeOptions = scopes.filter((s) => s.canManage).map((s) => ({ value: s.departmentId == null ? 'company' : String(s.departmentId), label: s.departmentName }));
  const ai = usePrakasaAIForm(AI_TEMPLATE_ADD, {
    enabled: open,
    values,
    setValues,
    setErrors,
    validate: (next) => ({ ...templateErrors(next), ...(next.scope ? {} : { scope: 'Pilih divisi template.' }) }),
    initialValues: emptyValues,
    context: { scopes: scopeOptions, copying: values.source === 'copy' },
  });

  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      title="Tambah template"
      size="md"
      footer={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>Buat template</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={submit} noValidate>
        {ai.notice}
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        <Input label="Nama template" required value={values.name || ''} {...ai.field('name')} error={errors.name} onChange={(e) => set('name')(e.target.value)} hint="Misalnya: Surat tugas, Memo internal" />
        <Select label="Untuk" required value={values.scope || ''} {...ai.field('scope')} error={errors.scope} options={scopeOptions} onChange={(e) => set('scope')(e.target.value)} hint="Dokumen disimpan di folder Shared Drive divisi pembuatnya, dengan kop divisi itu" />
        <Segmented
          label="Sumber"
          options={SOURCE_OPTIONS}
          value={values.source}
          onChange={set('source')}
        />
        {values.source === 'copy' ? (
          <Input label="Tautan Google Docs" required value={values.sourceUrl || ''} error={errors.sourceUrl} onChange={(e) => set('sourceUrl')(e.target.value)} hint="Dokumen disalin ke folder Template dokumen; aslinya tidak berubah" />
        ) : null}
        <div className="pw-form-grid">
          <Input label="Awalan nomor" value={values.prefix || ''} {...ai.field('prefix')} error={errors.prefix} onChange={(e) => set('prefix')(e.target.value)} hint="Misalnya ST → ST-202610-0001" />
          <Input label="Keterangan" value={values.description || ''} {...ai.field('description')} onChange={(e) => set('description')(e.target.value)} />
        </div>
        <Banner tone="info">Tulis isian sebagai {'{{nama_isian}}'} di Google Docs. Nomor, tanggal, perusahaan, divisi, dan pembuat terisi otomatis.</Banner>
      </form>
    </Modal>
  );
}

// "Buat dokumen": asks for the template's own placeholders, then makes the
// Google Doc in the division's Shared Drive folder.
export function GenerateDialog({ open, template, onClose, onMade }) {
  const formId = useId();
  const [values, setValues] = useState({});
  const [title, setTitle] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [made, setMade] = useState(null);

  useEffect(() => {
    if (!open) return;
    setValues({}); setTitle(''); setFormError(''); setMade(null);
  }, [open, template]);

  // Prakasa AI may type the title and the template's own placeholders — never
  // one named like personal data, an identifier, a bank account or rupiah.
  const fields = generateFields(template);
  const ai = usePrakasaAIForm(AI_GENERATE, {
    enabled: open && Boolean(template) && !made,
    values: { ...values, docTitle: title },
    setValues,
    setters: { docTitle: setTitle },
    onFill: () => setFormError(''),
    context: { placeholders: fields, templateName: template?.name || '' },
  });
  if (!template) return null;
  if (made) return <MadeResult open={open} made={made} onClose={onClose} />;
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true); setFormError('');
    try {
      const r = await api.post(`/doc-templates/${template.id}/generate`, generateBody(template, values, title));
      setMade(r.data.data);
      toast(`${r.data.data.number} dibuat`, 'success');
      await onMade?.(r.data.data);
    } catch (error) {
      setFormError(errorOf(error).message || 'Dokumen gagal dibuat.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <FullScreenDialog
      open={open}
      onClose={onClose}
      dirty={Object.values(values).some(Boolean)}
      title={`Buat dokumen: ${template.name}`}
      card={false}
      actions={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>Buat dokumen</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack pw-stack--lg" onSubmit={submit} noValidate>
        {ai.notice}
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        <FullScreenSection title="Dokumen">
          <div className="pw-fsdialog__fields">
            <Input label="Judul dokumen" value={title} {...ai.field('docTitle')} onChange={(e) => setTitle(e.target.value)} hint={`Kosongkan: "${template.name}". Nama file diakhiri nomor dokumen.`} />
          </div>
        </FullScreenSection>
        <FullScreenSection title="Isian">
          {fields.length ? (
            <div className="pw-fsdialog__fields">
              {fields.map((f) => (f.long
                ? <Textarea key={f.key} label={f.label} rows={3} value={values[f.key] || ''} {...ai.field(f.key)} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                : <Input key={f.key} label={f.label} value={values[f.key] || ''} {...ai.field(f.key)} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />))}
            </div>
          ) : <p className="pw-muted">Template ini tidak punya isian selain nomor, tanggal, perusahaan, divisi, dan pembuat.</p>}
          <p className="pw-text-helper">Isian kosong ditulis "-". Nomor, tanggal, perusahaan, divisi, dan nama Anda terisi otomatis.</p>
        </FullScreenSection>
      </form>
    </FullScreenDialog>
  );
}

export function EditTemplateDialog({ open, template, onClose, onSaved }) {
  const formId = useId();
  const [values, setValues] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open || !template) return;
    setValues({ name: template.name, prefix: template.prefix, description: template.description || '', isActive: template.isActive });
    setError('');
  }, [open, template]);
  const ai = usePrakasaAIForm(AI_TEMPLATE_EDIT, {
    enabled: open && Boolean(template),
    record: { type: 'doc_template', id: template?.id },
    values,
    setValues,
    onFill: () => setError(''),
    validate: (next) => (/^[A-Za-z0-9]{2,12}$/.test(next.prefix || '') ? {} : { prefix: PREFIX_ERROR }),
    initialValues: { name: template?.name, prefix: template?.prefix, description: template?.description || '', isActive: template?.isActive },
    context: { builtin: Boolean(template?.builtin) },
  });
  if (!template) return null;
  const submit = async (event) => {
    event.preventDefault();
    if (!/^[A-Za-z0-9]{2,12}$/.test(values.prefix || '')) { setError(PREFIX_ERROR); return; }
    setSaving(true); setError('');
    try {
      const body = { prefix: values.prefix.toUpperCase(), description: values.description.trim() || null, isActive: values.isActive };
      if (!template.builtin) body.name = values.name.trim();
      const r = await api.patch(`/doc-templates/${template.id}`, body);
      toast('Template diperbarui', 'success');
      await onSaved?.(r.data.data);
    } catch (e) {
      setError(errorOf(e).message || 'Template gagal disimpan.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      title={`Ubah ${template.name}`}
      size="sm"
      footer={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>Simpan</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={submit} noValidate>
        {ai.notice}
        {error ? <Banner tone="error">{error}</Banner> : null}
        <Input label="Nama template" value={values.name || ''} {...ai.field('name')} disabled={template.builtin} hint={template.builtin ? 'Nama template bawaan tidak diubah' : undefined} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} />
        <Input label="Awalan nomor" value={values.prefix || ''} {...ai.field('prefix')} onChange={(e) => setValues((v) => ({ ...v, prefix: e.target.value }))} />
        <Input label="Keterangan" value={values.description || ''} {...ai.field('description')} onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))} />
        <Switch label="Template dipakai" checked={Boolean(values.isActive)} onChange={(e) => setValues((v) => ({ ...v, isActive: e.target.checked }))} />
        <p className="pw-text-helper">Isi dan tata letak template diubah langsung di Google Docs.</p>
      </form>
    </Modal>
  );
}

// A rough picture of the kop and footer: Google Docs renders the real one.
function KopPreview({ values, logoUrl, letterhead }) {
  const lines = String(values.headerLines || '').split('\n').filter((l) => l.trim()).slice(0, 6);
  const footer = String(values.footerText || '').split('\n').filter((l) => l.trim()).slice(0, 6);
  const centered = values.layout === 'centered' || !logoUrl;
  return (
    <div className="doc-kop-preview" aria-label="Pratinjau kop dan footer">
      {/* The accent colour the user picks is the one dynamic value (a CSS variable). */}
      <div className="doc-kop-preview__page" data-no-translate="" style={{ '--doc-kop-accent': values.accentColor }}>
        {values.layout === 'letterhead_image' ? (
          letterhead ? <img className="doc-kop-preview__banner" src={letterhead} alt="Gambar kop surat divisi" /> : <p className="pw-muted">Gambar kop surat divisi</p>
        ) : (
          <div className={`doc-kop-preview__head${centered ? ' is-centered' : ''}`}>
            {logoUrl ? <img className="doc-kop-preview__logo" src={logoUrl} alt="Logo" /> : null}
            <div className="doc-kop-preview__text">
              <span className="doc-kop-preview__name">{values.companyName || 'Nama perusahaan'}</span>
              {lines.map((l) => <span key={l} className="doc-kop-preview__line">{l}</span>)}
            </div>
          </div>
        )}
        <div className="doc-kop-preview__body" aria-hidden="true"><span /><span /><span /></div>
        <div className="doc-kop-preview__foot">
          {footer.map((l) => <span key={l}>{l}</span>)}
          {values.showPageNumber ? <span>Halaman 1 dari 2</span> : null}
        </div>
      </div>
    </div>
  );
}

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

// Kop & footer of one scope (a division or the whole company). Saved, the app
// builds the Google Doc "Kop & footer — <Divisi>" that every document of that
// division takes its header and footer from.
export function KopDialog({ open, row, companyName, onClose, onSaved }) {
  const formId = useId();
  const [values, setValues] = useState(() => kopValues(row, companyName));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [logo, setLogo] = useState(undefined); // undefined keep, null remove, string new
  const [logoUrl, setLogoUrl] = useState(null);
  const [letterhead, setLetterhead] = useState(null);
  const scope = row ? (row.departmentId == null ? 'company' : String(row.departmentId)) : null;

  useEffect(() => {
    if (!open || !row) return undefined;
    let active = true;
    setValues(kopValues(row, companyName)); setErrors({}); setFormError(''); setDirty(false); setLogo(undefined); setLogoUrl(null); setLetterhead(null);
    if (row.kop?.hasLogo) {
      api.get(`/doc-templates/kops/${scope}/logo`).then((r) => {
        const d = r.data.data;
        if (active && d?.base64) setLogoUrl(`data:${d.mimeType};base64,${d.base64}`);
      }).catch(() => {});
    }
    if (row.hasLetterheadImage && row.departmentId != null) {
      api.get('/letterhead', { params: { departmentId: row.departmentId } }).then((r) => {
        const d = r.data.data;
        if (active && d?.exists) setLetterhead(`data:${d.mimeType};base64,${d.imageBase64}`);
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [open, row, companyName, scope]);

  const layouts = LAYOUTS.map((l) => (l.value === 'letterhead_image' ? { ...l, disabled: !row?.hasLetterheadImage } : l));
  const ai = usePrakasaAIForm(AI_KOP, {
    enabled: open && Boolean(row),
    record: { type: 'doc_kop', id: scope },
    values,
    setValues,
    setErrors,
    onFill: () => setDirty(true),
    validate: (next) => kopErrors(next, { hasLetterheadImage: Boolean(row?.hasLetterheadImage) }),
    initialValues: kopValues(row, companyName),
    context: { layouts, withText: values.layout !== 'letterhead_image' },
  });
  if (!row) return null;
  const set = (name) => (value) => { setValues((v) => ({ ...v, [name]: value })); setErrors((e) => ({ ...e, [name]: undefined })); setDirty(true); };
  const pickLogo = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 1024 * 1024) {
      setErrors((e) => ({ ...e, logo: 'Logo harus PNG atau JPG, paling besar 1 MB.' }));
      return;
    }
    const url = await readAsDataUrl(file);
    setLogo(url); setLogoUrl(url); setDirty(true); setErrors((e) => ({ ...e, logo: undefined }));
  };
  const submit = async (event) => {
    event.preventDefault();
    const found = kopErrors(values, { hasLetterheadImage: row.hasLetterheadImage });
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true); setFormError('');
    try {
      const r = await api.put(`/doc-templates/kops/${scope}`, kopBody(values, logo, row.kop?.version));
      toast(`Kop & footer ${row.departmentName} disimpan`, 'success');
      await onSaved?.(r.data.data);
    } catch (error) {
      const { code, message, details } = errorOf(error);
      if (code === 'VERSION_CONFLICT') setFormError('Kop ini sudah diubah orang lain. Tutup, muat ulang, lalu ulangi.');
      else if (details?.field) setErrors((e) => ({ ...e, [details.field]: message }));
      else setFormError(message || 'Kop gagal disimpan.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <FullScreenDialog
      open={open}
      onClose={onClose}
      dirty={dirty}
      title={`Kop & footer — ${row.departmentName}`}
      card={false}
      actions={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>Simpan</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack pw-stack--lg" onSubmit={submit} noValidate>
        {ai.notice}
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        {row.kop?.webViewLink ? (
          <Banner tone="info" action={<Button variant="text" icon="open_in_new" href={row.kop.webViewLink} target="_blank" rel="noreferrer">Buka di Google Docs</Button>}>
            Kop ini juga bisa dirapikan langsung di Google Docs. Menyimpan dari sini akan menimpa perubahan yang dibuat di Google Docs.
          </Banner>
        ) : null}
        <FullScreenSection title="Kop (header)">
          <div className="pw-stack">
            <Segmented label="Tata letak" options={layouts} value={values.layout} {...ai.field('layout')} onChange={set('layout')} />
            {errors.layout ? <p className="pw-text-helper" role="alert">{errors.layout}</p> : null}
            {values.layout !== 'letterhead_image' ? (
              <div className="pw-fsdialog__fields">
                <Input label="Nama perusahaan" required value={values.companyName} {...ai.field('companyName')} error={errors.companyName} onChange={(e) => set('companyName')(e.target.value)} />
                <Input label="Warna aksen" value={values.accentColor} {...ai.field('accentColor')} error={errors.accentColor} onChange={(e) => set('accentColor')(e.target.value)} hint="Warna nama perusahaan dan garis kop, mis. #1A73E8" />
                <Textarea label="Baris di bawah nama" rows={3} value={values.headerLines} {...ai.field('headerLines')} error={errors.headerLines} onChange={(e) => set('headerLines')(e.target.value)} hint="Alamat, telepon, email, situs — satu baris per baris, paling banyak 6" />
                <div className="pw-stack pw-stack--sm">
                  <Input label="Logo" type="file" accept="image/png,image/jpeg" error={errors.logo} onChange={pickLogo} hint="PNG atau JPG, paling besar 1 MB" />
                  {logoUrl ? <Button variant="text" icon="delete" type="button" onClick={() => { setLogo(null); setLogoUrl(null); setDirty(true); }}>Hapus logo</Button> : null}
                </div>
              </div>
            ) : (
              <p className="pw-muted">Memakai gambar kop surat divisi (Cap surat) selebar halaman.</p>
            )}
          </div>
        </FullScreenSection>
        <FullScreenSection title="Footer">
          <div className="pw-fsdialog__fields">
            <Textarea label="Teks footer" rows={2} value={values.footerText} {...ai.field('footerText')} onChange={(e) => set('footerText')(e.target.value)} hint="Misalnya alamat kantor pusat atau catatan kerahasiaan" />
            <Switch label="Tampilkan nomor halaman" checked={Boolean(values.showPageNumber)} {...ai.field('showPageNumber')} onChange={(e) => set('showPageNumber')(e.target.checked)} />
          </div>
        </FullScreenSection>
        <FullScreenSection title="Pratinjau">
          <KopPreview values={values} logoUrl={logoUrl} letterhead={letterhead} />
        </FullScreenSection>
      </form>
    </FullScreenDialog>
  );
}
