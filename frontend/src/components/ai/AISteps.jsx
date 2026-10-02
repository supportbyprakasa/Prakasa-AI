import { useState } from 'react';
import Icon from '../Icon';
import Spinner from '../Spinner';
import { stepText, stepsSummary } from './aiStepsModel';

// What the AI did to reach its answer, like Claude's tool-use blocks: one
// collapsed line ("Membaca notifikasi Anda"), expandable into every step.
// While the answer is being written it shows the step running right now.
export default function AISteps({ steps, live = false }) {
  const [open, setOpen] = useState(false);
  if (!steps?.length) return null;
  const summary = stepsSummary(steps, { live });
  const running = live && steps.some((s) => s.status === 'running');
  return (
    <div className={`ai-steps${open ? ' is-open' : ''}`}>
      <button type="button" className="ai-steps__toggle pw-state-layer" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {running ? <Spinner label={null} /> : <Icon name="check" size="sm" />}
        <span className="ai-steps__summary">{summary}</span>
        <Icon name="expand_more" className="ai-steps__chevron" />
      </button>
      {open ? (
        <ol className="ai-steps__list">
          {steps.map((step) => (
            <li key={step.id} className={`ai-steps__item is-${step.status}`}>
              {step.status === 'running' ? <Icon name="progress_activity" size="sm" spin label="Berjalan" /> : null}
              {step.status === 'ok' ? <Icon name="check" size="sm" label="Selesai" /> : null}
              {step.status === 'error' ? <Icon name="close" size="sm" label="Gagal" /> : null}
              <span>{stepText(step)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
