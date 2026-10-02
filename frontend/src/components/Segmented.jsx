import { useRef } from 'react';
import Icon from './Icon';
import { ControlIcon } from './controlParts';
import { AiFilledTag } from './fieldParts';
import './segmented.css';

// Segmented button (docs/ui-guideline.md §4.7) for a choice of view (Papan /
// Daftar). options: [{ value, label, icon?, disabled? }]. Single choice by
// default (a radio group: arrow keys move and choose); `multiple` makes each
// segment a toggle and `value` an array. The selected segment shows a check
// unless the option has its own icon (Material 3). `label` names the group.
// An option with `data: true` shows a record's name (never translated).
// `aiFilled`: the choice was made by Prakasa AI and not reviewed yet (fieldParts.jsx).
export default function Segmented({ options = [], value, onChange, label, multiple = false, aiFilled = false, className = '' }) {
  const refs = useRef([]);
  const chosen = (v) => (multiple ? Array.isArray(value) && value.includes(v) : value === v);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const selectedIndex = options.findIndex((o) => chosen(o.value) && !o.disabled);
  const tabStop = selectedIndex >= 0 ? selectedIndex : enabled[0];

  const choose = (option) => {
    if (option.disabled || !onChange) return;
    if (!multiple) { if (value !== option.value) onChange(option.value); return; }
    const list = Array.isArray(value) ? value : [];
    onChange(list.includes(option.value) ? list.filter((v) => v !== option.value) : [...list, option.value]);
  };

  const onKeyDown = (event, index) => {
    if (multiple || !enabled.length) return;
    const at = enabled.indexOf(index);
    const next = {
      ArrowRight: enabled[(at + 1) % enabled.length],
      ArrowDown: enabled[(at + 1) % enabled.length],
      ArrowLeft: enabled[(at - 1 + enabled.length) % enabled.length],
      ArrowUp: enabled[(at - 1 + enabled.length) % enabled.length],
      Home: enabled[0],
      End: enabled[enabled.length - 1],
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    refs.current[next]?.focus();
    choose(options[next]);
  };

  const group = (
    <div className={['pw-segmented', aiFilled ? 'is-ai-filled' : '', className].filter(Boolean).join(' ')} role={multiple ? 'group' : 'radiogroup'} aria-label={label}>
      {options.map((option, index) => {
        const on = chosen(option.value);
        return (
          <button
            key={String(option.value)}
            ref={(el) => { refs.current[index] = el; }}
            type="button"
            role={multiple ? undefined : 'radio'}
            aria-checked={multiple ? undefined : on}
            aria-pressed={multiple ? on : undefined}
            tabIndex={multiple || index === tabStop ? 0 : -1}
            disabled={option.disabled}
            className={['pw-segmented__button', 'pw-state-layer', on ? 'is-selected' : ''].filter(Boolean).join(' ')}
            onClick={() => choose(option)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.icon ? <ControlIcon icon={option.icon} size="sm" legacySize={18} /> : on ? <Icon name="check" size="sm" /> : null}
            <span className="pw-segmented__label" data-no-translate={option.data ? '' : undefined}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
  return aiFilled ? <span className="pw-segmented-ai">{group}<AiFilledTag /></span> : group;
}
