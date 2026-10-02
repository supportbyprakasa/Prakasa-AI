import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import DataGrid from '../../components/datagrid/DataGrid';
import EmptyState from '../../components/EmptyState';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import IconButton from '../../components/IconButton';
import KeyValue from '../../components/KeyValue';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import TabBar from '../../components/TabBar';
import { toast } from '../../components/Toast';
import GoogleAvatar from './GoogleAvatar';
import {
  GROUP_TABS, composeHref, memberCountLabel, memberDisplayName, memberTypeLabel,
  roleLabel, sortMembers, withMembership,
} from './groupsModel';
import './groups.css';

const errorText = (error, fallback) => error?.response?.data?.error?.message || fallback;

async function copyEmail(email) {
  try {
    await navigator.clipboard.writeText(email);
    toast('Email grup disalin', 'success');
  } catch {
    toast('Email gagal disalin', 'error');
  }
}

// "Nama (email)" for search, sort and export; the email alone when it is the name.
function withEmail(name, email) {
  if (!email || !name || name === email) return name || email || '';
  return `${name} (${email})`;
}

const MEMBER_COLUMNS = [
  {
    key: 'name',
    header: 'Nama',
    // Name and email: what search, sorting and export see.
    exportValue: (row) => withEmail(memberDisplayName(row), row.email),
    render: (row) => (
      <span className="gg-person">
        <GoogleAvatar name={memberDisplayName(row)} kind={row.type === 'GROUP' ? 'group' : 'person'} size="sm" />
        <span className="pw-cell">
          <span className="pw-cell__title">{memberDisplayName(row)}</span>
          {row.name ? <span data-no-translate="" className="pw-cell__meta">{row.email}</span> : null}
        </span>
      </span>
    ),
  },
  { key: 'role', header: 'Peran', translate: true, exportValue: (row) => roleLabel(row.role), render: (row) => roleLabel(row.role) },
  { key: 'type', header: 'Jenis', translate: true, exportValue: (row) => memberTypeLabel(row.type), render: (row) => memberTypeLabel(row.type) },
];

// A group opens full screen, like a record in the admin console: its details,
// the way to its conversations, and its members as one panel.
function GroupDetail({ group, onClose }) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!group) return undefined;
    let active = true;
    setState({ loading: true, error: '', data: null });
    api.get(`/google-groups/groups/${encodeURIComponent(group.email)}`)
      .then((response) => { if (active) setState({ loading: false, error: '', data: response.data.data }); })
      .catch((error) => { if (active) setState({ loading: false, error: errorText(error, 'Detail grup gagal dimuat.'), data: null }); });
    return () => { active = false; };
  }, [group, reload]);

  const detail = state.data?.group || group;
  const members = useMemo(() => sortMembers(state.data?.members || []), [state.data]);

  let membersBody = null;
  if (!state.loading && state.error) {
    membersBody = (
      <EmptyState
        tone="error"
        compact
        title="Anggota gagal dimuat"
        description={state.error}
        action={<Button variant="text" onClick={() => setReload((n) => n + 1)}>Coba lagi</Button>}
      />
    );
  } else if (!state.loading && state.data && !state.data.canSeeMembers) {
    membersBody = (
      <EmptyState
        compact
        icon="lock"
        title="Daftar anggota terbatas"
        description="Anggota grup hanya bisa dilihat oleh anggota grup ini dan admin."
      />
    );
  }

  return (
    <FullScreenDialog open={Boolean(group)} onClose={onClose} title={detail?.name || 'Grup'} dataTitle={Boolean(detail?.name)} card={false}>
      <FullScreenSection title="Informasi grup">
        {detail?.description ? <p data-no-translate="" className="gg-detail__description">{detail.description}</p> : null}
        <KeyValue
          items={[
            {
              label: 'Email grup',
              value: (
                <span className="gg-email">
                  <span data-no-translate="" className="gg-email__text">{detail?.email}</span>
                  <IconButton size="sm" icon="content_copy" label="Salin email" onClick={() => copyEmail(detail?.email)} />
                </span>
              ),
            },
            { label: 'Anggota langsung', translate: true, value: memberCountLabel(detail?.directMembersCount) },
          ]}
        />
        <div className="pw-row">
          <Button icon="mail" to={composeHref(detail?.email)}>Kirim email ke grup</Button>
        </div>
        <Banner
          tone="info"
          title="Percakapan grup"
          action={detail?.conversationUrl ? (
            <Button variant="text" icon="open_in_new" href={detail.conversationUrl} target="_blank" rel="noopener noreferrer">
              Buka di Google Groups
            </Button>
          ) : null}
        >
          Google tidak menyediakan akses baca percakapan grup lewat API, jadi percakapan dibuka di Google Groups.
        </Banner>
      </FullScreenSection>

      {membersBody || (
        <DataGrid
          title="Anggota"
          exportName={`anggota-${detail?.email || 'grup'}`}
          columns={MEMBER_COLUMNS}
          rows={members}
          loading={state.loading || !state.data}
          idKey="email"
          pageSize={10}
          empty="Grup ini belum punya anggota."
        />
      )}
    </FullScreenDialog>
  );
}

export default function Groups() {
  const [tab, setTab] = useState('mine');
  const [state, setState] = useState({ loading: true, error: '', mine: [], all: [] });
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: '' }));
    Promise.all([
      api.get('/google-groups/groups', { params: { scope: 'mine' } }),
      api.get('/google-groups/groups', { params: { scope: 'all' } }),
    ])
      .then(([mine, all]) => {
        if (!active) return;
        const myGroups = mine.data.data.groups || [];
        setState({ loading: false, error: '', mine: myGroups, all: withMembership(all.data.data.groups || [], myGroups) });
      })
      .catch((error) => {
        if (active) setState({ loading: false, error: errorText(error, 'Google Groups gagal dimuat.'), mine: [], all: [] });
      });
    return () => { active = false; };
  }, [reload]);

  const rows = tab === 'mine' ? state.mine : state.all;
  const closeDetail = useCallback(() => setSelected(null), []);
  const tabs = GROUP_TABS.map((item) => ({
    k: item.key,
    l: item.label,
    count: state.loading || state.error ? undefined : (item.key === 'mine' ? state.mine : state.all).length,
  }));

  const columns = useMemo(() => [
    {
      key: 'name',
      header: 'Nama grup',
      exportValue: (row) => withEmail(row.name, row.email),
      render: (row) => (
        <span className="gg-person">
          <GoogleAvatar name={row.name} kind="group" size="sm" />
          <span className="pw-cell">
            <span data-no-translate="" className="pw-cell__title">{row.name}</span>
            <span data-no-translate="" className="pw-cell__meta">{row.email}</span>
          </span>
        </span>
      ),
    },
    { key: 'description', header: 'Deskripsi', render: (row) => (row.description ? <span className="gg-desc">{row.description}</span> : '') },
    ...(tab === 'all' ? [{ key: 'isMember', header: 'Keanggotaan', translate: true, exportValue: (row) => (row.isMember ? 'Anggota' : ''), render: (row) => (row.isMember ? 'Anggota' : '') }] : []),
    { key: 'directMembersCount', header: 'Anggota', type: 'number', width: 110 },
  ], [tab]);

  let body;
  if (state.error) {
    body = (
      <EmptyState
        tone="error"
        title="Google Groups gagal dimuat"
        description={state.error}
        action={<Button variant="text" onClick={() => setReload((n) => n + 1)}>Coba lagi</Button>}
      />
    );
  } else if (!state.loading && tab === 'mine' && !rows.length) {
    body = (
      <EmptyState
        icon="group"
        title="Anda belum tergabung di grup mana pun"
        description="Lihat tab Semua grup untuk daftar grup perusahaan."
        action={<Button variant="text" onClick={() => setTab('all')}>Lihat semua grup</Button>}
      />
    );
  } else {
    body = (
      <DataGrid
        title={tab === 'mine' ? 'Grup saya' : 'Semua grup'}
        exportName={tab === 'mine' ? 'grup-saya' : 'semua-grup'}
        columns={columns}
        rows={rows}
        loading={state.loading}
        idKey="email"
        onRowClick={setSelected}
        rowActions={(row) => (
          <>
            <IconButton size="sm" icon="content_copy" label={`Salin email ${row.email}`} onClick={() => copyEmail(row.email)} />
            <IconButton size="sm" icon="mail" label="Kirim email ke grup" to={composeHref(row.email)} />
          </>
        )}
        empty="Belum ada grup."
      />
    );
  }

  return (
    <Page>
      <PageHeader
        title="Groups"
        description="Google Groups perusahaan: lihat grup Anda, anggotanya, dan kirim email ke grup."
      />

      <div className="pw-stack pw-stack--lg">
        <TabBar tabs={tabs} value={tab} onChange={setTab} label="Pilihan daftar grup" idPrefix="gg-tab" panelId="gg-panel" />
        <div id="gg-panel" role="tabpanel" aria-labelledby={`gg-tab-${tab}`}>
          {body}
        </div>
      </div>

      {selected ? <GroupDetail group={selected} onClose={closeDetail} /> : null}
    </Page>
  );
}
