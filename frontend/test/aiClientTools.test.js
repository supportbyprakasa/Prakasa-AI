import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLIENT_OPERATIONS, OPEN_PARAMS, createClientToolExecutor, parseInAppRoute } from '../src/components/ai/aiClientTools.js';
import { createFormRegistry, describeForm, fillForm, syncForm } from '../src/components/ai/aiFormModel.js';
import { BLOCKED_ROUTES, hasRouteAccess } from '../src/components/navigation.js';

// Wave C1 (docs/prakasa-ai-rencana.md §9.8): what the browser does for
// Prakasa AI — open an in-app page, read the registered forms, fill one.

const read = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
const withoutComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

function setup({ permissions = ['it_ticket.view', 'it_ticket.create'], confirm = () => false, location = { pathname: '/it/tickets', search: '' } } = {}) {
  const registry = createFormRegistry();
  const state = { location: { ...location }, navigated: [], asked: [], carried: [], forms: {} };
  const run = createClientToolExecutor({
    registry,
    navigate: (to) => {
      state.navigated.push(to);
      const [pathname, search] = to.split('?');
      state.location = { pathname, search: search ? `?${search}` : '' };
      state.onNavigate?.(to);
    },
    getLocation: () => state.location,
    getPermissions: () => permissions,
    canOpen: hasRouteAccess,
    confirmLeave: async (titles) => { state.asked.push(titles); return confirm(titles); },
    beforeNavigate: (to) => state.carried.push(to.pathname),
    sleep: async () => {},
    formWaitMs: 0,
    settleMs: 0,
  });
  const addForm = (id, { permission = 'it_ticket.create', values = { title: '', priority: 'normal' }, initialValues = { title: '', priority: 'normal' } } = {}) => {
    const form = { values: { ...values }, sets: [] };
    state.forms[id] = form;
    registry.register(id, () => ({
      title: 'Tiket IT',
      permission,
      initialValues,
      fields: [
        { name: 'title', label: 'Judul', type: 'text', required: true },
        { name: 'priority', label: 'Prioritas', type: 'select', options: [{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'Tinggi' }] },
        { name: 'payeeAccountNumber', label: 'Nomor rekening', type: 'text' },
      ],
      getValues: () => form.values,
      setValues: (patch) => { form.sets.push(patch); form.values = { ...form.values, ...patch }; },
    }));
    syncForm(registry.get(id), registry);
    return form;
  };
  return { run, registry, state, addForm };
}

test('the executor knows three operations and nothing else', async () => {
  const { run, state } = setup();
  assert.deepEqual(CLIENT_OPERATIONS, ['buka_halaman', 'baca_formulir', 'isi_form']);
  for (const tool of ['simpan_form', 'kirim_form', 'tekan_tombol', 'submit', 'klik', 'hapus', 'setujui', 'toString', 'constructor', '__proto__', '', undefined]) {
    const outcome = await run({ tool, input: { rute: '/it/tickets/new', formulir: 'it-ticket' } });
    assert.deepEqual(outcome, { ok: false, error: 'Permintaan ini tidak dikenal halaman.' }, String(tool));
  }
  assert.deepEqual(state.navigated, []);
});

test('no executor or registry code can save a form: nothing presses a button, fires an event or calls the API', () => {
  // The modules that run when Prakasa AI works on the page.
  for (const file of ['components/ai/aiClientTools.js', 'components/ai/aiFormModel.js', 'components/ai/aiFormRegistry.js', 'components/ai/usePrakasaAIForm.jsx',
    'components/ai/aiFormFields.js', 'components/ai/useOpenFromUrl.js', 'components/ai/AIFormChip.jsx']) {
    const code = withoutComments(read(file));
    assert.doesNotMatch(code, /\bonSubmit\b|\brequestSubmit\b|\bsubmit\s*\(|\.submit\b/, `${file}: no submit`);
    assert.doesNotMatch(code, /\.click\s*\(|\bdispatchEvent\b|new\s+(Mouse|Keyboard|Pointer|Submit)?Event\b|\bfireEvent\b/, `${file}: no click, no synthetic event`);
    assert.doesNotMatch(code, /\bdocument\b|\bquerySelector|getElementById|\.focus\s*\(/, `${file}: never touches the DOM`);
    assert.doesNotMatch(code, /api\/client|\baxios\b|\bfetch\s*\(|XMLHttpRequest|\bapi\.(get|post|patch|put|delete)\b/, `${file}: never calls the API`);
    assert.doesNotMatch(code, /window\.(confirm|open|location)|\blocation\.(href|assign|replace)\b/, `${file}: no window.confirm, no leaving the app`);
  }
  // The executor's whole vocabulary.
  const executor = withoutComments(read('components/ai/aiClientTools.js'));
  const operations = executor.match(/const OPERATIONS = \{([^}]*)\}/)[1];
  assert.deepEqual(operations.split(',').map((part) => part.split(':')[0].trim()).filter(Boolean), ['buka_halaman', 'baca_formulir', 'isi_form']);
  // The stream only hands a request to the executor and posts its result back.
  const stream = withoutComments(read('api/aiStream.js'));
  const posts = [...stream.matchAll(/fetch\(`\$\{apiBaseUrl\}([^`]+)`/g)].map((m) => m[1]);
  assert.deepEqual(posts.sort(), ['/ai-command/sessions/${sessionId}/messages/stream', '/ai-command/sessions/${sessionId}/tool-results']);
  // The panel asks before leaving a form with the app's own dialog.
  const panel = withoutComments(read('components/ai/PrakasaAIToolPanel.jsx'));
  assert.match(panel, /<ConfirmDialog/);
  assert.doesNotMatch(panel, /window\.confirm|\bconfirm\(/);
  assert.match(panel, /surface="panel"/);
  // The Command Center passes no executor: nothing there can open a page or fill a form.
  assert.doesNotMatch(read('pages/ai/AICommandCenter.jsx'), /onClientTool|createClientToolExecutor/);
});

test('a pilot form\'s submit handler is reachable only from its own <form> and button', () => {
  // usePrakasaAIForm gets values and a setter — never the submit function.
  // (GaForms.jsx registers through defineAIForm since Wave C2a: test/aiFormCoverage.test.js checks both shapes.)
  const forms = ['pages/it/ItTicketForm.jsx', 'components/support/ItHelpSheet.jsx', 'pages/finance/PaymentRequestForm.jsx', 'pages/sales/SalesLeads.jsx', 'pages/tasks/TaskBoard.jsx'];
  for (const file of forms) {
    const code = read(file);
    const calls = [...code.matchAll(/usePrakasaAIForm\(\{([\s\S]*?)\n  \}\);/g)].map((m) => m[1]);
    assert.ok(calls.length >= 1, `${file} registers a form`);
    for (const options of calls) {
      assert.doesNotMatch(options, /\bsubmit\b|\bonSubmit\b|api\.(post|patch|put|delete)/, `${file}: the registration must not hold a way to save`);
      assert.match(options, /permission: '[a-z_]+(\.[a-z_]+)+'/, `${file}: the form names its permission`);
      assert.match(options, /getValues: \(\) =>/);
      assert.match(options, /setValues: \(patch\) =>/);
    }
    assert.match(code, /\{ai\.notice\}/, `${file} shows the notice`);
  }
});

test('navigation: only in-app routes the user may open', async () => {
  const { run, state } = setup();
  const refused = async (rute, reason) => {
    const outcome = await run({ tool: 'buka_halaman', input: { rute } });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.result.dibuka, false, rute);
    assert.match(outcome.result.alasan, reason, rute);
  };
  for (const rute of ['https://evil.example/', 'http://localhost:5173/it/tickets', '//evil.example/x', 'javascript:alert(1)', 'mailto:a@b.c', '/it/../admin', 'it/tickets', '/it/tickets#frag',
    '/it\\tickets', '/a b', '', null, 42, '/x?y=<z>', `/${'a'.repeat(400)}`]) {
    await refused(rute, /Rute tidak valid/);
  }
  // Blocked by the app (hidden features), or a page this user has no permission for.
  for (const rute of BLOCKED_ROUTES) await refused(rute, /tidak punya akses/);
  await refused('/approvals/12', /tidak punya akses/);
  await refused('/finance/payment-requests?baru=1', /tidak punya akses/);
  await refused('/admin/users', /tidak punya akses/);
  assert.deepEqual(state.navigated, [], 'the router was never called');

  const opened = await run({ tool: 'buka_halaman', input: { rute: '/it/tickets/new' } });
  assert.deepEqual(opened, { ok: true, result: { dibuka: true, rute: '/it/tickets/new', formulir: [] } });
  assert.deepEqual(state.navigated, ['/it/tickets/new']);
  assert.deepEqual(state.carried, ['/it/tickets/new'], 'the panel keeps its conversation on the new page');

  assert.deepEqual(parseInAppRoute('/tasks?board=3&baru=1'), { route: '/tasks?board=3&baru=1', pathname: '/tasks', search: '?board=3&baru=1' });
  assert.equal(parseInAppRoute('/it/tickets/').pathname, '/it/tickets');
});

test('the form a route opens is reported once the page has registered it', async () => {
  const { run, state, addForm } = setup();
  state.onNavigate = () => addForm('it-ticket'); // the page mounts and registers
  const opened = await run({ tool: 'buka_halaman', input: { rute: '/it/tickets/new' } });
  assert.deepEqual(opened.result.formulir, [{ id: 'it-ticket', judul: 'Tiket IT' }]);
  // Already there: no second navigation.
  const again = await run({ tool: 'buka_halaman', input: { rute: '/it/tickets/new' } });
  assert.equal(again.result.dibuka, true);
  assert.equal(state.navigated.length, 1);
});

test('a form with unsaved changes: the user is asked first, and no answer or "no" stays', async () => {
  const stay = setup({ confirm: () => false, permissions: ['task.view', 'it_ticket.create'] });
  const form = stay.addForm('it-ticket', { values: { title: 'Sedang saya ketik', priority: 'normal' } });
  const kept = await stay.run({ tool: 'buka_halaman', input: { rute: '/tasks' } });
  assert.equal(kept.result.dibuka, false);
  assert.match(kept.result.alasan, /belum disimpan dan pengguna memilih tetap/);
  assert.deepEqual(stay.state.asked, [['Tiket IT']]);
  assert.deepEqual(stay.state.navigated, []);
  assert.equal(form.values.title, 'Sedang saya ketik');

  // Anything but an explicit yes is a no.
  for (const answer of [undefined, null, 'ya', 1]) {
    const maybe = setup({ confirm: () => answer, permissions: ['task.view', 'it_ticket.create'] });
    maybe.addForm('it-ticket', { values: { title: 'x', priority: 'normal' } });
    assert.equal((await maybe.run({ tool: 'buka_halaman', input: { rute: '/tasks' } })).result.dibuka, false, String(answer));
  }

  const leave = setup({ confirm: () => true, permissions: ['task.view', 'it_ticket.create'] });
  leave.addForm('it-ticket', { values: { title: 'x', priority: 'normal' } });
  assert.equal((await leave.run({ tool: 'buka_halaman', input: { rute: '/tasks' } })).result.dibuka, true);
  assert.deepEqual(leave.state.navigated, ['/tasks']);

  // What the AI itself filled is unsaved too.
  const filled = setup({ confirm: () => false, permissions: ['task.view', 'it_ticket.create'] });
  filled.addForm('it-ticket');
  await filled.run({ tool: 'isi_form', input: { formulir: 'it-ticket', isian: [{ kolom: 'title', isi: 'Wifi mati' }] } });
  assert.equal((await filled.run({ tool: 'buka_halaman', input: { rute: '/tasks' } })).result.dibuka, false);

  // Staying on the SAME page never asks — a form, a record, an action dialog or a tab opened there
  // (?form=…, ?baru=…, ?ubah=…, ?open=…, ?aksi=…, ?tab=…) does not leave the page.
  for (const rute of ['/it/tickets?form=x', '/it/tickets?baru=1', '/it/tickets?ubah=41', '/it/tickets?open=7', '/it/tickets?aksi=tutup', '/it/tickets?tab=saya',
    '/it/tickets?tab=saya&open=7&form=x', '/it/tickets']) {
    const same = setup({ confirm: () => false, permissions: ['it_ticket.view', 'it_ticket.create'] });
    const dirty = same.addForm('it-ticket', { values: { title: 'Sedang saya ketik', priority: 'normal' } });
    const outcome = await same.run({ tool: 'buka_halaman', input: { rute } });
    assert.equal(outcome.result.dibuka, true, rute);
    assert.deepEqual(same.state.asked, [], `${rute}: "Pindah halaman?" must not be asked on the same page`);
    assert.equal(dirty.values.title, 'Sedang saya ketik', rute);
    assert.deepEqual(same.state.navigated, rute === '/it/tickets' ? [] : [rute]);
    // The unsaved form is named, so the model can ask the user to save or close it when the page kept it.
    assert.deepEqual(outcome.result.belum_disimpan, [{ id: 'it-ticket', judul: 'Tiket IT' }], rute);
  }
  // …and another pathname with the same dirty form still asks, whatever its parameters.
  for (const rute of ['/tasks?form=papan', '/it/tickets/41', '/it/tickets/new']) {
    const other = setup({ confirm: () => false, permissions: ['task.view', 'it_ticket.view', 'it_ticket.create'] });
    other.addForm('it-ticket', { values: { title: 'x', priority: 'normal' } });
    assert.equal((await other.run({ tool: 'buka_halaman', input: { rute } })).result.dibuka, false, rute);
    assert.deepEqual(other.state.asked, [['Tiket IT']], rute);
  }

  // A clean form: no question.
  const clean = setup({ permissions: ['task.view', 'it_ticket.create'] });
  clean.addForm('it-ticket');
  assert.equal((await clean.run({ tool: 'buka_halaman', input: { rute: '/tasks' } })).result.dibuka, true);
  assert.deepEqual(clean.state.asked, []);
});

test('filling: only a registered form, only with the form\'s permission, only fillable fields', async () => {
  const { run, addForm } = setup();
  const missing = await run({ tool: 'isi_form', input: { formulir: 'tidak-ada', isian: [{ kolom: 'title', isi: 'x' }] } });
  assert.deepEqual(missing, { ok: false, error: 'Formulir itu tidak terbuka di halaman ini.' });

  const form = addForm('it-ticket');
  const outcome = await run({ tool: 'isi_form', input: { formulir: 'it-ticket', isian: [{ kolom: 'title', isi: 'Wifi mati' }, { kolom: 'priority', isi: 'Tinggi' }, { kolom: 'payeeAccountNumber', isi: '123' }, { kolom: 'lain', isi: 'x' }] } });
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.result.diisi, ['title', 'priority']);
  assert.deepEqual(outcome.result.ditolak.map((item) => item.nama), ['payeeAccountNumber', 'lain']);
  assert.deepEqual(form.sets, [{ title: 'Wifi mati', priority: 'high' }]);

  // The user does not hold the permission the form declares.
  const other = setup({ permissions: ['it_ticket.view'] });
  const untouched = other.addForm('it-ticket');
  const denied = await other.run({ tool: 'isi_form', input: { formulir: 'it-ticket', isian: [{ kolom: 'title', isi: 'x' }] } });
  assert.deepEqual(denied, { ok: false, error: 'Pengguna tidak punya izin untuk formulir ini.' });
  assert.deepEqual(untouched.sets, []);
  // A form that declares none cannot be filled.
  const none = setup();
  none.addForm('it-ticket', { permission: null });
  assert.equal((await none.run({ tool: 'isi_form', input: { formulir: 'it-ticket', isian: [{ kolom: 'title', isi: 'x' }] } })).ok, false);
});

test('reading: the forms on the page with the current route; requests run one at a time, in order', async () => {
  const { run, state, addForm } = setup();
  const empty = await run({ tool: 'baca_formulir', input: {} });
  assert.deepEqual(empty, { ok: true, result: { rute: '/it/tickets', formulir: [] } });

  // Open, then fill, sent together: the fill waits for the page.
  state.onNavigate = () => addForm('it-ticket');
  const [opened, filled, seen] = await Promise.all([
    run({ tool: 'buka_halaman', input: { rute: '/it/tickets/new' } }),
    run({ tool: 'isi_form', input: { formulir: 'it-ticket', isian: [{ kolom: 'title', isi: 'Wifi mati' }] } }),
    run({ tool: 'baca_formulir', input: {} }),
  ]);
  assert.equal(opened.result.dibuka, true);
  assert.deepEqual(filled.result.diisi, ['title']);
  assert.equal(seen.result.rute, '/it/tickets/new');
  const title = seen.result.formulir[0].kolom.find((k) => k.nama === 'title');
  assert.deepEqual([title.isi, title.diisi_ai], ['Wifi mati', true]);
  assert.equal(seen.result.formulir[0].kolom.find((k) => k.nama === 'payeeAccountNumber').isi, undefined);
});

// ---------------------------------------------------------------- Wave C2a (§9.11)

test('a form the route opens is waited for: the server says so, and so do the URL-open parameters', async () => {
  assert.deepEqual(OPEN_PARAMS, ['baru', 'ubah', 'form', 'buat', 'aksi', 'bantuan', 'kunjungan']);
  const waits = async (input, { permissions = ['it_ticket.view', 'it_ticket.create', 'task.view'] } = {}) => {
    const registry = createFormRegistry();
    let slept = 0;
    const run = createClientToolExecutor({
      registry, navigate: () => {}, getLocation: () => ({ pathname: '/', search: '' }), getPermissions: () => permissions, canOpen: hasRouteAccess,
      confirmLeave: async () => false, sleep: async () => { slept += 1; }, formWaitMs: 600, settleMs: 0, now: (() => { let at = 0; return () => { at += 200; return at; }; })(),
    });
    await run({ tool: 'buka_halaman', input });
    return slept > 1;
  };
  assert.equal(await waits({ rute: '/it/tickets' }), false);
  assert.equal(await waits({ rute: '/it/tickets', harap_formulir: true }), true, 'a detail page with an edit form: the catalog knows');
  assert.equal(await waits({ rute: '/it/tickets?ubah=41' }), true);
  assert.equal(await waits({ rute: '/tasks?board=3&baru=1' }), true);
  assert.equal(await waits({ rute: '/tasks?form=papan' }), true);
  assert.equal(await waits({ rute: '/tasks?board=3&barukah=1' }), false);
  assert.equal(await waits({ rute: '/doc-templates?buat=7' }, { permissions: ['template.view'] }), true, 'a form made from a record');
  assert.equal(await waits({ rute: '/sales/orders/9?aksi=invoice' }, { permissions: ['sales.order.view'] }), true, 'an action dialog');
  // A record, a tab or a filter alone opens no form: nothing to wait for (the server says so when one does).
  assert.equal(await waits({ rute: '/it/infrastructure?tab=backup&open=3' }, { permissions: ['it.infra.view'] }), false);
  assert.equal(await waits({ rute: '/sales/leads?lead=4' }, { permissions: ['sales.customer.view'] }), false);
  assert.equal(await waits({ rute: '/it/infrastructure?tab=backup&open=3&form=pemeriksaan' }, { permissions: ['it.infra.view'] }), true);
  // useOpenFromUrl only opens: it knows the router's search parameters and nothing else.
  const hook = withoutComments(read('components/ai/useOpenFromUrl.js'));
  assert.match(hook, /useSearchParams/);
  assert.match(hook, /next\.delete\(param\)/);
  assert.match(hook, /replace: true/);
  // A page whose opener replaces the open dialog says keepUnsaved: an unsaved registered form is never discarded by a link.
  assert.match(hook, /unsavedForms\(aiFormRegistry\.list\(\), keep\)\.length > 0/);
  assert.match(hook, /if \(!hasUnsavedForm\(keep\.current\)\) latest\.current\(value\)/);
  assert.doesNotMatch(hook, /api\.|fetch\(|\.click\(|dispatchEvent|requestSubmit/);
  assert.equal((read('pages/ga/GaServices.jsx').match(/keepUnsaved: true/g) || []).length, 2);
});

test('isi_form on the page: lookups run the page\'s own search, an edit form must name its record, and the panel is told', async () => {
  const { run, registry, state } = setup();
  const told = [];
  const executor = createClientToolExecutor({
    registry, navigate: (to) => state.navigated.push(to), getLocation: () => state.location, getPermissions: () => ['it_ticket.view', 'it_ticket.create'], canOpen: hasRouteAccess,
    confirmLeave: async () => false, sleep: async () => {}, formWaitMs: 0, settleMs: 0,
    onOpened: (forms) => told.push(['opened', forms.map((form) => form.id)]), onFilled: (id, result) => told.push(['filled', id, result.diisi]),
  });
  const values = { device: '', title: '' };
  const searches = [];
  const config = {
    title: 'Ubah tiket', permission: 'it_ticket.create', mode: 'edit', record: { type: 'it_ticket', id: 41 }, initialValues: { device: '', title: '' },
    fields: [
      { name: 'title', label: 'Judul', type: 'text' },
      { name: 'device', label: 'Perangkat', type: 'lookup', search: async (text) => { searches.push(text); return [{ value: 7, label: 'Laptop Dell 7', hint: 'IT-LPT-007' }, { value: 8, label: 'Laptop Dell 8', hint: 'IT-LPT-008' }]; } },
    ],
    getValues: () => values, setValues: (patch) => Object.assign(values, patch),
  };
  registry.register('it-ticket-edit', () => config);

  const opened = await executor({ tool: 'buka_halaman', input: { rute: '/it/tickets/41', harap_formulir: true } });
  assert.deepEqual(opened.result.formulir, [{ id: 'it-ticket-edit', judul: 'Ubah tiket' }]);
  const ambiguous = await executor({ tool: 'isi_form', input: { formulir: 'it-ticket-edit', isian: [{ kolom: 'device', isi: 'Laptop Dell' }] } });
  assert.deepEqual(ambiguous.result.diisi, []);
  assert.deepEqual(ambiguous.result.ditolak[0].kandidat, ['Laptop Dell 7 — IT-LPT-007', 'Laptop Dell 8 — IT-LPT-008']);
  assert.equal(values.device, '');
  const one = await executor({ tool: 'isi_form', input: { formulir: 'it-ticket-edit', isian: [{ kolom: 'device', isi: 'IT-LPT-008' }, { kolom: 'title', isi: 'Layar retak' }] } });
  assert.deepEqual(one.result.diisi, ['device', 'title']);
  assert.deepEqual(values, { device: 8, title: 'Layar retak' });
  assert.deepEqual(searches, ['Laptop Dell', 'IT-LPT-008']);
  assert.deepEqual(told, [['opened', ['it-ticket-edit']], ['filled', 'it-ticket-edit', ['device', 'title']]], 'an ambiguous fill sets nothing and tells nobody');
  const seen = await run({ tool: 'baca_formulir', input: {} });
  assert.deepEqual([seen.result.formulir[0].mode, seen.result.formulir[0].rekaman], ['ubah', { jenis: 'it_ticket', id: '41' }]);

  // An edit form that does not say which record it changes is not filled.
  config.record = null;
  const refused = await executor({ tool: 'isi_form', input: { formulir: 'it-ticket-edit', isian: [{ kolom: 'title', isi: 'x' }] } });
  assert.deepEqual(refused, { ok: false, error: 'Formulir ubah ini tidak menyebut data yang diubah.' });
  assert.equal(values.title, 'Layar retak');
});

test('phone and tablet: the panel steps aside for a filled form and a chip brings the conversation back — nothing more', () => {
  const panel = withoutComments(read('components/ai/PrakasaAIToolPanel.jsx'));
  assert.match(panel, /onOpened: \(\) => \{ setAiOnForm\(true\); setShowChat\(true\); \}/);
  assert.match(panel, /onFilled: \(\) => \{ setAiOnForm\(true\); setShowChat\(false\); \}/);
  assert.match(panel, /const small = mode !== 'desktop';/);
  assert.match(panel, /<AIFormChip filled=\{\{ fields: filledFields, rows: filledRows \}\} onOpen=\{\(\) => setShowChat\(true\)\} \/>/);
  const chip = withoutComments(read('components/ai/AIFormChip.jsx'));
  assert.match(chip, /Terisi \$\{fields\} kolom — periksa lalu simpan/);
  assert.match(chip, /<Button variant="primary" icon="auto_awesome" className="pw-ai-chip" onClick=\{onOpen\}/);
  assert.doesNotMatch(chip, /type="submit"|form=/);
  const css = read('components/ai/ai-tool-panel.css');
  assert.match(css, /\.pw-ai-panel\.is-tucked,\s*\.pw-ai-scrim:has\(~ \.pw-ai-panel\.is-tucked\) \{\s*display: none;/);
});

// ---------------------------------------------------------------- Wave C2 merge (§9.12)

test('fill → read in the same tick: the read shows what the AI set, marked as the AI\'s — before the form\'s state has committed', async () => {
  // A form as React holds it: the setter only QUEUES the update; the values change on the next render.
  const registry = createFormRegistry();
  const state = { values: { title: '', note: 'catatan saya', items: [{ name: 'Kertas', qty: '2' }] }, queue: [] };
  const run = createClientToolExecutor({
    registry, navigate: () => {}, getLocation: () => ({ pathname: '/it/tickets', search: '' }), getPermissions: () => ['it_ticket.create'], canOpen: hasRouteAccess,
    confirmLeave: async () => false, sleep: async () => {}, formWaitMs: 0, settleMs: 0,
  });
  registry.register('it-ticket', () => ({
    title: 'Tiket IT', permission: 'it_ticket.create', initialValues: { title: '', note: '', items: [] },
    fields: [
      { name: 'title', label: 'Judul', type: 'text', required: true },
      { name: 'note', label: 'Catatan', type: 'text' },
      { name: 'items', label: 'Barang', type: 'rows', columns: [{ name: 'name', label: 'Nama', type: 'text', required: true }, { name: 'qty', label: 'Jumlah', type: 'number' }] },
    ],
    getValues: () => state.values,
    setValues: (patch) => { state.queue.push(patch); },
  }));
  const entry = registry.get('it-ticket');
  const render = () => { for (const patch of state.queue.splice(0)) state.values = { ...state.values, ...patch }; syncForm(entry, registry); };
  render();

  const filled = await run({ tool: 'isi_form', input: { formulir: 'it-ticket', isian: [{ kolom: 'title', isi: 'Wifi mati' }, { kolom: 'items', baris: [{ name: 'Spidol', qty: '3' }] }] } });
  assert.deepEqual(filled.result.diisi, ['title', 'items']);
  assert.equal(state.values.title, '', 'the form\'s state has not committed yet');

  // Same tick: no render in between.
  const read = (await run({ tool: 'baca_formulir', input: {} })).result.formulir[0];
  const byName = Object.fromEntries(read.kolom.map((k) => [k.nama, k]));
  assert.deepEqual([byName.title.isi, byName.title.diisi_ai, byName.title.diisi_pengguna], ['Wifi mati', true, undefined]);
  assert.deepEqual([byName.note.isi, byName.note.diisi_pengguna], ['catatan saya', true], 'what the user typed is still the user\'s');
  assert.deepEqual(byName.items.baris, [
    { no: 1, isi: { name: 'Kertas', qty: '2' }, diisi_pengguna: true },
    { no: 2, isi: { name: 'Spidol', qty: '3' }, diisi_ai: true },
  ]);
  assert.equal(read.belum_disimpan, true);

  // A second fill in the same tick builds on the first: its rows are kept, its value may be replaced by the AI.
  const again = await run({ tool: 'isi_form', input: { formulir: 'it-ticket', isian: [{ kolom: 'title', isi: 'Wifi lantai 2 mati' }, { kolom: 'items', baris: [{ name: 'Lakban', qty: '1' }] }, { kolom: 'note', isi: 'x' }] } });
  assert.deepEqual(again.result.diisi, ['title', 'items']);
  assert.deepEqual(again.result.ditolak, [{ nama: 'note', alasan: 'Sudah diisi pengguna.' }]);
  const second = (await run({ tool: 'baca_formulir', input: {} })).result.formulir[0];
  assert.equal(second.kolom[0].isi, 'Wifi lantai 2 mati');
  assert.deepEqual(second.kolom[2].baris.map((row) => [row.isi.name, row.diisi_ai === true]), [['Kertas', false], ['Spidol', true], ['Lakban', true]]);

  // The form renders: its state now holds the same values, and the marks stay.
  render();
  assert.deepEqual([state.values.title, state.values.items.map((row) => row.name)], ['Wifi lantai 2 mati', ['Kertas', 'Spidol', 'Lakban']]);
  const after = (await run({ tool: 'baca_formulir', input: {} })).result.formulir[0];
  assert.deepEqual([after.kolom[0].isi, after.kolom[0].diisi_ai], ['Wifi lantai 2 mati', true]);
  // The user edits: the mark goes, and the read says it is the user's.
  state.values = { ...state.values, title: 'Wifi lantai 2 mati total' };
  render();
  const edited = (await run({ tool: 'baca_formulir', input: {} })).result.formulir[0];
  assert.deepEqual([edited.kolom[0].isi, edited.kolom[0].diisi_ai, edited.kolom[0].diisi_pengguna], ['Wifi lantai 2 mati total', undefined, true]);
});

test('a fill a form never takes does not stay "filled": the mark goes after a few renders, and the read shows the real value', () => {
  const registry = createFormRegistry();
  const state = { values: { title: '' } };
  registry.register('f', () => ({
    permission: 'task.create', initialValues: { title: '' }, fields: [{ name: 'title', label: 'Judul', type: 'text' }],
    getValues: () => state.values, setValues: () => {}, // a setter that ignores the value
  }));
  const entry = registry.get('f');
  syncForm(entry, registry);
  fillForm(entry, [{ kolom: 'title', isi: 'Wifi' }], { registry });
  assert.equal(describeForm(entry).kolom[0].isi, 'Wifi', 'the same tick: what the AI set');
  for (let render = 0; render < 8; render += 1) syncForm(entry, registry);
  assert.equal(entry.filled.size, 0);
  assert.deepEqual([describeForm(entry).kolom[0].isi, describeForm(entry).kolom[0].diisi_ai], ['', undefined]);
});

test('baca_formulir waits for a form the server expects — a dialog registers only once its lookups have loaded', async () => {
  const registry = createFormRegistry();
  let slept = 0;
  let clock = 0;
  const run = createClientToolExecutor({
    registry, navigate: () => {}, getLocation: () => ({ pathname: '/ga', search: '' }), getPermissions: () => ['ga.request.create'], canOpen: hasRouteAccess,
    confirmLeave: async () => false, formWaitMs: 3000, settleMs: 0, now: () => clock,
    sleep: async (ms) => {
      slept += 1; clock += ms || 1;
      // The lookups arrive on the third wait: only then does the form register (bindAIForm `ready`).
      if (slept === 3) {
        registry.register('ga-booking-room', () => ({
          title: 'Pinjam ruang', permission: 'ga.request.create',
          fields: [{ name: 'resourceId', label: 'Ruang', type: 'select', options: [{ value: 1, label: 'Ruang rapat A' }] }],
          getValues: () => ({ resourceId: '' }), setValues: () => {},
        }));
      }
    },
  });
  const read = await run({ tool: 'baca_formulir', input: { harap_formulir: true } });
  assert.deepEqual(read.result.formulir.map((form) => form.id), ['ga-booking-room']);
  assert.deepEqual(read.result.formulir[0].kolom[0].pilihan, ['Ruang rapat A'], 'never an empty option list');
  // Not expected: one short settle, then the empty answer.
  const idle = createFormRegistry();
  let waits = 0;
  const plain = createClientToolExecutor({
    registry: idle, navigate: () => {}, getLocation: () => ({ pathname: '/ga', search: '' }), getPermissions: () => [], canOpen: hasRouteAccess,
    confirmLeave: async () => false, formWaitMs: 3000, settleMs: 0, sleep: async () => { waits += 1; },
  });
  assert.deepEqual((await plain({ tool: 'baca_formulir', input: {} })).result.formulir, []);
  assert.equal(waits, 1);
});

test('a form\'s permission may be a list (any of): the page fills when the user holds one of them, and says which it declared', async () => {
  for (const [held, expected] of [[['management_dashboard.division'], true], [['management_dashboard.view'], true], [['division_dashboard.view'], false], [[], false]]) {
    const registry = createFormRegistry();
    const values = { note: '' };
    const run = createClientToolExecutor({
      registry, navigate: () => {}, getLocation: () => ({ pathname: '/escalations', search: '' }), getPermissions: () => held, canOpen: hasRouteAccess,
      confirmLeave: async () => false, sleep: async () => {}, formWaitMs: 0, settleMs: 0,
    });
    registry.register('management-escalation-followup', () => ({
      title: 'Tindak lanjut eskalasi', permission: ['management_dashboard.view', 'management_dashboard.division'], mode: 'edit', record: { type: 'escalation_followup', id: 'approval_aged-41' },
      initialValues: { note: '' }, fields: [{ name: 'note', label: 'Catatan', type: 'textarea' }],
      getValues: () => values, setValues: (patch) => Object.assign(values, patch),
    }));
    const read = (await run({ tool: 'baca_formulir', input: {} })).result.formulir[0];
    assert.deepEqual(read.izin, ['management_dashboard.view', 'management_dashboard.division']);
    const outcome = await run({ tool: 'isi_form', input: { formulir: 'management-escalation-followup', isian: [{ kolom: 'note', isi: 'Sudah dihubungi' }] } });
    assert.equal(outcome.ok, expected, JSON.stringify(held));
    assert.equal(values.note, expected ? 'Sudah dihubungi' : '');
    if (!expected) assert.equal(outcome.error, 'Pengguna tidak punya izin untuk formulir ini.');
  }
  // A list that is not a list of permission codes is no permission at all.
  for (const permission of [[], ['bukan izin'], ['a.b', 5], null, undefined, 'x']) {
    const registry = createFormRegistry();
    const run = createClientToolExecutor({
      registry, navigate: () => {}, getLocation: () => ({ pathname: '/', search: '' }), getPermissions: () => ['a.b'], canOpen: hasRouteAccess,
      confirmLeave: async () => false, sleep: async () => {}, formWaitMs: 0, settleMs: 0,
    });
    registry.register('f', () => ({ permission, fields: [{ name: 'note', label: 'Catatan', type: 'text' }], getValues: () => ({ note: '' }), setValues: () => {} }));
    assert.equal((await run({ tool: 'baca_formulir', input: {} })).result.formulir[0].izin, null, JSON.stringify(permission));
    assert.equal((await run({ tool: 'isi_form', input: { formulir: 'f', isian: [{ kolom: 'note', isi: 'x' }] } })).ok, false, JSON.stringify(permission));
  }
});
