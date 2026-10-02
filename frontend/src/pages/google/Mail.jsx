import { tr } from '../../i18n/tr.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Page from '../../components/Page';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import Icon from '../../components/Icon';
import IconButton from '../../components/IconButton';
import ActionMenu from '../../components/ActionMenu';
import Menu from '../../components/Menu';
import SearchField from '../../components/SearchField';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import Textarea from '../../components/Textarea';
import FormActions from '../../components/FormActions';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import GoogleAvatar from './GoogleAvatar';
import {
  ALL_MAIL, EMPTY_DRAFT, applyThreadAction, composeFieldError, composeToFromParam, buildLabelNav, buildMailSrcdoc,
  buildReplyDraft, composePayload, decodeEntities, displayName, formatBytes, formatFullDate, formatListDate,
  hasRemoteImages, isScopeMissing, isValidThreadId, labelName, mailError, normalizeLabelParam, parseAddressHeader,
  sanitizeQuery, senderIsRecord, senderLabel, MAX_QUERY,
  SYSTEM_LABELS,
} from './mailModel';
import './mail.css';

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Email body. HTML is shown ONLY inside a sandboxed iframe (no allow-scripts)
// whose srcdoc carries a CSP that blocks every request except data:/cid:
// images — and https: images once the user chooses "Tampilkan gambar".
// allow-same-origin (without scripts) only lets this page read the frame's
// height; allow-popups lets links open in a new tab.
function MailFrame({ html, showImages }) {
  const frameRef = useRef(null);
  const srcDoc = useMemo(() => buildMailSrcdoc(html, { showRemoteImages: showImages }), [html, showImages]);

  const fit = useCallback(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc?.documentElement) return;
    frame.style.height = `${Math.max(48, doc.documentElement.scrollHeight)}px`;
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    let observer = null;
    const onLoad = () => {
      fit();
      observer?.disconnect();
      const body = frame.contentDocument?.body;
      if (body && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(fit);
        observer.observe(body);
      }
    };
    frame.addEventListener('load', onLoad);
    return () => { frame.removeEventListener('load', onLoad); observer?.disconnect(); };
  }, [fit, srcDoc]);

  return (
    <iframe
      ref={frameRef}
      title="Isi email"
      className="mail-frame"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
    />
  );
}

async function downloadAttachment(message, attachment) {
  try {
    const response = await api.get(
      `/google-mail/messages/${message.id}/attachments/${encodeURIComponent(attachment.partId)}`,
      { responseType: 'blob' },
    );
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = attachment.filename || 'lampiran';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) {
    toast(isScopeMissing(err) ? 'Lampiran belum bisa diunduh: izin baca Gmail belum diberikan.' : 'Gagal mengunduh lampiran', 'error');
  }
}

function MessageItem({ message, myEmail, defaultOpen, showImages, onReply }) {
  const [open, setOpen] = useState(defaultOpen);
  const from = parseAddressHeader(message.from)[0] || { name: '', email: '' };
  const to = parseAddressHeader(message.to).map(displayName).join(', ');
  const cc = parseAddressHeader(message.cc).map(displayName).join(', ');
  const name = senderLabel(message.from, myEmail);

  return (
    <details className="mail-message" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="mail-message__summary pw-state-layer">
        <GoogleAvatar name={from.name || from.email} />
        <span className="mail-message__who">
          <span className="mail-message__from" data-no-translate={senderIsRecord(message.from, myEmail) ? '' : undefined}>{name}</span>
          {from.name && open ? <span data-no-translate="" className="mail-message__email"> &lt;{from.email}&gt;</span> : null}
          {open ? null : <span data-no-translate="" className="mail-message__preview">{decodeEntities(message.snippet)}</span>}
        </span>
        <span className="mail-message__date">{formatFullDate(message.date)}</span>
      </summary>
      {open ? (
        <div className="mail-message__content">
          <div className="mail-message__meta">
            <dl className="mail-message__headers">
              <div><dt>Kepada</dt><dd data-no-translate={to ? '' : undefined}>{to || '—'}</dd></div>
              {cc ? <div><dt>Cc</dt><dd data-no-translate="">{cc}</dd></div> : null}
              {message.bcc ? <div><dt>Bcc</dt><dd data-no-translate="">{parseAddressHeader(message.bcc).map(displayName).join(', ')}</dd></div> : null}
            </dl>
            <ActionMenu
              label="Aksi email"
              size="sm"
              items={[
                { label: 'Balas', icon: 'reply', onClick: () => onReply(message, 'reply') },
                { label: 'Balas semua', icon: 'reply_all', onClick: () => onReply(message, 'replyAll') },
                { label: 'Teruskan', icon: 'forward', onClick: () => onReply(message, 'forward') },
              ]}
            />
          </div>
          {message.html
            ? <MailFrame html={message.html} showImages={showImages} />
            : <div data-no-translate="" className="mail-message__text">{message.text || decodeEntities(message.snippet)}</div>}
          {message.attachments?.length ? (
            <div className="mail-attachments" role="group" aria-label="Lampiran">
              {message.attachments.map((attachment) => (
                <Button
                  key={attachment.partId}
                  type="button"
                  variant="secondary"
                  icon="attach_file"
                  className="mail-attachment"
                  tooltip={`Unduh ${attachment.filename}`}
                  onClick={() => downloadAttachment(message, attachment)}
                >
                  <span data-no-translate="" className="mail-attachment__name">{attachment.filename}</span>
                  <span className="mail-attachment__size">{formatBytes(attachment.size)}</span>
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function ThreadView({ threadId, labelId, myEmail, onBack, onAction, onReply, readBlocked, onCompose }) {
  const [thread, setThread] = useState(null);
  const [state, setState] = useState('idle');
  const [error, setError] = useState(null);
  const [showImages, setShowImages] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!threadId) { setThread(null); setState('idle'); return undefined; }
    let alive = true;
    setState('loading');
    setShowImages(false);
    api.get(`/google-mail/threads/${threadId}`)
      .then((response) => {
        if (!alive) return;
        const data = response.data.data;
        setThread(data);
        setState('ready');
        if (data.unread) onAction(threadId, 'read', { silent: true });
      })
      .catch((err) => { if (alive) { setError(mailError(err, 'Gagal membuka email')); setState('error'); } });
    return () => { alive = false; };
  // onAction is stable enough per page; re-running only on thread change is intended.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, reload]);

  if (!threadId) {
    return readBlocked ? (
      <EmptyState
        icon="send"
        title="Tetap bisa mengirim email"
        description="Selama izin baca belum diberikan, Anda tetap bisa menulis dan mengirim email dari sini."
        action={<Button icon="edit" onClick={onCompose}>Tulis email</Button>}
      />
    ) : <EmptyState icon="mail" title="Pilih email untuk dibaca" description="Percakapan yang Anda pilih tampil di sini." />;
  }

  // The list and the message share one pane below 1024px: this returns to the list.
  const back = <IconButton icon="arrow_back" label="Kembali ke daftar email" className="mail-detail__back" onClick={onBack} />;
  if (state === 'loading' || state === 'idle') return <div className="mail-detail__pad">{back}<LoadingState label="Membuka email…" /></div>;
  if (state === 'error') {
    return (
      <div className="mail-detail__pad">
        {back}
        <EmptyState tone="error" title="Email tidak bisa dibuka" description={error?.message}
          action={<Button variant="text" onClick={() => setReload((n) => n + 1)}>Coba lagi</Button>} />
      </div>
    );
  }

  const messages = thread.messages || [];
  const last = messages[messages.length - 1];
  const inTrash = thread.labelIds.includes('TRASH');
  const inInbox = thread.labelIds.includes('INBOX');
  const remote = !showImages && messages.some((m) => m.html && hasRemoteImages(m.html));
  const act = async (action) => {
    const done = await onAction(threadId, action);
    if (!done) return;
    if (['archive', 'trash', 'untrash', 'inbox'].includes(action)) {
      if ((action === 'archive' && labelId === 'INBOX') || (action === 'trash' && labelId !== 'TRASH') || (action === 'untrash' && labelId === 'TRASH')) onBack();
      else setReload((n) => n + 1);
    } else {
      setThread((current) => ({
        ...current,
        unread: action === 'unread' ? true : action === 'read' ? false : current.unread,
        starred: action === 'star' ? true : action === 'unstar' ? false : current.starred,
      }));
      if (action === 'unread') onBack();
    }
  };

  return (
    <article className="mail-thread" aria-label="Percakapan email">
      <div className="mail-thread__toolbar" role="toolbar" aria-label="Aksi percakapan">
        {back}
        {inTrash ? (
          <IconButton icon="restore_from_trash" label="Pindahkan dari sampah" onClick={() => act('untrash')} />
        ) : (
          <>
            {inInbox
              ? <IconButton icon="archive" label="Arsipkan" onClick={() => act('archive')} />
              : <IconButton icon="move_to_inbox" label="Pindahkan ke kotak masuk" onClick={() => act('inbox')} />}
            <IconButton icon="delete" label="Pindahkan ke sampah" onClick={() => act('trash')} />
          </>
        )}
        <IconButton icon="mark_email_unread" label="Tandai belum dibaca" onClick={() => act('unread')} />
        <IconButton
          icon={<Icon name="star" filled={thread.starred} />}
          label={thread.starred ? 'Hapus bintang' : 'Beri bintang'}
          className={thread.starred ? 'mail-star is-on' : 'mail-star'}
          aria-pressed={thread.starred}
          onClick={() => act(thread.starred ? 'unstar' : 'star')}
        />
      </div>
      <h2 className="mail-thread__subject" data-no-translate={thread.subject ? '' : undefined}>{thread.subject || '(tanpa subjek)'}</h2>
      {remote ? (
        <Banner tone="info" title="Gambar dari luar disembunyikan"
          action={<Button variant="text" onClick={() => setShowImages(true)}>Tampilkan gambar</Button>}>
          Ini melindungi privasi Anda dari pelacak di dalam email.
        </Banner>
      ) : null}
      <div className="mail-thread__messages">
        {messages.map((message, index) => (
          <MessageItem
            key={message.id}
            message={message}
            myEmail={myEmail}
            defaultOpen={index === messages.length - 1 || message.unread}
            showImages={showImages}
            onReply={onReply}
          />
        ))}
      </div>
      {last ? (
        <div className="mail-thread__reply">
          <Button variant="secondary" icon="reply" onClick={() => onReply(last, 'reply')}>Balas</Button>
          <Button variant="secondary" icon="reply_all" onClick={() => onReply(last, 'replyAll')}>Balas semua</Button>
          <Button variant="secondary" icon="forward" onClick={() => onReply(last, 'forward')}>Teruskan</Button>
        </div>
      ) : null}
    </article>
  );
}

const COMPOSE_TITLES = { new: 'Pesan baru', reply: 'Balas', replyAll: 'Balas semua', forward: 'Teruskan' };

function ComposeModal({ open, draft: current, onChange, onClose, onSent }) {
  const draft = current || EMPTY_DRAFT;
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(null); // 'send' | 'draft'
  const [showCc, setShowCc] = useState(Boolean(draft.cc || draft.bcc));

  // A fresh start each time the dialog opens or switches to another draft.
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setShowCc(Boolean(draft.cc || draft.bcc));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft.mode, draft.threadId]);

  const set = (key) => (event) => {
    onChange({ ...draft, [key]: event.target.value });
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async (kind) => {
    const { payload, errors: found } = composePayload(draft);
    if (found) { setErrors(found); if (found.cc || found.bcc) setShowCc(true); return; }
    setErrors({});
    setBusy(kind);
    try {
      await api.post(kind === 'draft' ? '/google-mail/drafts' : '/google-mail/send', payload);
      toast(kind === 'draft' ? 'Draf disimpan di Gmail' : 'Email terkirim', 'success');
      onSent(kind);
    } catch (err) {
      const fieldError = composeFieldError(err, payload);
      if (fieldError) {
        setErrors({ [fieldError.field]: fieldError.message });
        if (fieldError.field === 'cc' || fieldError.field === 'bcc') setShowCc(true);
      } else toast(mailError(err, kind === 'draft' ? 'Gagal menyimpan draf' : 'Gagal mengirim email').message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={COMPOSE_TITLES[draft.mode] || COMPOSE_TITLES.new} size="md">
      <form className="pw-stack" noValidate onSubmit={(event) => { event.preventDefault(); submit('send'); }}>
        <Input label="Kepada" required name="mail-to" value={draft.to} onChange={set('to')} error={errors.to}
          hint="Pisahkan beberapa alamat dengan koma" placeholder="nama@prakasafoods.com" autoComplete="off" />
        {showCc ? (
          <div className="pw-form-grid">
            <Input label="Cc" name="mail-cc" value={draft.cc} onChange={set('cc')} error={errors.cc} autoComplete="off" />
            <Input label="Bcc" name="mail-bcc" value={draft.bcc} onChange={set('bcc')} error={errors.bcc} autoComplete="off" />
          </div>
        ) : (
          <div><Button type="button" variant="text" onClick={() => setShowCc(true)}>Tambah Cc/Bcc</Button></div>
        )}
        <Input label="Subjek" name="mail-subject" value={draft.subject} onChange={set('subject')} error={errors.subject} maxLength={500} />
        <Textarea label="Pesan" name="mail-body" rows={10} value={draft.body} onChange={set('body')} error={errors.body} />
        <FormActions>
          <Button type="button" variant="text" onClick={onClose}>Batal</Button>
          <Button type="button" variant="secondary" loading={busy === 'draft'} disabled={Boolean(busy)} onClick={() => submit('draft')}>Simpan draf</Button>
          <Button type="submit" icon="send" loading={busy === 'send'} disabled={Boolean(busy)}>Kirim email</Button>
        </FormActions>
      </form>
    </Modal>
  );
}

// Gmail folders as filter chips; the user's own labels sit behind one "Label"
// chip that opens a menu (there can be many).
function FolderChips({ nav, labelId, onSelect }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const activeLabel = nav.user.find((item) => item.id === labelId);
  const text = (item) => (item.count ? `${item.name} (${item.count})` : item.name);

  return (
    <div className="mail-folders" role="group" aria-label="Folder Gmail" data-i18n-context="mail">
      {nav.system.map((item) => (
        <Chip key={item.id} selected={item.id === labelId} onClick={() => onSelect(item.id)}>{text(item)}</Chip>
      ))}
      {nav.user.length ? (
        <>
          <Chip
            ref={anchorRef}
            selected={Boolean(activeLabel)}
            data={Boolean(activeLabel)}
            trailingIcon="arrow_drop_down"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {activeLabel ? text(activeLabel) : 'Label'}
          </Chip>
          <Menu
            open={open}
            anchorRef={anchorRef}
            onClose={() => setOpen(false)}
            align="start"
            label="Label Gmail"
            items={nav.user.map((item) => ({
              key: item.id, label: text(item), data: true, icon: 'label', checked: item.id === labelId, onClick: () => onSelect(item.id),
            }))}
          />
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function Mail() {
  const { user } = useAuth();
  const myEmail = user?.email || '';
  const [params, setParams] = useSearchParams();
  const labelId = normalizeLabelParam(params.get('label'));
  const query = sanitizeQuery(params.get('q'));
  const threadParam = params.get('thread');
  const threadId = isValidThreadId(threadParam) ? threadParam : null;

  const [labels, setLabels] = useState([]);
  const [readBlocked, setReadBlocked] = useState(false);
  const [list, setList] = useState({ state: 'loading', threads: [], next: null, estimate: 0, error: null });
  const [pages, setPages] = useState([null]); // page tokens; last = current page
  const [search, setSearch] = useState(query);
  const [draft, setDraft] = useState(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const nav = useMemo(() => buildLabelNav(labels), [labels]);
  const pageToken = pages[pages.length - 1];

  const loadLabels = useCallback(() => {
    api.get('/google-mail/labels')
      .then((response) => { setLabels(response.data.data.labels || []); setReadBlocked(false); })
      .catch((err) => { if (isScopeMissing(err)) setReadBlocked(true); });
  }, []);

  useEffect(() => { loadLabels(); }, [loadLabels, refreshKey]);

  // Deep link from other pages (e.g. Groups → "Kirim email ke grup"): /mail?compose=to:<email>
  const composeParam = params.get('compose');
  useEffect(() => {
    if (!composeParam) return;
    const to = composeToFromParam(composeParam);
    setDraft({ ...EMPTY_DRAFT, to });
    setComposeOpen(true);
    setParams((current) => { const next = new URLSearchParams(current); next.delete('compose'); return next; }, { replace: true });
  }, [composeParam, setParams]);
  useEffect(() => { setPages([null]); setSearch(query); }, [labelId, query]);

  useEffect(() => {
    let alive = true;
    setList((current) => ({ ...current, state: 'loading', error: null }));
    const requestParams = { maxResults: PAGE_SIZE };
    if (labelId !== ALL_MAIL) requestParams.labelId = labelId;
    if (query) requestParams.q = query;
    if (pageToken) requestParams.pageToken = pageToken;
    api.get('/google-mail/threads', { params: requestParams })
      .then((response) => {
        if (!alive) return;
        const data = response.data.data;
        setReadBlocked(false);
        setList({ state: 'ready', threads: data.threads || [], next: data.nextPageToken, estimate: data.resultSizeEstimate || 0, error: null });
      })
      .catch((err) => {
        if (!alive) return;
        if (isScopeMissing(err)) setReadBlocked(true);
        setList({ state: 'error', threads: [], next: null, estimate: 0, error: mailError(err, 'Gagal memuat email') });
      });
    return () => { alive = false; };
  }, [labelId, query, pageToken, refreshKey]);

  const hrefFor = (next) => {
    const merged = new URLSearchParams();
    const label = next.label ?? labelId;
    if (label !== 'INBOX') merged.set('label', label);
    const q = 'q' in next ? next.q : query;
    if (q) merged.set('q', q);
    if (next.thread) merged.set('thread', next.thread);
    const text = merged.toString();
    return text ? `?${text}` : '?';
  };
  const go = (next) => setParams(new URLSearchParams(hrefFor(next).slice(1)));

  const closeThread = () => go({});

  const runAction = useCallback(async (id, action, { silent = false } = {}) => {
    try {
      await api.post(`/google-mail/threads/${id}/actions`, { action });
      setList((current) => ({ ...current, threads: applyThreadAction(current.threads, id, action, labelId) }));
      if (!silent) {
        const messages = {
          archive: 'Percakapan diarsipkan', inbox: 'Dipindahkan ke kotak masuk', trash: 'Dipindahkan ke sampah',
          untrash: 'Dipindahkan dari sampah', unread: 'Ditandai belum dibaca',
        };
        if (messages[action]) toast(messages[action], 'success');
      }
      if (['read', 'unread', 'archive', 'trash', 'untrash', 'inbox'].includes(action)) loadLabels();
      return true;
    } catch (err) {
      if (!silent) toast(mailError(err, 'Aksi gagal').message, 'error');
      return false;
    }
  }, [labelId, loadLabels]);

  const openCompose = (next) => { setDraft(next); setComposeOpen(true); };
  const compose = () => {
    const keep = draft && draft.mode === 'new' && (draft.to || draft.subject || draft.body);
    openCompose(keep ? draft : { ...EMPTY_DRAFT });
  };
  const reply = (message, mode) => openCompose(buildReplyDraft(message, mode, myEmail));
  const onSent = () => {
    setComposeOpen(false);
    setDraft(null);
    if (!readBlocked) setRefreshKey((n) => n + 1);
  };

  const submitSearch = (value) => go({ q: sanitizeQuery(value) });
  const clearSearch = () => { if (query) go({ q: '' }); };

  const pageIndex = pages.length - 1;
  const firstItem = pageIndex * PAGE_SIZE + 1;
  const lastItem = pageIndex * PAGE_SIZE + list.threads.length;
  // A Gmail folder's name is a label of the app and is translated here (the
  // sentences below insert the name verbatim); a label the user made is kept.
  const systemLabel = SYSTEM_LABELS.some((label) => label.id === labelId);
  const currentName = systemLabel ? tr(labelName(labelId, labels), 'mail') : labelName(labelId, labels);
  const labelIsSentLike = labelId === 'SENT' || labelId === 'DRAFT';

  let listBody;
  if (list.state === 'loading') listBody = <LoadingState label="Memuat email…" compact />;
  else if (list.state === 'error') {
    listBody = readBlocked
      ? <EmptyState compact icon="inbox" title="Kotak masuk belum tersedia" description="Menunggu izin baca Gmail dari admin." />
      : <EmptyState compact tone="error" title="Email gagal dimuat" description={list.error?.message}
          action={<Button variant="text" onClick={() => setRefreshKey((n) => n + 1)}>Coba lagi</Button>} />;
  } else if (!list.threads.length) {
    listBody = <EmptyState compact icon={query ? 'search_off' : 'inbox'} title={query ? 'Tidak ada hasil' : 'Tidak ada email'}
      description={query ? 'Coba kata kunci lain.' : `Belum ada percakapan di ${currentName}.`} />;
  } else {
    listBody = (
      <ul className="mail-rows" aria-label={`Email di ${currentName}`}>
        {list.threads.map((thread) => {
          const active = thread.id === threadId;
          const who = labelIsSentLike
            ? `Kepada: ${parseAddressHeader(thread.to).map(displayName).join(', ') || '—'}`
            : senderLabel(thread.from, myEmail);
          // "Kepada: …" is a sentence of the app (its names are inserted verbatim).
          const whoIsData = !labelIsSentLike && senderIsRecord(thread.from, myEmail);
          return (
            <li key={thread.id} className={`mail-row${thread.unread ? ' is-unread' : ''}${active ? ' is-active' : ''}`}>
              <Link to={hrefFor({ thread: thread.id })} className="mail-row__link pw-state-layer" aria-current={active ? 'true' : undefined}>
                <span className="mail-row__top">
                  <span className="mail-row__from">
                    <span data-no-translate={whoIsData ? '' : undefined}>{who}</span>
                    {thread.messageCount > 1 ? <span className="mail-row__count"> {thread.messageCount}</span> : null}
                  </span>
                  {thread.hasAttachment ? <Icon name="attach_file" size="sm" label="Ada lampiran" className="mail-row__clip" /> : null}
                  <span className="mail-row__date">{formatListDate(thread.date)}</span>
                </span>
                <span className="mail-row__subject" data-no-translate={thread.subject ? '' : undefined}>{thread.subject || '(tanpa subjek)'}</span>
                <span data-no-translate="" className="mail-row__snippet">{decodeEntities(thread.snippet)}</span>
              </Link>
              <IconButton
                size="sm"
                icon={<Icon name="star" filled={thread.starred} />}
                label={thread.starred ? 'Hapus bintang' : 'Beri bintang'}
                className={thread.starred ? 'mail-star is-on' : 'mail-star'}
                aria-pressed={thread.starred}
                onClick={() => runAction(thread.id, thread.starred ? 'unstar' : 'star', { silent: false })}
              />
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Page
      className={`mail-page${threadId ? ' has-thread' : ''}`}
      title="Gmail"
      description={myEmail ? `Email Google Workspace Anda (${myEmail}), langsung di Prakasa Workspace.` : 'Email Google Workspace Anda, langsung di Prakasa Workspace.'}
      actions={<Button icon="edit" onClick={compose}>Tulis email</Button>}
    >
      {readBlocked ? (
        <Banner tone="warning" title="Kotak masuk belum bisa dibaca">
          Admin perlu memberi izin baca Gmail di Google Admin Console. Anda tetap bisa menulis dan mengirim email.
        </Banner>
      ) : null}

      <FolderChips nav={nav} labelId={labelId} onSelect={(id) => go({ label: id, q: '' })} />

      <div className="mail-shell">
        <section className="mail-list" aria-label="Daftar email">
          <div className="mail-list__toolbar">
            <div className="mail-list__search">
              <SearchField
                label="Cari email"
                placeholder="Cari email"
                value={search}
                maxLength={MAX_QUERY}
                onChange={(event) => setSearch(event.target.value)}
                onSearch={submitSearch}
                onClear={clearSearch}
              />
              <IconButton icon="search" label="Cari" onClick={() => submitSearch(search)} />
            </div>
            <div className="mail-list__pager">
              <IconButton icon="refresh" label="Muat ulang" onClick={() => setRefreshKey((n) => n + 1)} />
              {list.threads.length ? (
                <span className="mail-list__range">{firstItem}–{lastItem}{list.estimate > lastItem ? ` dari ±${list.estimate}` : ''}</span>
              ) : null}
              <IconButton icon="chevron_left" label="Halaman sebelumnya" disabled={pageIndex === 0 || list.state === 'loading'}
                onClick={() => setPages((current) => current.slice(0, -1))} />
              <IconButton icon="chevron_right" label="Halaman berikutnya" disabled={!list.next || list.state === 'loading'}
                onClick={() => setPages((current) => [...current, list.next])} />
            </div>
          </div>
          <div className="mail-list__body">{listBody}</div>
        </section>

        <section className="mail-detail" aria-label="Isi email">
          <ThreadView
            threadId={threadId}
            labelId={labelId}
            myEmail={myEmail}
            onBack={closeThread}
            onAction={runAction}
            onReply={reply}
            readBlocked={readBlocked}
            onCompose={compose}
          />
        </section>
      </div>

      <ComposeModal
        open={composeOpen}
        draft={draft}
        onChange={setDraft}
        onClose={() => setComposeOpen(false)}
        onSent={onSent}
      />
    </Page>
  );
}
