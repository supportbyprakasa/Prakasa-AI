# Prakasa AI Command Center UI Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Mengubah halaman produksi `/ai-command` menjadi workspace AI bergaya ChatGPT dengan bahasa visual Google Workspace Material 3 light, loading yang selalu terlihat, sidebar sesi yang dapat diringkas, dan panel dokumen/konteks/aksi yang dapat diubah lebarnya.

**Architecture:** Pertahankan API dan state server yang sudah ada. Pisahkan logika layout responsif, status loading, dan batas ukuran panel menjadi fungsi murni yang dapat diuji. `AICommandCenter` menjadi shell tiga panel; komponen yang sudah ada tetap menangani sesi, percakapan, konteks, dan proposal aksi. Panel dokumen baru hanya menampilkan konteks dokumen nyata dari API—tanpa data tiruan—serta menyediakan jalur jelas untuk melampirkan dokumen melalui tab konteks.

**Tech Stack:** React 18, React Router 6, Vite 5, Lucide React, CSS biasa yang di-scope ke `.ai-command-page`, Node built-in test runner.

**Source design:** `docs/superpowers/specs/2026-09-23-prakasa-ai-workspace-governance-platform-design.md`

## Global constraints

- Kerjakan langsung pada checkout aktif sesuai permintaan pengguna; jangan membuat worktree atau route prototype.
- Jangan mengubah kontrak backend pada fase ini.
- Pertahankan seluruh perubahan yang sudah ada, termasuk perubahan lokal pada file AI yang akan disentuh.
- Jangan commit karena worktree memiliki perubahan pengguna yang bertumpang tindih dengan file implementasi.
- Token dan interaction state Material 3 harus di-scope ke AI Command Center agar halaman lain tidak berubah.
- Jangan menampilkan dokumen, progress percentage, atau kemampuan yang belum benar-benar tersedia.
- Jangan menambah dependency baru hanya untuk pengujian UI ini.

## Review focus

- Nilai panel tersimpan di `localStorage` bisa rusak, terlalu kecil, atau lebih besar dari viewport.
- Resize pointer dan keyboard harus berhenti pada breakpoint mobile/tablet dan tidak menyebabkan horizontal overflow.
- Loading harus terlihat saat request sedang dikirim walaupun `generationStatus` dari server masih stale.
- Empty state harus aman ketika belum ada sesi atau konteks dokumen.
- Kontrol collapse, tab, dan resize harus dapat digunakan dengan keyboard dan memiliki label aksesibel.

---

### Task 1: Create tested UI state helpers

**Files:**
- Create: `frontend/test/aiCommandCenterModel.test.js`
- Create: `frontend/src/pages/ai/aiCommandCenterModel.js`
- Modify: `frontend/package.json`

**Step 1: Write the failing test**

Tambahkan test Node untuk:

- `resolveResponsiveMode()` pada batas mobile, tablet, dan desktop.
- `clampDocumentPanelWidth()` untuk nilai normal, terlalu kecil, terlalu besar, viewport sempit, serta nilai non-numerik.
- `isGenerationActive()` saat request lokal sedang berjalan atau status server bernilai `generating`.
- `normalizeStoredPanelWidth()` untuk data `localStorage` yang valid dan rusak.

**Step 2: Run test to verify it fails**

Run: `cd frontend && node --test test/aiCommandCenterModel.test.js`

Expected: FAIL karena module helper belum tersedia.

**Step 3: Write minimal implementation**

Implementasikan constant breakpoint, batas panel, fungsi clamp/normalisasi, dan resolver loading sebagai fungsi murni tanpa ketergantungan browser.

**Step 4: Add a repeatable package script**

Tambahkan `"test:ai-ui": "node --test test/aiCommandCenterModel.test.js"` tanpa mengubah script lain.

**Step 5: Run test to verify it passes**

Run: `cd frontend && npm run test:ai-ui`

Expected: PASS seluruh test.

---

### Task 2: Build the production three-pane command center

**Files:**
- Modify: `frontend/src/pages/ai/AICommandCenter.jsx`
- Create: `frontend/src/pages/ai/ai-command-center.css`
- Create: `frontend/src/components/ai/AIDocumentWorkspace.jsx`

**Step 1: Add a failing behavior test for persisted width edge cases**

Perluas `aiCommandCenterModel.test.js` dengan kasus viewport berubah setelah ukuran panel tersimpan.

**Step 2: Run the targeted test to verify it fails**

Run: `cd frontend && npm run test:ai-ui`

Expected: FAIL pada kasus baru.

**Step 3: Implement the shell behavior**

- Buat sidebar sesi desktop yang dapat collapse.
- Buat area percakapan fleksibel dan supporting pane di kanan.
- Tambahkan tab `Dokumen`, `Konteks`, dan `Aksi`.
- Tambahkan resize handle dengan pointer events, keyboard arrows, ARIA separator, dan penyimpanan `localStorage`.
- Clamp ukuran panel setiap kali viewport berubah.
- Pada tablet/mobile, gunakan navigasi tab yang sudah familier dan cegah overflow horizontal.
- Tampilkan identitas konteks aktif tanpa menciptakan data organisasi fiktif.

**Step 4: Implement the real document workspace**

- Ambil contexts dari endpoint sesi yang sudah ada.
- Filter hanya `contextType === 'document'`.
- Tampilkan daftar dokumen terhubung, metadata yang tersedia, selected state, serta empty state.
- Sediakan tombol untuk berpindah ke tab konteks ketika pengguna ingin melampirkan dokumen.
- Jangan mengarang preview isi atau URL dokumen.

**Step 5: Add scoped Material 3 light styling**

- Gunakan surface hierarchy Google Workspace, primary `#0b57d0`, typography Google Sans/Roboto/Arial fallback.
- Terapkan hover/focus/pressed state layers, rounded containers, border halus, dan shadow yang tertahan.
- Tambahkan click ripple berbasis CSS tanpa scaling atau bounce.
- Pastikan `prefers-reduced-motion` dihormati.

**Step 6: Complete helper behavior and run tests**

Run: `cd frontend && npm run test:ai-ui`

Expected: PASS.

---

### Task 3: Polish the conversation flow and verify the application

**Files:**
- Modify: `frontend/src/components/ai/AIConversation.jsx`
- Modify: `frontend/src/components/ai/AISessionList.jsx`
- Modify as needed: `frontend/src/components/ai/AIContextPanel.jsx`
- Modify as needed: `frontend/src/components/ai/AIActionProposals.jsx`

**Step 1: Add a failing generation-state regression test**

Tambahkan kasus bahwa `sending: true` selalu mengaktifkan indikator walaupun status server `idle`, dan status `failed` tidak dianggap sedang loading.

**Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:ai-ui`

Expected: FAIL pada assertion baru.

**Step 3: Implement visible loading and ChatGPT-style conversation polish**

- Gunakan helper generation state untuk menampilkan status kerja saat request lokal atau generasi server aktif.
- Tampilkan spinner, copy status, dan pending surface tanpa percentage palsu.
- Rapikan message row, avatar, composer, empty state, suggestion chips, error state, dan focus ring.
- Pertahankan payload API, optimistic message, retry/error flow, dan semua perilaku bisnis saat ini.

**Step 4: Polish the session list and supporting panels**

- Terapkan selection, hover, focus, create-session action, dan spacing Material 3.
- Jangan menghapus filter, modal pembuatan sesi, konteks, atau workflow proposal yang sudah ada.

**Step 5: Run all focused tests**

Run: `cd frontend && npm run test:ai-ui`

Expected: PASS.

**Step 6: Build the frontend**

Run: `cd frontend && npm run build`

Expected: Vite build sukses. Catat peringatan bundle-size baseline bila tetap muncul.

**Step 7: Inspect the final diff and perform self-review**

Run: `git diff --check`

Run: `git diff -- frontend/package.json frontend/src/pages/ai/AICommandCenter.jsx frontend/src/pages/ai/aiCommandCenterModel.js frontend/src/pages/ai/ai-command-center.css frontend/src/components/ai/AIDocumentWorkspace.jsx frontend/src/components/ai/AIConversation.jsx frontend/src/components/ai/AISessionList.jsx frontend/src/components/ai/AIContextPanel.jsx frontend/src/components/ai/AIActionProposals.jsx frontend/test/aiCommandCenterModel.test.js`

Expected: Tidak ada whitespace error, perubahan tetap terbatas pada experience AI Command Center, dan tidak ada data tiruan atau kontrak API baru.
