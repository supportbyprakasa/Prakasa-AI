import { useEffect, useId, useState } from 'react';
import api from '../../../api/client';
import Input from '../../../components/Input';
import Chip from '../../../components/Chip';
import { LoadingState } from '../../../components/EmptyState';
import { Avatar } from './parts';

// Search colleagues (Prakasa users + Workspace directory) and pick one or more.
// selected: [{ email, name }]
export default function PeoplePicker({ label = 'Orang', selected, onChange, max = 20, exclude = [], autoFocus = false }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const full = selected.length >= max;

  useEffect(() => {
    if (full) { setResults([]); return undefined; }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      api.get('/google-chat/people', { params: { q: query.trim().slice(0, 100) } })
        .then((response) => { if (!cancelled) { setResults(response.data.data.people || []); setActive(0); } })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, full]);

  const taken = new Set([...selected.map((p) => p.email), ...exclude.map((e) => String(e).toLowerCase())]);
  const options = results.filter((p) => !taken.has(p.email)).slice(0, 8);

  const pick = (person) => {
    if (!person || full) return;
    onChange([...selected, person]);
    setQuery('');
  };

  const onKeyDown = (event) => {
    if (!options.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => (i + 1) % options.length); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => (i - 1 + options.length) % options.length); }
    if (event.key === 'Enter') { event.preventDefault(); pick(options[active]); }
  };

  return (
    <div className="pw-gchat__people">
      {selected.length ? (
        <div className="pw-gchat__people-selected" aria-label="Orang terpilih">
          {selected.map((person) => (
            <Chip key={person.email} data trailingIcon="close" aria-label={`Hapus ${person.name}`} onClick={() => onChange(selected.filter((p) => p.email !== person.email))}>
              {person.name}
            </Chip>
          ))}
        </div>
      ) : null}
      {!full ? (
        <>
          <Input
            label={label}
            placeholder="Cari nama atau email"
            value={query}
            autoFocus={autoFocus}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={options.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
          />
          <div className="pw-gchat__people-results" id={listId} role="listbox" aria-label="Hasil pencarian orang">
            {loading && !options.length ? <LoadingState compact label="Mencari…" /> : null}
            {!loading && !options.length ? <p className="pw-gchat__muted">{query ? 'Tidak ada yang cocok.' : 'Ketik nama untuk mencari.'}</p> : null}
            {options.map((person, index) => (
              <div
                key={person.email}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={`pw-gchat__option pw-state-layer pw-ripple${index === active ? ' is-active' : ''}`}
                onMouseDown={(event) => { event.preventDefault(); pick(person); }}
              >
                <Avatar person={{ displayName: person.name }} size="sm" />
                <span className="pw-gchat__option-text">
                  <span data-no-translate="">{person.name}</span>
                  <span data-no-translate="" className="pw-gchat__muted">{person.email}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
