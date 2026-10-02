import { dataZone } from '../../i18n/zones.js';
import {
  isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import {
  columnFilteringFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import api from '../../api/client';
import { usePublishPrakasaAIPart } from '../../context/PrakasaAIToolContext';
import { gridPart } from '../ai/aiPageContext';
import Banner from '../Banner';
import Button from '../Button';
import Checkbox from '../Checkbox';
import ConfirmDialog from '../ConfirmDialog';
import EmptyState from '../EmptyState';
import Icon from '../Icon';
import IconButton from '../IconButton';
import Input from '../Input';
import Menu from '../Menu';
import SearchField from '../SearchField';
import { SkeletonLine } from '../Skeleton';
import Select from '../Select';
import { toast } from '../Toast';
import { EMPTY, formatDate, formatDateTime, formatMoney, formatNumber } from '../format';
import GridImportDialog from './GridImportDialog';
import Pager from './Pager';
import { downloadMatrix } from './gridFile';
import {
  apiErrorMessage, columnAlign, columnNowrap, displayValue, exportMatrix, fieldErrorsFromApi, isEditableColumn,
  pageCount, pageSizeOptions, payloadFromValues, selectionState, skeletonWidth, sortKey,
  toggleAllSelection, toggleSelection, validateValues, PAGE_SIZES, cellTranslation } from './gridModel';
import './datagrid.css';

// DataGrid — the one list surface (docs/ui-guideline.md §4.9, admin console
// table generation A). The grid IS the panel: toolbar (or the contextual
// toolbar while rows are selected), optional filter bar, header, rows, pager.
//
// Props added for the admin console look (all optional, old props unchanged):
//   title              panel title in the toolbar (Roboto 15/16 500); it also
//                      names the export file and the region. showTitle={false}
//                      keeps it for the name only.
//   filters           node for the 56px filter bar (chips, selects)
//   error / onRetry    load failure → EmptyState tone="error" with "Coba lagi";
//                      when rows are already shown they stay, under an error
//                      Banner with the same "Coba lagi"
//   search / onSearchChange / searchPlaceholder / searchDelay
//                      controlled, debounced server-side search
//   selectable, selected, onSelectionChange(ids, rows), bulkActions(rows, clear)
//                      checkbox column + contextual toolbar
//   onPageSizeChange   rows-per-page dropdown for server-paged lists; without
//                      it a server-paged grid has a fixed page size and shows
//                      no dropdown (the pages' loaders take no limit)
//   flush              no panel border (inside a Card that already frames it)
//   onExport(format)   the export menu calls this instead of exporting the rows
//                      on screen (a server-paged list exporting every match)
//   columns[].type     'date' | 'datetime' | 'money' formatted; 'number' | 'money' right-aligned
//   columns[].nowrap   keep the cell on one line (default for dates, amounts, numbers)

const CLIENT_FEATURES = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
// Server-paged tables (callers passing meta/onPageChange) page on the API.
const MANUAL_FEATURES = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
});

const EMPTY_ROWS = [];
const NEW_ROW = '__new__';
const RESOURCE_PAGE_LIMIT = 100;
const RESOURCE_MAX_ROWS = 5000;
const SKELETON_ROWS = 5;
// A click on one of these inside a row belongs to that control, not to the row.
const INTERACTIVE = 'a, button, input, select, textarea, label, [role="button"], [role="menuitem"], [role="checkbox"]';

const resolve = (flag, row) => (typeof flag === 'function' ? flag(row) : Boolean(flag));
const EMPTY_MARK = <span className="pw-grid__muted">—</span>;
const isBlank = (value) => value === '' || value == null || value === false;

function formatCell(column, row) {
  if (column.render) {
    const content = column.render(row);
    return isBlank(content) && !column.display ? EMPTY_MARK : content;
  }
  const value = displayValue(column, row);
  if (value === '' || value == null) return EMPTY_MARK;
  // Shared formatters (components/format.js); an unreadable value shows as is.
  const format = { date: formatDate, datetime: formatDateTime, money: formatMoney }[column.type];
  if (format) {
    const text = format(value);
    return text === EMPTY ? String(value) : text;
  }
  return String(value);
}

function cellClass(column, first) {
  const align = columnAlign(column);
  return [
    align ? `is-${align}` : '', columnNowrap(column) ? 'is-nowrap' : '', first ? 'pw-grid__primary' : '',
  ].filter(Boolean).join(' ') || undefined;
}

// A table wider than its panel even with wrapped text scrolls sideways with
// every cell on one line (48px rows), as the admin console does, instead of
// squeezing columns into tall rows. Measured on the wrapped layout after
// every render and on every resize; the class is set on the DOM directly so
// measuring never re-renders.
function useSingleLineWhenScrolling(scrollRef) {
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return undefined;
    const fit = () => {
      const table = box.querySelector('table');
      if (!table) return;
      box.classList.remove('is-overflowing');
      box.classList.toggle('is-overflowing', table.scrollWidth > box.clientWidth + 1);
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  });
}

function useResourceRows(resource, params, reloadKey) {
  const [state, setState] = useState({ rows: EMPTY_ROWS, loading: Boolean(resource), error: '', truncated: false, key: '' });
  const paramsKey = JSON.stringify(params || {});
  const queryKey = `${resource}|${paramsKey}`;

  useEffect(() => {
    if (!resource) return undefined;
    let active = true;
    setState((current) => ({ ...current, loading: true, error: '' }));
    (async () => {
      const collected = [];
      let page = 1;
      let total = Infinity;
      while (collected.length < total && collected.length < RESOURCE_MAX_ROWS) {
        const response = await api.get(resource, {
          params: { ...JSON.parse(paramsKey), page, limit: RESOURCE_PAGE_LIMIT },
        });
        const data = response.data.data || [];
        collected.push(...data);
        total = response.data.meta?.total ?? collected.length;
        if (data.length < RESOURCE_PAGE_LIMIT) break;
        page += 1;
      }
      return { rows: collected, truncated: collected.length < total };
    })()
      .then(({ rows, truncated }) => {
        if (active) setState({ rows, loading: false, error: '', truncated, key: queryKey });
      })
      .catch((error) => {
        if (!active) return;
        const message = apiErrorMessage(error, 'Periksa koneksi, lalu coba lagi.');
        // A failed reload of the same query keeps the rows already shown.
        setState((current) => (current.key === queryKey
          ? { ...current, loading: false, error: message }
          : { rows: EMPTY_ROWS, loading: false, error: message, truncated: false, key: '' }));
      });
    return () => { active = false; };
  }, [resource, paramsKey, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}

function IconAction({ label, onClick, disabled, tone, icon }) {
  return (
    <IconButton label={label} onClick={onClick} disabled={disabled} tone={tone || 'default'} size="sm" className="pw-grid__icon">
      <Icon name={icon} />
    </IconButton>
  );
}

// Inline editors are the shared dense fields (36px, label for screen readers
// only) and the shared Checkbox; the field shows its own error.
function CellEditor({ column, value, error, onChange, autoFocus, onKeyDown }) {
  if (column.type === 'boolean') {
    return (
      <div className="pw-grid__editor is-boolean">
        <Checkbox
          aria-label={column.header}
          aria-invalid={error ? 'true' : undefined}
          autoFocus={autoFocus}
          onKeyDown={onKeyDown}
          checked={value === true || value === 'true' || value === 1}
          onChange={(event) => onChange(event.target.checked)}
        />
        {error ? <small className="pw-grid__error" role="alert">{error}</small> : null}
      </div>
    );
  }
  const common = { label: column.header, error: error || undefined, autoFocus, onKeyDown, dense: true };
  if (column.type === 'select') {
    return (
      <div className="pw-grid__editor">
        <Select {...common} value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
          {!column.required || value === '' || value == null ? <option value="" data-translate="">— Pilih —</option> : null}
          {(column.options || []).map((option) => (
            <option key={String(option.value)} value={option.value}>{option.label}</option>
          ))}
        </Select>
      </div>
    );
  }
  const inputType = { email: 'email', number: 'number', money: 'number', date: 'date' }[column.type] || 'text';
  const normalized = column.type === 'date' && value ? String(value).slice(0, 10) : (value ?? '');
  return (
    <div className="pw-grid__editor">
      <Input
        {...common}
        type={inputType}
        value={normalized}
        placeholder={column.placeholder || column.header}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

// Export sits in the toolbar as an icon button with the shared Menu
// (portal, arrow keys, Escape and outside click close it).
function ExportMenu({ disabled, onExport }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const menuId = useId();
  return (
    <>
      <IconButton
        ref={anchorRef}
        label="Ekspor"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="download" />
      </IconButton>
      <Menu
        open={open}
        anchorRef={anchorRef}
        id={menuId}
        label="Ekspor"
        align="end"
        onClose={() => setOpen(false)}
        items={[
          { label: 'Excel (.xlsx)', icon: 'table_chart', onClick: () => onExport('xlsx') },
          { label: 'CSV (.csv)', icon: 'description', onClick: () => onExport('csv') },
        ]}
      />
    </>
  );
}

export default function DataGrid({
  columns,
  rows: staticRows,
  loading: staticLoading = false,
  error: staticError = '',
  onRetry,
  resource,
  params,
  idKey = 'id',
  title,
  // The title is a record's own name (i18n/zones.js): never translated.
  dataTitle = false,
  showTitle = true,
  exportName,
  canCreate = false,
  canUpdate = false,
  canDelete = false,
  lockedReason,
  onCreate,
  onUpdate,
  onDelete,
  onEditRow,
  onCreateClick,
  onChanged,
  importable = false,
  onImport,
  createLabel = 'Tambah data',
  deleteMessage,
  rowActions,
  toolbarActions,
  filters,
  onRowClick,
  empty = 'Belum ada data',
  pageSize = 20,
  meta,
  onPageChange,
  onPageSizeChange,
  searchable = true,
  search,
  onSearchChange,
  searchPlaceholder,
  searchDelay = 300,
  exportable = true,
  onExport,
  selectable = false,
  selected: selectedProp,
  onSelectionChange,
  bulkActions,
  flush = false,
  reloadKey: externalReloadKey = 0,
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const resourceState = useResourceRows(resource, params, reloadKey + externalReloadKey);
  const rows = resource ? resourceState.rows : (staticRows || EMPTY_ROWS);
  const loading = resource ? resourceState.loading : staticLoading;
  const loadError = resource ? resourceState.error : staticError;

  const manual = Boolean(meta && onPageChange);
  const serverSearch = typeof onSearchChange === 'function';
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [searchText, setSearchText] = useState(search ?? '');
  const searchTimer = useRef(null);
  const scrollRef = useRef(null);
  useSingleLineWhenScrolling(scrollRef);
  const [innerSelected, setInnerSelected] = useState([]);

  const editableColumns = useMemo(() => columns.filter(isEditableColumn), [columns]);
  const externalEdit = Boolean(onEditRow);
  const hasRowActions = Boolean(canUpdate || canDelete || rowActions);
  const baseName = exportName || (title || 'data').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const rowId = useCallback((row, index) => String(row[idKey] ?? index), [idKey]);

  // Server-side search follows the page's value; the input stays responsive
  // and the page hears about it once typing pauses.
  useEffect(() => { if (serverSearch) setSearchText(search ?? ''); }, [search, serverSearch]);
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  const reload = useCallback(async () => {
    if (resource) setReloadKey((key) => key + 1);
    await onChanged?.();
  }, [onChanged, resource]);

  const tableColumns = useMemo(() => columns.map((column) => ({
    id: column.key,
    accessorFn: (row) => sortKey(column, row),
    header: column.header,
    enableSorting: column.sortable !== false && !column.display,
    enableGlobalFilter: column.searchable !== false && !column.display,
    sortFn: 'alphanumeric',
    sortUndefined: 'last',
  })), [columns]);

  const globalFilter = serverSearch ? '' : searchText;
  const table = useTable({
    features: manual ? MANUAL_FEATURES : CLIENT_FEATURES,
    columns: tableColumns,
    data: rows,
    getRowId: (row, index) => rowId(row, index),
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize } },
    state: { globalFilter },
    onGlobalFilterChange: (updater) => setSearchText((current) => (
      typeof updater === 'function' ? updater(current) : updater
    )),
  });

  // ------------------------------------------------------------ selection
  const controlledSelection = Array.isArray(selectedProp);
  const selected = useMemo(
    () => (controlledSelection ? selectedProp.map(String) : innerSelected),
    [controlledSelection, selectedProp, innerSelected],
  );
  const rowsById = useMemo(() => new Map(rows.map((row, index) => [rowId(row, index), row])), [rows, rowId]);
  // Rows that left the data (deleted, filtered on the server) leave the selection.
  useEffect(() => {
    if (controlledSelection) return;
    setInnerSelected((current) => (current.every((id) => rowsById.has(id)) ? current : current.filter((id) => rowsById.has(id))));
  }, [rowsById, controlledSelection]);
  const setSelected = (next) => {
    if (!controlledSelection) setInnerSelected(next);
    onSelectionChange?.(next, next.map((id) => rowsById.get(id)).filter(Boolean));
  };
  const selectedRows = selectable ? selected.map((id) => rowsById.get(id)).filter(Boolean) : [];
  const clearSelection = () => setSelected([]);

  // ------------------------------------------------------------ search
  const changeSearch = (value) => {
    setSearchText(value);
    if (serverSearch) {
      clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => onSearchChange(value), searchDelay);
    } else if (!manual) {
      table.setPageIndex?.(0);
    }
  };
  const clearSearch = () => {
    setSearchText('');
    if (serverSearch) { clearTimeout(searchTimer.current); onSearchChange(''); }
    else if (!manual) table.setPageIndex?.(0);
  };

  // ------------------------------------------------------------ editing
  const startEdit = (row) => {
    if (externalEdit) { onEditRow(row); return; }
    setEditing({
      rowId: String(row[idKey]),
      row,
      values: Object.fromEntries(editableColumns.map((column) => [column.key, row[column.key] ?? ''])),
      errors: {},
    });
  };

  const startCreate = () => {
    if (onCreateClick) { onCreateClick(); return; }
    table.setPageIndex?.(0);
    setEditing({
      rowId: NEW_ROW,
      row: null,
      values: Object.fromEntries(editableColumns.map((column) => [
        column.key,
        typeof column.defaultValue === 'function' ? column.defaultValue() : (column.defaultValue ?? ''),
      ])),
      errors: {},
    });
  };

  const cancelEdit = () => { if (!saving) setEditing(null); };

  const setValue = (key, value) => setEditing((current) => ({
    ...current,
    values: { ...current.values, [key]: value },
    errors: { ...current.errors, [key]: undefined },
  }));

  const save = async () => {
    const errors = validateValues(editableColumns, editing.values);
    if (Object.keys(errors).length) {
      setEditing((current) => ({ ...current, errors }));
      return;
    }
    const payload = payloadFromValues(editableColumns, editing.values);
    setSaving(true);
    try {
      if (editing.rowId === NEW_ROW) {
        if (onCreate) await onCreate(payload);
        else await api.post(resource, payload);
        toast('Data berhasil ditambahkan', 'success');
      } else {
        if (onUpdate) await onUpdate(editing.row, payload);
        else await api.patch(`${resource}/${editing.row[idKey]}`, payload);
        toast('Perubahan tersimpan', 'success');
      }
      setEditing(null);
      await reload();
    } catch (error) {
      const fieldErrors = fieldErrorsFromApi(error);
      if (Object.keys(fieldErrors).length) {
        setEditing((current) => ({ ...current, errors: { ...current.errors, ...fieldErrors } }));
      } else {
        toast(apiErrorMessage(error, 'Data gagal disimpan.'), 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      if (onDelete) await onDelete(deleteTarget);
      else await api.delete(`${resource}/${deleteTarget[idKey]}`);
      toast('Data dihapus', 'success');
      setDeleteTarget(null);
      await reload();
    } catch (error) {
      toast(apiErrorMessage(error, 'Data gagal dihapus.'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const runExport = async (format) => {
    // A server-paged list can export every matching row from its own API.
    if (onExport) {
      try { await onExport(format); } catch (error) { toast(apiErrorMessage(error, 'Ekspor gagal.'), 'error'); }
      return;
    }
    const visibleRows = (manual ? table.getRowModel() : table.getSortedRowModel()).rows.map((row) => row.original);
    try {
      await downloadMatrix(exportMatrix(columns, visibleRows), baseName, format);
    } catch (error) {
      toast(apiErrorMessage(error, 'Ekspor gagal.'), 'error');
    }
  };

  const importRows = async (importPayload) => {
    if (onImport) return onImport(importPayload);
    const response = await api.post(`${resource}/import`, { rows: importPayload });
    return response.data.data;
  };

  const editorKeyDown = (event) => {
    if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA') { event.preventDefault(); save(); }
    if (event.key === 'Escape') { event.preventDefault(); cancelEdit(); }
  };

  // Only a click that happened inside the row's own DOM opens it: a choice in
  // a portaled Menu (a row ⋮ item) bubbles here through React, but its target
  // is outside the <tr>.
  const openRow = (event, row) => {
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    const hit = event.target instanceof Element ? event.target.closest(INTERACTIVE) : null;
    if (hit && event.currentTarget.contains(hit)) return;
    onRowClick(row);
  };
  // The actions cell (buttons, the padding between them, their menus) never
  // opens the row.
  const stopRowClick = (event) => event.stopPropagation();
  const rowKeyDown = (event, row) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onRowClick(row); }
  };

  const retry = onRetry || (resource ? () => setReloadKey((key) => key + 1) : null);
  const retryButton = retry ? <Button variant="text" type="button" onClick={retry}>Coba lagi</Button> : null;
  const errorText = loadError === true ? undefined : loadError;
  // Only an empty grid gives its whole body to the error; rows already on
  // screen stay, under an error Banner.
  const fatalError = Boolean(loadError) && !rows.length;

  const renderEditorRow = (row, isNew) => (
    <tr className={`pw-grid__row is-editing${isNew ? ' is-new' : ''}`} key={isNew ? NEW_ROW : editing.rowId}>
      {selectable ? <td className="pw-grid__select" /> : null}
      {columns.map((column, index) => (
        <td key={column.key} data-label={column.header} className={cellClass(column, index === 0)}>
          {isEditableColumn(column) ? (
            <CellEditor
              column={column}
              value={editing.values[column.key]}
              error={editing.errors[column.key]}
              onChange={(value) => setValue(column.key, value)}
              onKeyDown={editorKeyDown}
              autoFocus={index === columns.findIndex(isEditableColumn)}
            />
          ) : (row ? formatCell(column, row) : <span className="pw-grid__muted">Otomatis</span>)}
        </td>
      ))}
      <td className="pw-grid__actions">
        <div className="pw-grid__actions-inner">
          <IconAction label={saving ? 'Menyimpan…' : 'Simpan (Enter)'} onClick={save} disabled={saving} tone="primary" icon="check" />
          <IconAction label="Batal (Esc)" onClick={cancelEdit} disabled={saving} icon="close" />
        </div>
      </td>
    </tr>
  );

  const pageRows = table.getRowModel().rows;
  const filteredCount = manual ? rows.length : table.getFilteredRowModel().rows.length;
  const totalCount = manual ? (meta.total ?? rows.length) : filteredCount;
  const pagination = table.state.pagination;
  // Prakasa AI (standard page context): what this list shows — search text,
  // sort and row counts. Never a row's content.
  const gridSlot = `grid:${useId()}`;
  const activeSort = table.state.sorting?.[0] || null;
  usePublishPrakasaAIPart(gridSlot, loading ? null : gridPart({
    title: dataTitle ? null : title,
    search: searchText,
    sort: activeSort,
    shown: pageRows.length,
    total: Number.isFinite(Number(totalCount)) ? Number(totalCount) : null,
  }));
  const creating = editing?.rowId === NEW_ROW;
  const showCreate = resolve(canCreate) && (resource || onCreate || onCreateClick);
  const showImport = importable && resolve(canCreate);
  const showTitleText = Boolean(title && showTitle);
  const contextual = selectable && selectedRows.length > 0;
  const hasToolbar = contextual || showTitleText || searchable || exportable || toolbarActions || showImport || showCreate;
  const pageIds = pageRows.map((tableRow) => tableRow.id);
  const headerSelection = selectionState(selected, pageIds);
  const headers = table.getHeaderGroups()[0]?.headers || [];
  const headerFor = (key) => headers.find((header) => header.column.id === key);
  // One rule for the pager: a server-paged grid always has it (it stays while
  // the next page loads, so nothing jumps); a client grid has it once it holds
  // more rows than the smallest page size, never for 10 rows or fewer (a grid
  // in a card, sheet or dialog).
  const showPager = !fatalError && (manual || (!loading && filteredCount > PAGE_SIZES[0]));

  const renderHead = (interactive) => (
    <thead>
      <tr>
        {selectable ? (
          <th scope="col" className="pw-grid__select">
            {interactive && pageIds.length ? (
              <Checkbox
                checked={headerSelection === 'all'}
                indeterminate={headerSelection === 'some'}
                aria-label="Pilih semua baris di halaman ini"
                onChange={() => setSelected(toggleAllSelection(selected, pageIds))}
              />
            ) : null}
          </th>
        ) : null}
        {columns.map((column) => {
          const header = interactive ? headerFor(column.key) : null;
          const sorted = header?.column.getIsSorted() || false;
          const canSort = Boolean(header?.column.getCanSort());
          const align = columnAlign(column);
          const required = column.required && isEditableColumn(column) && editing
            ? <span className="pw-grid__required" aria-hidden="true">*</span> : null;
          return (
            <th
              key={column.key}
              scope="col"
              style={column.width ? { width: column.width } : undefined}
              data-i18n-context={column.translateContext}
              className={[align ? `is-${align}` : '', canSort ? 'is-sortable' : '', sorted ? 'is-sorted' : ''].filter(Boolean).join(' ') || undefined}
              aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : undefined}
            >
              {canSort ? (
                <button type="button" className="pw-grid__sort" onClick={header.column.getToggleSortingHandler()}>
                  <span>{column.header}</span>
                  {required}
                  <Icon name={sorted === 'desc' ? 'arrow_downward' : 'arrow_upward'} size="sm" className="pw-grid__sort-icon" />
                </button>
              ) : <>{column.header}{required}</>}
            </th>
          );
        })}
        {hasRowActions ? <th scope="col" className="pw-grid__actions"><span className="sr-only">Tindakan</span></th> : null}
      </tr>
    </thead>
  );

  let body;
  if (loading) {
    body = (
      <div className="pw-grid__scroll">
        <table className="pw-grid__table is-loading">
          {renderHead(false)}
          <tbody>
            {Array.from({ length: SKELETON_ROWS }, (_, rowIndex) => (
              <tr key={rowIndex} className="pw-grid__row is-skeleton">
                {selectable ? <td className="pw-grid__select"><span className="pw-grid__skel pw-grid__skel--box" /></td> : null}
                {columns.map((column, columnIndex) => (
                  <td key={column.key} data-label={column.header} className={cellClass(column, columnIndex === 0)}>
                    <span className="pw-grid__skel" style={{ width: skeletonWidth(rowIndex, columnIndex) }} />
                  </td>
                ))}
                {hasRowActions ? <td className="pw-grid__actions" /> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else if (fatalError) {
    body = (
      <div className="pw-grid__state">
        <EmptyState tone="error" compact title="Data gagal dimuat" description={errorText} action={retryButton} />
      </div>
    );
  } else {
    const noRows = !pageRows.length && !creating;
    body = (
      <>
        <div className="pw-grid__scroll" ref={scrollRef}>
          <table className="pw-grid__table">
            {renderHead(true)}
            <tbody>
              {creating ? renderEditorRow(null, true) : null}
              {pageRows.map((tableRow) => {
                const row = tableRow.original;
                if (editing && editing.rowId === String(row[idKey])) return renderEditorRow(row, false);
                const updatable = resolve(canUpdate, row);
                const deletable = resolve(canDelete, row);
                const lock = !updatable && canUpdate ? lockedReason?.(row) : null;
                const clickable = Boolean(onRowClick) && !editing;
                const isSelected = selectable && selected.includes(tableRow.id);
                return (
                  <tr
                    key={tableRow.id}
                    className={['pw-grid__row', onRowClick ? 'is-clickable' : '', isSelected ? 'is-selected' : ''].filter(Boolean).join(' ')}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? (event) => openRow(event, row) : undefined}
                    onKeyDown={clickable ? (event) => rowKeyDown(event, row) : undefined}
                  >
                    {selectable ? (
                      <td className="pw-grid__select">
                        <Checkbox
                          checked={isSelected}
                          aria-label={`Pilih baris ${String(displayValue(columns[0], row) ?? '').slice(0, 60)}`.trim()}
                          onChange={() => setSelected(toggleSelection(selected, tableRow.id))}
                        />
                      </td>
                    ) : null}
                    {columns.map((column, index) => (
                      <td key={column.key} data-label={column.header} className={cellClass(column, index === 0)} {...cellTranslation(column)}>
                        {formatCell(column, row)}
                      </td>
                    ))}
                    {hasRowActions ? (
                      <td className="pw-grid__actions" onClick={stopRowClick}>
                        <div className="pw-grid__actions-inner">
                          {rowActions?.(row)}
                          {canUpdate ? (
                            lock ? (
                              <IconAction label={lock} disabled icon="lock" />
                            ) : (
                              <IconAction label="Ubah" onClick={() => startEdit(row)} disabled={!updatable || Boolean(editing)} icon="edit" />
                            )
                          ) : null}
                          {canDelete ? (
                            <IconAction label="Hapus" tone="danger" onClick={() => setDeleteTarget(row)} disabled={!deletable || Boolean(editing)} icon="delete" />
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {noRows ? (
          <div className="pw-grid__state">
            {isValidElement(empty) ? empty : (
              <EmptyState
                compact
                title={searchText && !serverSearch ? `Tidak ada data yang cocok dengan “${searchText}”.` : empty}
              />
            )}
          </div>
        ) : null}
      </>
    );
  }

  const countText = loading ? 'Memuat data' : `${formatNumber(totalCount)} data`;
  const showCount = !loading && !fatalError;
  // While loading, the count is a skeleton line (§4.15), not a "Memuat" text;
  // the status line below still tells screen readers.
  const showCountSkeleton = loading && !fatalError;

  return (
    <section
      className={['pw-grid', flush ? 'pw-grid--flush' : ''].filter(Boolean).join(' ')}
      aria-label={title || undefined}
      data-no-translate={dataTitle && title ? 'attr' : undefined}
      aria-busy={loading || saving || undefined}
    >
      {hasToolbar ? (
        <div className={`pw-grid__toolbar${contextual ? ' is-contextual' : ''}`}>
          {contextual ? (
            <>
              <span className="pw-grid__selection">{selectedRows.length} dipilih</span>
              <div className="pw-grid__bulk">{bulkActions?.(selectedRows, clearSelection)}</div>
              <div className="pw-grid__toolbar-end">
                <IconButton label="Batalkan pilihan" onClick={clearSelection}>
                  <Icon name="close" />
                </IconButton>
              </div>
            </>
          ) : (
            <>
              {showTitleText || showCount || showCountSkeleton ? (
                <div className="pw-grid__heading">
                  {showTitleText ? <h2 className="pw-grid__title" {...dataZone(dataTitle)}>{title}</h2> : null}
                  {showCount ? <span className="pw-grid__count" aria-hidden="true">{countText}</span> : null}
                  {showCountSkeleton ? <span className="pw-grid__count" aria-hidden="true"><SkeletonLine width={56} height={12} /></span> : null}
                </div>
              ) : null}
              {searchable ? (
                <SearchField
                  variant="panel"
                  className="pw-grid__search"
                  label="Cari data"
                  value={searchText}
                  placeholder={searchPlaceholder || (manual && !serverSearch ? 'Cari di halaman ini' : 'Cari')}
                  onChange={(event) => changeSearch(event.target.value)}
                  onClear={clearSearch}
                />
              ) : null}
              <div className="pw-grid__toolbar-end">
                {toolbarActions}
                {showImport ? (
                  <Button variant="text" type="button" onClick={() => setImportOpen(true)} disabled={loading}>
                    <Icon name="upload" size="sm" /> Impor
                  </Button>
                ) : null}
                {exportable ? <ExportMenu disabled={loading || (!rows.length && !onExport)} onExport={runExport} /> : null}
                {showCreate ? (
                  <Button type="button" onClick={startCreate} disabled={loading || Boolean(editing)}>
                    <Icon name="add" size="sm" /> {createLabel}
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}
      <span className="sr-only" role="status" aria-live="polite">{countText}</span>

      {filters ? <div className="pw-grid__filters">{filters}</div> : null}

      {resource && resourceState.truncated ? (
        <p className="pw-grid__note" role="status">
          Menampilkan {formatNumber(RESOURCE_MAX_ROWS)} data pertama. Persempit pencarian untuk melihat sisanya.
        </p>
      ) : null}

      {loadError && !fatalError && !loading ? (
        <div className="pw-grid__alert">
          <Banner tone="error" title="Data gagal dimuat" action={retryButton}>{errorText}</Banner>
        </div>
      ) : null}

      {body}

      {showPager ? (
        manual ? (
          <Pager
            page={meta.page}
            pageCount={pageCount(meta.total, meta.limit || 20)}
            onPageChange={onPageChange}
            pageSize={meta.limit || 20}
            total={totalCount}
            pageSizes={onPageSizeChange ? pageSizeOptions(meta.limit || 20) : undefined}
            onPageSizeChange={onPageSizeChange}
            disabled={loading}
          />
        ) : (
          <Pager
            page={pagination.pageIndex + 1}
            pageCount={pageCount(filteredCount, pagination.pageSize)}
            onPageChange={(page) => table.setPageIndex(page - 1)}
            pageSize={pagination.pageSize}
            total={filteredCount}
            pageSizes={pageSizeOptions(pageSize)}
            onPageSizeChange={(size) => { table.setPageSize(size); table.setPageIndex(0); }}
          />
        )
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Hapus data ini?"
        message={deleteTarget ? (deleteMessage?.(deleteTarget) || 'Data yang dihapus tidak tampil lagi di daftar.') : ''}
        confirmLabel="Hapus"
        tone="danger"
        loading={deleting}
        onClose={() => { if (!deleting) setDeleteTarget(null); }}
        onConfirm={confirmDelete}
      />

      {showImport ? (
        <GridImportDialog
          open={importOpen}
          columns={columns}
          baseName={baseName}
          title={title}
          onClose={() => setImportOpen(false)}
          onImport={importRows}
          onImported={reload}
        />
      ) : null}
    </section>
  );
}
