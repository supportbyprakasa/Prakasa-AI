import ProgressBar from '../ProgressBar';
import './tasks.css';

// A task's progress: the shared ProgressBar (docs/ui-guideline.md §4.11) with
// the percentage printed beside it. The backend owns the actual value.
export default function TaskProgress({ percent, showLabel = true, label = 'Progres task' }) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return (
    <div className="task-progress">
      <ProgressBar value={p} label={`${label}: ${p}%`} className="task-progress__bar" />
      {showLabel ? <span className="task-progress__label">{p}%</span> : null}
    </div>
  );
}
