import { noTranslate } from '../../i18n/NoTranslate';
import { useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import Banner from '../Banner';
import Button from '../Button';
import Chip from '../Chip';
import Icon from '../Icon';
import IconButton from '../IconButton';
import { toast } from '../Toast';
import { useAuth } from '../../context/AuthContext';
import BrandDoodles from '../BrandDoodles';
import AIComposer from './AIComposer';
import { AIAttachmentErrors } from './AIAttachmentChips';
import AIDropdown from './AIDropdown';
import AIWebToggle from './AIWebToggle';
import useFileDrop from './useFileDrop';
import { CreateSessionModal } from './AISessionList';
import {
  VISIBILITY_LABELS,
  engineChipLabel,
  engineMenuItems,
  visibilityMenuItems,
} from './aiEngineOptions';
import {
  AI_FILE_ACCEPT,
  AI_MAX_MESSAGE_ATTACHMENTS,
  AI_MAX_PENDING_FILES,
  AI_MAX_UPLOAD_BYTES,
  addAttachments,
  formatBytes,
  markUploaded,
} from './aiFiles';
import {
  firstNameOf,
  greetingForHour,
  titleFromMessage,
} from '../../pages/ai/aiCommandCenterModel';

const SUGGESTIONS = [
  'Bantu susun draft dokumen',
  'Ringkas laporan minggu ini',
  'Periksa selisih data penjualan',
];

const VISIBILITY_ICONS = { private: 'lock', department: 'group', entity: 'domain' };

// `surface`: 'panel' in the side panel on a page. There the files belong to the
// first message (at most three, private conversation only — §9.15) and the
// message names them; in the Command Center they are conversation documents.
export default function AINewChat({ providers, providersLoading, onSessionCreated, initialVisibility = 'private', surface = 'full' }) {
  const panel = surface === 'panel';
  const maxFiles = panel ? AI_MAX_MESSAGE_ATTACHMENTS : AI_MAX_PENDING_FILES;
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const canCreate = permissions.includes('ai_command.use');
  const canAttach = canCreate && permissions.includes('document.create');
  const available = providers.filter((item) => item.available);
  const defaultProvider = (available.find((item) => item.isDefault) || available[0])?.id || '';

  const [provider, setProvider] = useState('');
  const visibilityItems = visibilityMenuItems(user);
  const [visibility, setVisibility] = useState(() => (
    visibilityItems.some((item) => item.value === initialVisibility) ? initialVisibility : 'private'
  ));
  const [divisions, setDivisions] = useState(null);
  const [departmentId, setDepartmentId] = useState(null);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [webResearch, setWebResearch] = useState(false);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Why the message cannot be sent yet, shown in the form (not a snackbar).
  const [formError, setFormError] = useState('');
  // Side panel: why a file was not attached (type, size, more than three).
  const [attachErrors, setAttachErrors] = useState([]);
  useEffect(() => { setFormError(''); }, [visibility, departmentId, provider, providers]);
  const fileInputRef = useRef(null);

  // Divisions are loaded only when a shared division chat is chosen.
  useEffect(() => {
    if (visibility !== 'department' || divisions) return undefined;
    let cancelled = false;
    api.get('/ai-command/divisions')
      .then((response) => {
        if (cancelled) return;
        const data = response.data.data || { divisions: [] };
        setDivisions(data.divisions || []);
        const own = data.divisions.find((item) => Number(item.id) === Number(data.defaultDepartmentId));
        setDepartmentId(own?.id || (data.divisions.length === 1 ? data.divisions[0].id : null));
      })
      .catch(() => { if (!cancelled) setDivisions([]); });
    return () => { cancelled = true; };
  }, [visibility, divisions]);

  const selectedDivision = (divisions || []).find((item) => Number(item.id) === Number(departmentId));

  const selectedProvider = available.some((item) => item.id === provider) ? provider : defaultProvider;
  const webCapable = Boolean(available.find((item) => item.id === selectedProvider)?.webResearch);

  const addFiles = (fileList) => {
    if (panel) {
      const { next, errors } = addAttachments(attachments, fileList);
      setAttachments(next);
      setAttachErrors(errors);
      return;
    }
    const picked = Array.from(fileList || []);
    const tooBig = picked.filter((file) => file.size > AI_MAX_UPLOAD_BYTES);
    if (tooBig.length) toast(`Ukuran file maksimum ${formatBytes(AI_MAX_UPLOAD_BYTES)}: ${tooBig.map((f) => f.name).join(', ')}`, 'error');
    const accepted = picked.filter((file) => file.size <= AI_MAX_UPLOAD_BYTES);
    const room = Math.max(AI_MAX_PENDING_FILES - attachments.length, 0);
    if (accepted.length > room) toast(`Maksimum ${AI_MAX_PENDING_FILES} file per pesan`, 'error');
    const added = accepted.slice(0, room).map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file }));
    setAttachments((current) => [...current, ...added]);
  };

  const { dragging, dropProps } = useFileDrop(addFiles, canAttach && !creating);
  const name = firstNameOf(user);
  const greeting = greetingForHour(new Date().getHours());

  const submit = async () => {
    const text = input.trim();
    if (!text || creating) return;
    if (!selectedProvider) {
      setFormError('Belum ada engine AI yang tersedia untuk akun Anda.');
      return;
    }
    if (visibility === 'department' && !departmentId) {
      setFormError('Pilih divisi untuk percakapan bersama ini.');
      return;
    }
    if (panel && attachments.length && (visibility !== 'private' || (webCapable && webResearch))) {
      setFormError('Lampiran hanya bisa dipakai di percakapan pribadi tanpa riset web. Pilih "Pribadi" dan matikan riset web, atau hapus lampirannya.');
      return;
    }
    setFormError('');

    setCreating(true);
    setProgress('Membuat percakapan…');
    let sessionId;
    try {
      const response = await api.post('/ai-command/sessions', {
        title: titleFromMessage(text),
        visibility,
        ...(visibility === 'department' ? { departmentId: Number(departmentId) } : {}),
        provider: selectedProvider,
        webResearch: webCapable && webResearch,
      });
      sessionId = response.data.data.id;
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal memulai percakapan', 'error');
      setCreating(false);
      setProgress('');
      return;
    }

    // Files are attached before the first message so the AI can read them in its answer.
    const failed = [];
    let uploaded = [];
    for (let index = 0; index < attachments.length; index += 1) {
      const { file } = attachments[index];
      setProgress(`Mengunggah file ${index + 1} dari ${attachments.length}…`);
      const form = new FormData();
      form.append('file', file);
      try {
        const response = await api.post(`/ai-command/sessions/${sessionId}/files`, form);
        if (panel) uploaded = [...uploaded, ...markUploaded([attachments[index]], attachments[index].key, response.data.data)];
      } catch (error) {
        failed.push({ name: file.name, message: error.response?.data?.error?.message });
      }
    }

    if (failed.length) {
      toast(
        `Gagal mengunggah ${failed.map((item) => item.name).join(', ')}${failed[0].message ? ` (${failed[0].message})` : ''}. Pesan belum dikirim — lampirkan ulang lalu kirim.`,
        'error',
      );
      onSessionCreated(sessionId, text, { autoSend: false, showDocuments: attachments.length > failed.length, attachments: uploaded });
      return;
    }

    onSessionCreated(sessionId, text, { showDocuments: attachments.length > 0, attachments: uploaded });
  };

  const attachmentChips = attachments.length > 0 && (
    <div className="ai-attachments" aria-label="File terlampir">
      {attachments.map(({ key, file }) => (
        <span key={key} className="ai-attachment-chip">
          <Icon name="description" size="sm" />
          <span className="pw-tooltip-anchor ai-attachment-name" data-pw-tooltip={file.name}>
            <span data-no-translate="" className="ai-attachment-text">{file.name}</span>
          </span>
          <span className="ai-attachment-size">{formatBytes(file.size)}</span>
          <IconButton
            size="sm"
            label="Hapus lampiran"
            icon="close"
            onClick={() => setAttachments((current) => current.filter((item) => item.key !== key))}
            disabled={creating}
            aria-label={`Hapus lampiran ${file.name}`}
          />
        </span>
      ))}
    </div>
  );

  return (
    <div className="ai-new-chat" {...dropProps}>
      <BrandDoodles />
      {dragging && (
        <div className="ai-drop-overlay" aria-hidden="true">
          <Icon name="upload" size="xl" />
          <span>Lepaskan file untuk dilampirkan</span>
        </div>
      )}
      <div className="ai-new-chat-inner">
        <h1 className="ai-greeting">
          <span className="ai-greeting-mark" aria-hidden="true"><Icon name="auto_awesome" /></span>
          <span>{greeting}{name ? <>, <span {...noTranslate}>{name}</span></> : null}</span>
        </h1>

        {!canCreate ? (
          <p className="ai-greeting-sub">
            Akun Anda belum memiliki izin untuk memulai percakapan AI. Pilih percakapan yang dibagikan dari panel kiri.
          </p>
        ) : (
          <>
            <p className="ai-greeting-sub">Apa yang ingin Anda kerjakan hari ini?</p>
            <AIComposer
              value={input}
              onChange={setInput}
              onSubmit={submit}
              autoFocus
              busy={creating}
              disabled={creating}
              sendDisabled={creating || !input.trim() || !selectedProvider}
              placeholder={attachments.length
                ? 'Apa yang ingin Anda lakukan dengan file ini?'
                : 'Tanyakan atau minta apa saja ke Prakasa AI…'}
              header={attachmentChips}
              onFiles={canAttach ? addFiles : undefined}
              tools={(
                <>
                  {canAttach && (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="pw-visually-hidden"
                        tabIndex={-1}
                        aria-label="Lampirkan file ke percakapan"
                        accept={AI_FILE_ACCEPT}
                        onChange={(event) => {
                          addFiles(event.target.files);
                          event.target.value = '';
                        }}
                      />
                      <IconButton
                        label="Lampirkan file"
                        icon="attach_file"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={creating || attachments.length >= maxFiles}
                        aria-label={`Lampirkan file (maks. ${maxFiles} file, ${formatBytes(AI_MAX_UPLOAD_BYTES)} per file)`}
                      />
                    </>
                  )}
                  {webCapable && (
                    <AIWebToggle
                      active={webResearch}
                      onToggle={() => setWebResearch((current) => !current)}
                      disabled={creating}
                    />
                  )}
                  <AIDropdown
                    icon={VISIBILITY_ICONS[visibility]}
                    label={VISIBILITY_LABELS[visibility]}
                    ariaLabel="Siapa yang dapat melihat percakapan ini"
                    items={visibilityItems}
                    value={visibility}
                    onSelect={setVisibility}
                    disabled={creating}
                    placement="bottom"
                  />
                  {visibility === 'department' && (divisions || []).length > 1 && (
                    <AIDropdown
                      icon="group"
                      label={selectedDivision?.name || 'Pilih divisi'}
                      ariaLabel="Divisi untuk percakapan bersama"
                      items={divisions.map((item) => ({ value: item.id, label: item.name }))}
                      value={departmentId}
                      onSelect={setDepartmentId}
                      disabled={creating}
                      placement="bottom"
                    />
                  )}
                </>
              )}
              trailing={(
                <AIDropdown
                  label={providersLoading
                    ? 'Engine AI'
                    : selectedProvider ? engineChipLabel(providers, selectedProvider) : 'Tidak ada engine'}
                  dataLabel={!providersLoading && Boolean(selectedProvider)}
                  ariaLabel="Pilih engine AI"
                  items={engineMenuItems(providers)}
                  value={selectedProvider}
                  onSelect={setProvider}
                  disabled={creating || providersLoading || !available.length}
                  align="right"
                  placement="bottom"
                />
              )}
            />
            <AIAttachmentErrors errors={attachErrors} onClose={() => setAttachErrors([])} />
            {formError ? <Banner tone="error">{formError}</Banner> : null}
            {progress && <p className="ai-progress-note" role="status">{progress}</p>}
            {!progress && visibility === 'department' && (
              <p className="ai-progress-note">
                {selectedDivision
                  ? `Percakapan bersama: semua anggota divisi ${selectedDivision.name} dapat membaca dan ikut bertanya.`
                  : divisions && !divisions.length
                    ? 'Akun Anda belum terdaftar di divisi mana pun.'
                    : 'Pilih divisi untuk percakapan bersama ini.'}
              </p>
            )}

            <div className="ai-suggestions" aria-label="Saran permintaan">
              {SUGGESTIONS.map((suggestion) => (
                <Chip key={suggestion} onClick={() => setInput(suggestion)} disabled={creating}>
                  {suggestion}
                </Chip>
              ))}
            </div>

            <div className="ai-advanced-link">
              <Button variant="text" icon="tune" onClick={() => setAdvancedOpen(true)} disabled={creating}>
                Buka opsi lanjutan
              </Button>
            </div>
          </>
        )}
      </div>

      <p className="ai-disclaimer">
        Prakasa AI dapat membuat kesalahan. Periksa kembali informasi penting. · Didukung Prakasa
      </p>

      <CreateSessionModal
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        onCreated={(id) => {
          setAdvancedOpen(false);
          onSessionCreated(id, null);
        }}
      />
    </div>
  );
}
