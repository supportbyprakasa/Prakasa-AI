import { useId, useState } from 'react';
import Field from '../../components/Field';
import Chip from '../../components/Chip';
import Input from '../../components/Input';
import { addLabel } from './trackerModel';

// Labels as removable chips; Enter or comma adds the typed label (max 10 × 30 chars).
export default function LabelsField({ value, onChange, suggestions = [], error, aiFilled = false }) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const labels = value || [];
  const commit = () => {
    const next = addLabel(labels, draft);
    if (next !== labels) onChange(next);
    setDraft('');
  };
  const listId = `${id}-suggestions`;
  return (
    <Field label="Label" htmlFor={id} hint="Tekan Enter untuk menambah. Maks. 10 label." error={error} aiFilled={aiFilled}>
      {labels.length ? (
        <div className="pw-row tracker-labels">
          {labels.map((label) => (
            <Chip key={label} data icon="close" aria-label={`Hapus label ${label}`} onClick={() => onChange(labels.filter((l) => l !== label))}>{label}</Chip>
          ))}
        </div>
      ) : null}
      <Input
        id={id}
        value={draft}
        maxLength={30}
        list={listId}
        placeholder="mis. frontend"
        disabled={labels.length >= 10}
        onChange={(e) => {
          const text = e.target.value;
          if (text.endsWith(',')) { const next = addLabel(labels, text.slice(0, -1)); if (next !== labels) onChange(next); setDraft(''); } else setDraft(text);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Backspace' && !draft && labels.length) onChange(labels.slice(0, -1));
        }}
        onBlur={() => { if (draft.trim()) commit(); }}
      />
      <datalist id={listId}>
        {suggestions.filter((s) => !labels.includes(s)).map((s) => <option key={s} value={s} />)}
      </datalist>
    </Field>
  );
}
