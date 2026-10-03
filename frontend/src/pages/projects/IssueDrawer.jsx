import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import ActionMenu from '../../components/ActionMenu';
import Button from '../../components/Button';
import DateInput from '../../components/DateInput';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import Select from '../../components/Select';
import SideSheet from '../../components/SideSheet';
import Textarea from '../../components/Textarea';
import StatusBadge from '../../components/StatusBadge';
import KeyValue from '../../components/KeyValue';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import { toast } from '../../components/Toast';
import { PRIORITY_LABELS } from '../../components/statusTone';
import { Avatar, IssueTypeIcon } from './TrackerBits';
import LabelsField from './LabelsField';
import {
  ISSUE_TYPES, PRIORITIES, activeSprintOf, activityParts, allLabels, apiErrorMessage, categoryStatus,
  assigneeChoices, dateOnly, formatDateTime, issueLink, parentOptions, plannedSprints, sortedColumns, unwrap,
} from './trackerModel';
import { NoTranslate } from '../../i18n/NoTranslate';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';

const EMPTY_COMMENT = { comment: '' };
// The comment box only: Prakasa AI may write the text and the user presses
// "Kirim komentar". The issue's own fields save as they change (no save
// button), so they are never registered (docs/prakasa-ai-rencana.md §9.9).
const AI_ISSUE_COMMENT = defineAIForm({
  id: 'tracker-issue-comment',
  title: 'Komentar issue',
  permission: 'google.chat.use',
  submitLabel: 'Kirim komentar',
  fields: [f.textarea('comment', 'Tulis komentar', { required: true, maxLength: 5000 })],
});

// One issue in the shared SideSheet (right, 400px; full screen on phones):
// inline-editable fields, sub-issues, comments and activity. It stays mounted
// while closing so the sheet can slide out with the last issue in it.
export default function IssueDrawer({
  open = true, issueId, project, issues, spaceId, reloadKey, issueSearch, me, onClose, onPatch, onDeleted, onCreateChild,
}) {
  const titleId = useId();
  const [state, setState] = useState({ loading: true, error: '', issue: null });
  const [pointsError, setPointsError] = useState('');
  const [titleError, setTitleError] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // The drawer stays mounted across issues, so a response for an issue that is
  // no longer open is dropped instead of replacing the one on screen.
  const openIdRef = useRef(issueId);
  openIdRef.current = issueId;

  const load = useCallback((silent = false) => {
    if (!silent) setState((s) => ({ ...s, loading: true, error: '' }));
    const requestedId = issueId;
    return api.get(`/tracker/issues/${requestedId}`)
      .then((r) => {
        if (openIdRef.current !== requestedId) return;
        const issue = unwrap(r).issue;
        setState({ loading: false, error: '', issue });
        setTitle((t) => (silent && document.activeElement?.dataset?.field === 'title' ? t : issue.title));
        setDescription((d) => (silent && document.activeElement?.dataset?.field === 'description' ? d : issue.description || ''));
      })
      .catch((e) => {
        if (silent || openIdRef.current !== requestedId) return;
        setState({ loading: false, error: e?.response?.status === 404 ? 'Issue tidak ditemukan atau sudah dihapus.' : apiErrorMessage(e, 'Issue gagal dimuat.'), issue: null });
      });
  }, [issueId]);

  // A new issue starts clean; closing (issueId → null) keeps the last one on
  // screen while the sheet slides out.
  useEffect(() => {
    if (!issueId) return;
    setComment('');
    setPointsError('');
    setTitleError('');
    setConfirmDelete(false);
    load(false);
  }, [issueId, load]);
  useEffect(() => { if (reloadKey && issueId) load(true); }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const ai = usePrakasaAIForm(AI_ISSUE_COMMENT, {
    enabled: open && Boolean(issueId) && Boolean(state.issue) && String(state.issue.id) === String(issueId),
    values: { comment },
    setters: { comment: setComment },
    initialValues: EMPTY_COMMENT,
  });

  const issue = state.issue;
  const columns = useMemo(() => sortedColumns(project.columns), [project.columns]);
  const sprintOptions = useMemo(() => {
    const active = activeSprintOf(project);
    const list = [...(active ? [active] : []), ...plannedSprints(project)];
    if (issue?.sprintId && !list.some((s) => s.id === issue.sprintId)) {
      const own = (project.sprints || []).find((s) => s.id === issue.sprintId);
      if (own) list.push(own);
    }
    return list.map((s) => ({ value: String(s.id), label: s.name, suffix: s.status === 'active' ? '(aktif)' : undefined }));
  }, [project, issue?.sprintId]);

  // Changes land on the issue they were made on: optimistic first, then the
  // server's version, or only the edited fields roll back on failure. If the
  // user has moved to another issue meanwhile, that one is left alone.
  const patchOnScreen = (id, change) => setState((s) => (
    s.issue && s.issue.id === id ? { ...s, issue: { ...s.issue, ...change } } : s
  ));
  const save = async (patch) => {
    if (!issue) return;
    const rollback = Object.fromEntries(Object.keys(patch).map((key) => [key, issue[key]]));
    patchOnScreen(issue.id, patch);
    const updated = await onPatch(issue, patch);
    patchOnScreen(issue.id, updated || rollback);
  };

  const saveTitle = () => {
    const next = title.trim();
    if (!next) { setTitle(issue.title); setTitleError('Judul tidak boleh kosong.'); return; }
    setTitleError('');
    if (next !== issue.title) save({ title: next.slice(0, 255) });
  };
  const saveDescription = () => {
    if ((issue.description || '') !== description) save({ description });
  };

  const postComment = async (event) => {
    event.preventDefault();
    const body = comment.trim();
    if (!body) return;
    setPosting(true);
    try {
      const data = unwrap(await api.post(`/tracker/issues/${issue.id}/comments`, { body }));
      setComment('');
      setState((s) => (s.issue && s.issue.id === issue.id
        ? { ...s, issue: { ...s.issue, comments: [...(s.issue.comments || []), data.comment] } }
        : s));
    } catch (error) {
      toast(apiErrorMessage(error, 'Komentar gagal dikirim.'), 'error');
    } finally {
      setPosting(false);
    }
  };

  const copyLink = async () => {
    const url = issueLink(window.location.origin, spaceId, issue.id);
    try {
      await navigator.clipboard.writeText(url);
      toast('Tautan issue disalin', 'success');
    } catch {
      toast('Tautan tidak bisa disalin di browser ini.', 'error');
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.delete(`/tracker/issues/${issue.id}`);
      toast(`${issue.key} dihapus`, 'success');
      setConfirmDelete(false);
      onDeleted?.(issue.id);
    } catch (error) {
      toast(apiErrorMessage(error, 'Issue gagal dihapus.'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const comments = issue?.comments || [];
  const activity = issue?.activity || [];
  const children = issue?.children || [];

  const heading = issue ? (
    <span className="tracker-sheet__heading">
      <IssueTypeIcon type={issue.type} />
      <span data-no-translate="">{issue.key}</span>
    </span>
  ) : 'Issue';

  return (
    <>
      <SideSheet open={open} onClose={onClose} title={heading} className="tracker-sheet">
        {state.loading ? <LoadingState label="Memuat issue…" /> : null}
        {!state.loading && state.error ? (
          <EmptyState tone="error" title="Issue tidak bisa dibuka" description={state.error} action={<Button variant="secondary" onClick={() => load(false)}>Coba lagi</Button>} />
        ) : null}
        {!state.loading && issue ? (
          <div className="tracker-sheet__body">
            <div className="tracker-sheet__tools">
              <StatusBadge status={categoryStatus(issue.status)} label={issue.statusName ? <NoTranslate>{issue.statusName}</NoTranslate> : undefined} />
              <span className="pw-grow" />
              <IconButton label="Salin tautan" icon="link" size="sm" onClick={copyLink} />
              <ActionMenu label="Aksi issue" size="sm" items={[{ label: 'Hapus issue', icon: 'delete', tone: 'danger', onClick: () => setConfirmDelete(true) }]} />
            </div>
            <Textarea
              label="Judul"
              data-field="title"
              className="tracker-sheet__title"
              rows={2}
              value={title}
              maxLength={255}
              error={titleError}
              onChange={(e) => { setTitle(e.target.value.replace(/\n/g, ' ')); if (titleError) setTitleError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
              onBlur={saveTitle}
            />
            <Select
              label="Status"
              value={String(issue.columnId || '')}
              onChange={(e) => {
                const column = columns.find((c) => String(c.id) === e.target.value);
                if (column) save({ columnId: column.id, status: column.category, statusName: column.name });
              }}
              options={columns.map((c) => ({ value: String(c.id), label: c.name }))}
              dataOptions
            />
            <div className="pw-form-grid">
              <Select
                label="Penanggung jawab"
                value={issue.assignee?.email || ''}
                placeholder="Belum ditugaskan"
                options={assigneeChoices(project, me, issue.assignee)}
                dataOptions
                onChange={(e) => {
                  const email = e.target.value || null;
                  const member = (project.members || []).find((m) => m.email === email) || (me?.email === email ? me : null);
                  save({ assigneeEmail: email, assignee: member ? { email: member.email, name: member.name, userId: member.userId } : null });
                }}
              />
              <Select label="Prioritas" value={issue.priority || 'normal'} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} onChange={(e) => save({ priority: e.target.value })} />
              <Select label="Tipe" value={issue.type || 'task'} options={ISSUE_TYPES} onChange={(e) => save({ type: e.target.value })} />
              <Select
                label="Sprint"
                value={issue.sprintId ? String(issue.sprintId) : ''}
                placeholder="Backlog"
                options={sprintOptions}
                dataOptions
                onChange={(e) => save({ sprintId: e.target.value ? Number(e.target.value) : null })}
              />
              <DateInput
                label="Tanggal mulai"
                value={dateOnly(issue.startDate)}
                max={dateOnly(issue.dueDate) || undefined}
                onChange={(e) => save({ startDate: e.target.value || null })}
              />
              <DateInput
                label="Jatuh tempo"
                value={dateOnly(issue.dueDate)}
                min={dateOnly(issue.startDate) || undefined}
                onChange={(e) => save({ dueDate: e.target.value || null })}
              />
              <Input
                label="Story points"
                type="number"
                min={0}
                max={100}
                step={0.5}
                inputMode="decimal"
                defaultValue={issue.storyPoints ?? ''}
                key={`sp-${issue.id}-${issue.storyPoints}`}
                error={pointsError}
                hint="0–100, kelipatan 0,5."
                onBlur={(e) => {
                  const raw = e.target.value;
                  const next = raw === '' ? null : Number(raw);
                  if (next !== null && (!Number.isFinite(next) || next < 0 || next > 100)) { setPointsError('Story points harus 0–100.'); return; }
                  setPointsError('');
                  if (next !== (issue.storyPoints === null || issue.storyPoints === undefined ? null : Number(issue.storyPoints))) save({ storyPoints: next });
                }}
              />
              <Select
                label="Induk"
                value={issue.parentId ? String(issue.parentId) : ''}
                placeholder="Tanpa induk"
                dataOptions
                options={parentOptions(issues, issue.id).concat(
                  issue.parentId && !issues.some((i) => i.id === issue.parentId) ? [{ value: String(issue.parentId), label: issue.parentKey || `#${issue.parentId}` }] : [],
                )}
                onChange={(e) => save({ parentId: e.target.value ? Number(e.target.value) : null })}
              />
            </div>

            <LabelsField value={issue.labels || []} onChange={(labels) => save({ labels })} suggestions={allLabels(issues)} />

            <Textarea
              label="Deskripsi"
              data-field="description"
              rows={5}
              maxLength={20000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={saveDescription}
              hint="Detail, langkah, atau kriteria selesai. Tersimpan otomatis saat Anda keluar dari kolom."
            />

            <section className="tracker-sheet__section" aria-labelledby={`${titleId}-children`}>
              <div className="tracker-sheet__section-head">
                <h3 id={`${titleId}-children`} className="pw-title-section">{`Sub-issue (${children.length})`}</h3>
                <Button variant="text" icon="add" onClick={() => onCreateChild(issue)}>Tambah sub-issue</Button>
              </div>
              {children.length ? (
                <ul className="tracker-sheet__list">
                  {children.map((child) => (
                    <li key={child.id} className="tracker-sheet__child">
                      <IssueTypeIcon type={child.type} />
                      <Link data-no-translate="" className="pw-link tracker-sheet__child-link" to={{ search: issueSearch(child.id) }}>{child.key} · {child.title}</Link>
                      <StatusBadge status={categoryStatus(child.status)} label={child.statusName ? <NoTranslate>{child.statusName}</NoTranslate> : undefined} />
                    </li>
                  ))}
                </ul>
              ) : <EmptyState compact icon="account_tree" description="Belum ada sub-issue." />}
            </section>

            <section className="tracker-sheet__section" aria-labelledby={`${titleId}-comments`}>
              <h3 id={`${titleId}-comments`} className="pw-title-section">{`Komentar (${comments.length})`}</h3>
              {comments.length ? (
                <ul className="tracker-sheet__list tracker-comments">
                  {comments.map((c) => (
                    <li key={c.id} className="tracker-comment">
                      <Avatar person={c.author} size="sm" />
                      <div className="pw-cell">
                        <span className="pw-cell__meta"><span className="tracker-comment__author" data-no-translate={c.author?.name ? '' : undefined}>{c.author?.name || 'Pengguna'}</span> · {formatDateTime(c.createdAt)}</span>
                        <p data-no-translate="" className="tracker-comment__body">{c.body}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
              {ai.notice}
              <form className="tracker-sheet__comment" onSubmit={postComment}>
                <Textarea label="Tulis komentar" rows={2} value={comment} maxLength={5000} {...ai.field('comment')} onChange={(e) => setComment(e.target.value)} />
                <div className="pw-row pw-row--end">
                  <Button type="submit" variant="secondary" loading={posting} disabled={!comment.trim()}>Kirim komentar</Button>
                </div>
              </form>
            </section>

            <section className="tracker-sheet__section" aria-labelledby={`${titleId}-activity`}>
              <h3 id={`${titleId}-activity`} className="pw-title-section">Aktivitas</h3>
              {activity.length ? (
                <ol className="tracker-sheet__list tracker-timeline">
                  {activity.map((a) => (
                    <li key={a.id} className="pw-cell">
                      <span className="pw-cell__title">{activityParts(a).flatMap((part, index) => [index ? ' ' : null, part.data ? <NoTranslate key={index}>{part.text}</NoTranslate> : part.text])}</span>
                      <span className="pw-cell__meta">{formatDateTime(a.createdAt)}</span>
                    </li>
                  ))}
                </ol>
              ) : <EmptyState compact icon="history" description="Belum ada aktivitas." />}
            </section>

            <KeyValue items={[
              { label: 'Pelapor', value: issue.reporter?.name },
              { label: 'Dibuat', value: formatDateTime(issue.createdAt) },
              { label: 'Diperbarui', value: formatDateTime(issue.updatedAt) },
              issue.completedAt ? { label: 'Selesai', translateContext: 'completed', value: formatDateTime(issue.completedAt) } : null,
            ]}
            />
          </div>
        ) : null}
      </SideSheet>
      <ConfirmDialog
        open={confirmDelete}
        title="Hapus issue?"
        message={issue ? `${issue.key} “${issue.title}” akan dihapus permanen beserta komentarnya.` : ''}
        confirmLabel="Hapus issue"
        tone="danger"
        loading={deleting}
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}
