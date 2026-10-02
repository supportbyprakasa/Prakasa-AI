import { useRef, useState } from 'react';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import DateInput from '../../components/DateInput';
import FormActions from '../../components/FormActions';
import Input from '../../components/Input';
import Menu from '../../components/Menu';
import Modal from '../../components/Modal';
import { formatDate } from '../../components/format';
import './admin-editors.css';

// The admin console filter bar content (docs/ui-guideline.md §4.6), for the
// DataGrid `filters` slot: one selected chip per active filter ("Status:
// Gagal") and the dashed "Tambah filter" chip. Picking a field from "Tambah
// filter" (or clicking an active chip) opens its value picker: a menu of
// options for `select` fields, a short dialog with one field for `text`,
// `number` and `date` fields.
//
//   <FilterChips fields={[{ key: 'status', label: 'Status', type: 'select', options }]}
//     values={filters} onChange={setFilters} />
//
// fields: { key, label, type: 'select' | 'text' | 'number' | 'date', options, hint, dataOptions }.
// Language switch: option labels are interface text and are translated (status,
// type, role and division names). `dataOptions: true` on a field says its
// options are records (users, entities …) and are never translated; one option
// can opt back in with `translate: true` ("Semua pengguna"), or be data alone
// with `data: true` — the same contract as Select and FilterMenuChip. A value
// typed into a text / number filter is user content and is never translated.
const isSet = (value) => value !== undefined && value !== null && value !== '';

const isDataOption = (field, option) => Boolean(option && (option.data ?? (field.dataOptions && !option.translate)));

// Whether the value shown on an active chip is record data / user-typed text.
function isDataValue(field, value) {
  if (field.type === 'select') {
    const option = field.options?.find((item) => String(item.value) === String(value));
    return option ? isDataOption(field, option) : Boolean(field.dataOptions);
  }
  return field.type !== 'date';
}

function valueLabel(field, value) {
  if (field.type === 'select') return field.options?.find((option) => String(option.value) === String(value))?.label ?? String(value);
  if (field.type === 'date') return formatDate(value);
  return String(value);
}

export default function FilterChips({ fields = [], values = {}, onChange, label = 'Filter' }) {
  const [menu, setMenu] = useState(null); // 'fields' | field key (select)
  const [dialog, setDialog] = useState(null); // { field, value }
  const addRef = useRef(null);
  const chipRefs = useRef(new Map());
  const [anchorKey, setAnchorKey] = useState(null);

  const active = fields.filter((field) => isSet(values[field.key]));
  const inactive = fields.filter((field) => !isSet(values[field.key]));
  const set = (key, value) => onChange({ ...values, [key]: value });

  const edit = (field, fromChip) => {
    setAnchorKey(fromChip ? field.key : null);
    if (field.type === 'select') setMenu(field.key);
    else setDialog({ field, value: values[field.key] ?? '' });
  };

  const menuField = menu && menu !== 'fields' ? fields.find((field) => field.key === menu) : null;
  const valueAnchor = {
    get current() { return (anchorKey && chipRefs.current.get(anchorKey)) || addRef.current; },
  };

  const applyDialog = (event) => {
    event.preventDefault();
    set(dialog.field.key, String(dialog.value ?? '').trim());
    setDialog(null);
  };

  return (
    <>
      {active.map((field) => (
        <span
          key={field.key}
          className="admin-filter-anchor"
          ref={(el) => { if (el) chipRefs.current.set(field.key, el); else chipRefs.current.delete(field.key); }}
        >
          <Chip selected aria-haspopup={field.type === 'select' ? 'menu' : 'dialog'} onClick={() => edit(field, true)}>
            {field.label}: <span data-no-translate={isDataValue(field, values[field.key]) ? '' : undefined}>{valueLabel(field, values[field.key])}</span>
          </Chip>
        </span>
      ))}
      {inactive.length ? (
        <span className="admin-filter-anchor" ref={addRef}>
          <Chip variant="add" aria-haspopup="menu" aria-expanded={menu === 'fields'} onClick={() => setMenu('fields')}>
            Tambah filter
          </Chip>
        </span>
      ) : null}
      {active.length ? (
        <Button variant="text" type="button" onClick={() => onChange(Object.fromEntries(fields.map((field) => [field.key, ''])))}>
          Hapus filter
        </Button>
      ) : null}

      <Menu
        open={menu === 'fields'}
        anchorRef={addRef}
        align="start"
        label={`${label}: pilih kolom`}
        onClose={() => setMenu((current) => (current === 'fields' ? null : current))}
        items={inactive.map((field) => ({ key: field.key, label: field.label, onClick: () => edit(field, false) }))}
      />
      <Menu
        open={Boolean(menuField)}
        anchorRef={valueAnchor}
        align="start"
        label={menuField?.label}
        onClose={() => setMenu((current) => (current === menuField?.key ? null : current))}
        items={menuField ? [
          ...(menuField.options || []).map((option) => ({
            key: String(option.value),
            label: option.label,
            data: isDataOption(menuField, option),
            checked: String(values[menuField.key] ?? '') === String(option.value),
            onClick: () => set(menuField.key, String(option.value)),
          })),
          ...(isSet(values[menuField.key]) ? [
            { divider: true, key: 'divider' },
            { key: 'clear', label: 'Hapus filter ini', icon: 'close', onClick: () => set(menuField.key, '') },
          ] : []),
        ] : []}
      />

      <Modal open={Boolean(dialog)} size="sm" title={dialog ? `Filter ${dialog.field.label.toLowerCase()}` : ''} onClose={() => setDialog(null)}>
        {dialog ? (
          <form className="pw-stack" onSubmit={applyDialog} noValidate>
            {dialog.field.type === 'date' ? (
              <DateInput
                label={dialog.field.label}
                value={dialog.value}
                hint={dialog.field.hint}
                onChange={(event) => setDialog((current) => ({ ...current, value: event.target.value }))}
                autoFocus
              />
            ) : (
              <Input
                label={dialog.field.label}
                type={dialog.field.type === 'number' ? 'number' : 'text'}
                min={dialog.field.type === 'number' ? 1 : undefined}
                inputMode={dialog.field.type === 'number' ? 'numeric' : undefined}
                value={dialog.value}
                hint={dialog.field.hint || 'Kosongkan untuk menghapus filter ini.'}
                onChange={(event) => setDialog((current) => ({ ...current, value: event.target.value }))}
                autoFocus
              />
            )}
            <FormActions>
              <Button variant="text" type="button" onClick={() => setDialog(null)}>Batal</Button>
              <Button type="submit">Terapkan</Button>
            </FormActions>
          </form>
        ) : null}
      </Modal>
    </>
  );
}
