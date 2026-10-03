import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import { streamBatchReview } from '../../api/batchReviewStream';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Chip from '../../components/Chip';
import Spinner from '../../components/Spinner';
import StatusBadge from '../../components/StatusBadge';
import AIMarkdown from '../../components/ai/AIMarkdown';
import AISteps from '../../components/ai/AISteps';
import { upsertStep } from '../../components/ai/aiStepsModel';
import { formatDateTime } from '../../components/format';
import { toast } from '../../components/Toast';
import { Mixed, NoTranslate, data } from '../../i18n/NoTranslate';
import { apiError, formatCount } from './salesModel';
import { findingStatus, normalizeReview, valueChange } from './accurateBatchReviewModel';

// "Periksa dengan AI" (Prakasa AI Wave D2): notes for the Supervisor or Head
// before they decide a batch. First the automatic findings (no model), then a
// short note written by Prakasa AI. It only reads: this component has no
// approve or reject control and never touches the ones in the page header.
// `onPick(number)` shows a document of a finding in the batch's own list.
function Finding({ finding, onPick }) {
  return (
    <li className="batch-review__finding">
      <div className="batch-review__finding-head">
        <StatusBadge status={findingStatus(finding.severity)} />
        <span className="batch-review__finding-title">{finding.title}</span>
        <span className="batch-review__finding-count">{formatCount(finding.count)}</span>
      </div>
      <p className="batch-review__why">{finding.why}</p>
      {finding.examples.length ? (
        <div className="batch-review__examples" aria-label="Contoh dokumen">
          {finding.examples.map((example) => {
            const change = valueChange(example);
            return (
              <span key={example.number} className="batch-review__example">
                <Chip data onClick={() => onPick?.(example.number)}>{example.number}</Chip>
                {example.customerNo ? <NoTranslate className="batch-review__detail">{example.customerNo}</NoTranslate> : null}
                {example.percent != null ? <NoTranslate className="batch-review__detail">{`${example.percent}%`}</NoTranslate> : null}
                {change ? <NoTranslate className="batch-review__detail">{change}</NoTranslate> : null}
              </span>
            );
          })}
          {finding.count > finding.examples.length ? <span className="pw-text-helper">{`+${formatCount(finding.count - finding.examples.length)} lainnya`}</span> : null}
        </div>
      ) : null}
    </li>
  );
}

// `pending`: the batch still waits for a decision. A decided batch only shows
// the review someone ran before deciding; it cannot be reviewed again here.
export default function AccurateBatchReview({ batchId, pending = true, onPick }) {
  const [review, setReview] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState('');
  const [steps, setSteps] = useState([]);
  const [writing, setWriting] = useState(false);
  const [notice, setNotice] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // The last review of this batch, with who ran it and when.
  useEffect(() => {
    let cancelled = false;
    api.get(`/accurate/batches/${batchId}/review`)
      .then((response) => { if (!cancelled) { const last = normalizeReview(response.data.data); setReview(last); setNote(last?.aiNote || ''); } })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [batchId]);

  const run = useCallback(async () => {
    setRunning(true); setWriting(false); setNote(''); setSteps([]); setNotice('');
    try {
      const outcome = await streamBatchReview(batchId, {
        onFindings: (payload) => { if (alive.current) { setReview(normalizeReview(payload)); setWriting(true); } },
        onStatus: (event) => { if (alive.current) setSteps((current) => upsertStep(current, event)); },
        onDelta: (text) => { if (alive.current) setNote((current) => current + text); },
      });
      if (!alive.current) return;
      // The saved note (a sentence that advises the decision is taken out on the server).
      setNote(outcome.aiNote || '');
      setNotice(outcome.aiNote ? '' : (outcome.aiNotice || ''));
    } catch (err) {
      if (alive.current) toast(apiError(err, 'Pemeriksaan batch gagal'), 'error');
    } finally {
      if (alive.current) { setRunning(false); setWriting(false); }
    }
  }, [batchId]);

  const contents = review?.contents || [];
  if (!pending && !review) return null;
  return (
    <Card
      as="section"
      className="batch-review"
      title="Pemeriksaan sebelum memutuskan"
      subtitle="Catatan untuk Anda. Keputusan menyetujui atau menolak tetap Anda ambil sendiri."
      actions={pending ? (
        <Button variant="secondary" icon="auto_awesome" onClick={run} loading={running} disabled={!loaded}>
          {review ? 'Periksa ulang dengan AI' : 'Periksa dengan AI'}
        </Button>
      ) : null}
    >
      {!review && !running ? (
        <p className="pw-text-helper batch-review__intro">
          Pemeriksaan otomatis membandingkan isi batch ini dengan data yang sudah disetujui: nilai yang berubah besar, dokumen yang hilang, nomor ganda,
          tanggal yang janggal, dan data master yang belum cocok. Lalu Prakasa AI menuliskan catatan singkat. Tidak ada data yang diubah.
        </p>
      ) : null}
      {running && !review ? <Spinner label="Memeriksa isi batch…" /> : null}
      {review ? (
        <div className="pw-stack">
          {review.requestedByName || review.createdAt ? (
            <p className="pw-text-helper batch-review__meta">
              <Mixed parts={['Pemeriksaan terakhir', data(review.requestedByName), review.createdAt ? formatDateTime(review.createdAt) : null]} />
            </p>
          ) : null}
          {contents.length ? (
            <p className="batch-review__contents">
              {contents.map((c, index) => (
                <span key={c.type}>{index ? ' · ' : ''}<span>{c.label}</span>{': '}
                  <span>{`${formatCount(c.create)} baru, ${formatCount(c.update)} berubah, ${formatCount(c.missing)} tidak ada lagi`}</span>
                </span>
              ))}
            </p>
          ) : null}
          <h3 className="pw-title-section batch-review__heading">Temuan pemeriksaan otomatis</h3>
          {review.findings.length ? (
            <ul className="batch-review__findings">
              {review.findings.map((finding) => <Finding key={finding.code} finding={finding} onPick={onPick} />)}
            </ul>
          ) : (
            <p className="batch-review__clear">Tidak ada yang janggal menurut pemeriksaan otomatis.</p>
          )}
          {review.notChecked.length ? (
            <p className="pw-text-helper">
              Belum bisa diperiksa:{' '}
              {review.notChecked.map((x, index) => (
                <span key={x.code}>{index ? ' ' : ''}<span>{x.title}</span>{' — '}<span>{x.reason}</span></span>
              ))}
            </p>
          ) : null}

          <div className="batch-review__ai" aria-live="polite">
            <h3 className="pw-title-section batch-review__heading">Catatan AI — bukan keputusan</h3>
            <AISteps steps={steps} live={writing} />
            {writing && !note ? <Spinner label="Prakasa AI menulis catatan…" /> : null}
            {note ? <AIMarkdown>{note}</AIMarkdown> : null}
            {notice ? <Banner tone="neutral">{notice}</Banner> : null}
            {!note && !notice && !writing ? (
              <p className="pw-text-helper">Belum ada catatan AI untuk pemeriksaan ini.</p>
            ) : null}
            <p className="pw-text-helper batch-review__disclaimer">
              Catatan ini ditulis Prakasa AI dari hasil pemeriksaan otomatis di atas. AI bisa keliru dan tidak pernah menyetujui atau menolak batch:
              periksa dokumennya, lalu putuskan sendiri dengan tombol di atas halaman.
            </p>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
