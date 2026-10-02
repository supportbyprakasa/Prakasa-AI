import { useEffect, useState } from 'react';
import Button from '../../components/Button';
import {
  apiErrorMessage, fieldErrorsFromApi, isEditableColumn, payloadFromValues, validateValues,
} from '../../components/datagrid/gridModel';
import FormActions from '../../components/FormActions';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Select from '../../components/Select';
import { toast } from '../../components/Toast';

// Create / edit dialog for a short admin record (≤ 5 fields, docs/ui-guideline.md
// §3.3) built from the same DataGrid column definitions the list uses, so the
// payload and the validation stay exactly what the grid sent before:
// validateValues / payloadFromValues from components/datagrid/gridModel.
// Errors show on the field (client rules and the API's fieldErrors).
function initialValues(columns, row) {
  return Object.fromEntries(columns.map((column) => {
    if (row) return [column.key, row[column.key] ?? ''];
    const fallback = typeof column.defaultValue === 'function' ? column.defaultValue() : (column.defaultValue ?? '');
    return [column.key, fallback];
  }));
}

export default function RecordDialog({
  open, title, columns, row, submitLabel, successMessage, onClose, onSubmit, onSaved,
}) {
  const editable = columns.filter(isEditableColumn);
  const [values, setValues] = useState(() => initialValues(editable, row));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues(initialValues(editable, row));
    setErrors({});
    // Reset only when the dialog opens for a (new) record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row]);

  const setValue = (key, value) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const close = () => { if (!saving) onClose(); };

  const submit = async (event) => {
    event.preventDefault();
    const nextErrors = validateValues(editable, values);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setSaving(true);
    try {
      await onSubmit(payloadFromValues(editable, values));
      toast(successMessage || (row ? 'Perubahan tersimpan' : 'Data berhasil ditambahkan'), 'success');
      onClose();
      await onSaved?.();
    } catch (error) {
      const fieldErrors = fieldErrorsFromApi(error);
      if (Object.keys(fieldErrors).length) setErrors(fieldErrors);
      else toast(apiErrorMessage(error, 'Data gagal disimpan.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} size="sm" title={title} onClose={close}>
      <form className="pw-stack" onSubmit={submit} noValidate>
        {editable.map((column, index) => {
          const common = {
            label: column.header,
            required: column.required,
            hint: column.hint,
            error: errors[column.key],
            value: values[column.key] ?? '',
            autoFocus: index === 0,
            onChange: (event) => setValue(column.key, event.target.value),
          };
          if (column.type === 'select') {
            return <Select key={column.key} {...common} placeholder={column.placeholder ?? 'Pilih'} options={column.options || []} dataOptions={column.translate === false} />;
          }
          return <Input key={column.key} {...common} type={column.type === 'number' ? 'number' : column.type === 'email' ? 'email' : 'text'} mono={column.mono} />;
        })}
        <FormActions>
          <Button variant="text" type="button" onClick={close} disabled={saving}>Batal</Button>
          <Button type="submit" loading={saving}>{submitLabel || (row ? 'Simpan perubahan' : 'Tambah')}</Button>
        </FormActions>
      </form>
    </Modal>
  );
}
