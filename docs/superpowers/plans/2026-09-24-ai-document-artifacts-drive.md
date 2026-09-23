# AI Document Artifacts and Shared Drive Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Memungkinkan AI Command Center menerima dan membaca berbagai format file, menghasilkan PDF/DOCX/XLSX yang dapat diunduh, mengoptimalkan ukuran penyimpanan, dan menyimpan file permanen pada Google Workspace Shared Drive.

**Architecture:** Tambahkan service pemrosesan file murni untuk ekstraksi, kompresi, dan pembuatan artifact. File hanya berada di memory selama request lalu dikirim ke Shared Drive; database menyimpan metadata dan cache teks AI yang dibatasi. Endpoint AI memverifikasi akses session sebelum upload, generate, atau download. UI percakapan menyediakan attachment dan export per jawaban assistant, sedangkan panel dokumen menggunakan context yang sudah ada.

**Tech Stack:** Node.js CommonJS, Express, MySQL, Google Drive API, pdf-lib, docx, JSZip, pdf-parse, React 18, Axios, Node test runner.

## Global constraints

- Kerjakan pada checkout aktif dan jangan commit karena terdapat perubahan pengguna yang bertumpang tindih.
- Jangan menyimpan file permanen pada filesystem shared hosting.
- Google Shared Drive atau folder mapping yang valid wajib menjadi tujuan file AI.
- Maksimum upload configurable dan default konservatif untuk memory shared hosting.
- Jangan mengklaim OCR untuk gambar atau pembacaan format legacy bila extractor tidak mendukungnya.
- Teks hasil ekstraksi harus dibatasi untuk mencegah prompt/database membengkak.
- Seluruh endpoint harus memverifikasi akses session, entity, department, dan permission dokumen.

## Task 1: Build and test format processing primitives

**Files:**
- Create: `backend/test/aiDocumentArtifact.test.js`
- Create: `backend/src/services/aiDocumentArtifact.service.js`
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`

1. Tulis test gagal untuk sanitasi nama file, klasifikasi format, gzip hanya bila lebih kecil, ekstraksi plain text, dan generasi PDF/DOCX/XLSX valid.
2. Pasang dependency pure-JavaScript `docx`, `jszip`, dan `pdf-parse`; buat XLSX OOXML langsung melalui JSZip agar ringan dan bebas advisory ExcelJS.
3. Implementasikan generator format dan extractor dengan batas ukuran/karakter.
4. Jalankan `node --test test/aiDocumentArtifact.test.js` sampai lulus.

## Task 2: Persist artifacts in Shared Drive and expose secure APIs

**Files:**
- Create: `backend/migrations/030_ai_document_artifacts.sql`
- Create: `backend/src/services/aiDocumentStorage.service.js`
- Modify: `backend/src/services/googleDrive.service.js`
- Modify: `backend/src/middleware/upload.js`
- Modify: `backend/src/routes/aiCommand.routes.js`
- Modify: `backend/src/controllers/aiCommand.controller.js`

1. Tambahkan tabel metadata pemrosesan AI per document tanpa menyimpan binary di database.
2. Tambahkan resolver folder Shared Drive: mapping konfigurasi lebih dahulu, lalu folder `Prakasa AI/Entity/Department` pada `GOOGLE_SHARED_DRIVE_ID`.
3. Tambahkan API upload session, generate artifact dari assistant message, dan download terverifikasi.
4. Simpan `documents`, version, Drive metadata, cache teks, context link, usage event, serta activity log secara konsisten.
5. Tambahkan rollback best-effort untuk file Drive bila penyimpanan database gagal.

## Task 3: Make uploaded documents readable by AI context

**Files:**
- Modify: `backend/src/services/aiContext.service.js`
- Modify: `backend/.env.example`

1. Resolver document membaca cache teks hasil ekstraksi terlebih dahulu.
2. Pertahankan Google Docs API sebagai fallback untuk native Google Docs.
3. Berikan metadata jujur untuk file tanpa teks/OCR.
4. Dokumentasikan batas upload, folder Shared Drive, dan batas cache teks.

## Task 4: Add upload, export, loading, and download UI

**Files:**
- Modify: `frontend/src/components/ai/AIConversation.jsx`
- Modify: `frontend/src/components/ai/AIDocumentWorkspace.jsx`
- Modify: `frontend/src/pages/ai/ai-command-center.css`

1. Tambahkan attachment picker multi-format pada composer dengan status upload.
2. Tambahkan menu export PDF/DOCX/XLSX untuk pesan assistant.
3. Download hasil segera setelah artifact selesai dibuat dan refresh panel dokumen.
4. Tampilkan status upload/generate tanpa persentase palsu dan error melalui toast.
5. Pastikan kontrol keyboard-accessible dan responsive.

## Task 5: Verification

1. Jalankan test artifact backend dan test UI.
2. Jalankan `node --check` pada seluruh file backend yang diubah.
3. Jalankan build frontend produksi.
4. Jalankan `git diff --check`.
5. Self-review akses lintas entity, batas memory, zip bomb, filename injection, dan kegagalan Google Drive.
