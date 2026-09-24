import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ShieldCheck, X } from 'lucide-react';
import api from '../../api/client';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import {
  groupPermissions,
  roleDiff,
  shouldCloseRoleEditorFromBackdrop,
} from './roleAdminModel';

export default function RoleEditorPanel({ role, open, onClose, onSaved }) {
  const closeButtonRef = useRef(null);
  const [detail, setDetail] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [originalCodes, setOriginalCodes] = useState([]);
  const [selectedCodes, setSelectedCodes] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open || !role?.id) return undefined;
    let active = true;
    setLoading(true);
    setError('');

    Promise.all([
      api.get(`/roles/${role.id}`),
      api.get('/permissions'),
    ]).then(([roleResponse, permissionResponse]) => {
      if (!active) return;
      const nextDetail = roleResponse.data.data;
      const nextPermissions = permissionResponse.data.data || [];
      const codes = (nextDetail.permissions || []).map((permission) => permission.code);
      setDetail(nextDetail);
      setPermissions(nextPermissions);
      setOriginalCodes(codes);
      setSelectedCodes(new Set(codes));
      window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    }).catch((requestError) => {
      if (!active) return;
      setError(requestError.response?.data?.error?.message || 'Role tidak dapat dimuat.');
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [open, role?.id]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !saving && !confirmOpen) onClose?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [confirmOpen, onClose, open, saving]);

  const groups = useMemo(() => groupPermissions(permissions), [permissions]);
  const selectedList = useMemo(() => [...selectedCodes], [selectedCodes]);
  const diff = useMemo(
    () => roleDiff(originalCodes, selectedList),
    [originalCodes, selectedList],
  );
  const permissionIdByCode = useMemo(
    () => new Map(permissions.map((permission) => [permission.code, permission.id])),
    [permissions],
  );

  if (!open) return null;

  const togglePermission = (code) => {
    setSelectedCodes((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const requestSave = () => {
    if (!diff.added.length && !diff.removed.length) {
      onClose?.();
      return;
    }
    setConfirmOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const permissionIds = selectedList
        .map((code) => permissionIdByCode.get(code))
        .filter(Boolean);
      await api.patch(`/roles/${role.id}`, { permissionIds });
      setConfirmOpen(false);
      onSaved?.();
      onClose?.();
    } catch (requestError) {
      setConfirmOpen(false);
      setError(requestError.response?.data?.error?.message || 'Perubahan role gagal disimpan.');
    } finally {
      setSaving(false);
    }
  };

  const diffMessage = (
    <div className="role-diff-summary">
      <p>Periksa perubahan untuk <strong>{detail?.name || role.name}</strong>.</p>
      <div>
        <strong>Ditambahkan ({diff.added.length})</strong>
        <span>{diff.added.length ? diff.added.join(', ') : 'Tidak ada'}</span>
      </div>
      <div>
        <strong>Dihapus ({diff.removed.length})</strong>
        <span>{diff.removed.length ? diff.removed.join(', ') : 'Tidak ada'}</span>
      </div>
    </div>
  );

  return (
    <div
      className="role-editor-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (shouldCloseRoleEditorFromBackdrop({
          confirmOpen,
          eventTargetIsBackdrop: event.target === event.currentTarget,
        })) onClose?.();
      }}
    >
      <aside
        className="role-editor-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${role.name}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="role-editor-panel__header">
          <div className="role-editor-panel__identity">
            <span className="role-editor-panel__icon"><ShieldCheck size={20} /></span>
            <div>
              <span>Edit akses role</span>
              <h2>{detail?.name || role.name}</h2>
              <p>{detail?.departmentName || role.departmentName || 'Global'} · {detail?.roleLevel || role.roleLevel}</p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            className="role-editor-panel__close"
            type="button"
            aria-label="Tutup editor role"
            onClick={onClose}
            disabled={saving}
          >
            <X size={20} />
          </button>
        </header>

        <div className="role-editor-panel__summary">
          <strong>{selectedCodes.size}</strong>
          <span>permission dipilih</span>
          {(diff.added.length > 0 || diff.removed.length > 0) ? (
            <small>+{diff.added.length} / −{diff.removed.length} belum disimpan</small>
          ) : <small>Tidak ada perubahan</small>}
        </div>

        <div className="role-editor-panel__body">
          {loading ? <div className="role-editor-state">Memuat permission…</div> : null}
          {error ? (
            <div className="role-editor-state role-editor-state--error" role="alert">{error}</div>
          ) : null}
          {!loading && !error ? groups.map((group) => (
            <details className="role-permission-group" key={group.key} open>
              <summary>
                <span>{group.label}</span>
                <span>{group.permissions.filter((permission) => selectedCodes.has(permission.code)).length}/{group.permissions.length}</span>
                <ChevronDown size={18} aria-hidden="true" />
              </summary>
              <div className="role-permission-group__items">
                {group.permissions.map((permission) => (
                  <label key={permission.id} className="role-permission-option">
                    <input
                      type="checkbox"
                      checked={selectedCodes.has(permission.code)}
                      onChange={() => togglePermission(permission.code)}
                    />
                    <span>
                      <strong>{permission.description || permission.code}</strong>
                      <code>{permission.code}</code>
                    </span>
                  </label>
                ))}
              </div>
            </details>
          )) : null}
        </div>

        <footer className="role-editor-panel__footer">
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="button" onClick={requestSave} disabled={loading || saving || Boolean(error)}>
            {saving ? 'Menyimpan…' : 'Simpan perubahan'}
          </Button>
        </footer>
      </aside>

      <ConfirmDialog
        open={confirmOpen}
        title="Simpan perubahan permission?"
        message={diffMessage}
        confirmLabel="Simpan perubahan"
        tone="primary"
        loading={saving}
        onClose={() => setConfirmOpen(false)}
        onConfirm={save}
      />
    </div>
  );
}
