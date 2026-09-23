# AI File Generation, Upload, Reading, and Download Design

Date: 2026-09-23

Status: Approved in conversation; pending written-spec review

Project: Prakasa AI Work OS

## 1. Summary

Prakasa AI Work OS will let authenticated users attach business files to an AI
conversation, let AI read those files, and ask AI to create downloadable files.
Google Workspace Shared Drive is the canonical file store. The existing GoDaddy
shared-hosting application remains the system of record for users, permissions,
sessions, metadata, and orchestration. Google Cloud Run performs CPU-heavy file
work so uploads and AI jobs do not exhaust shared-hosting CPU, memory, or request
timeouts.

Only a validated compressed version of an uploaded file is retained as the
active attachment. The original is held temporarily in a quarantine folder
while validation and compression run, then moved to Shared Drive Trash after the
compressed result has been verified. Generated files are stored in Shared Drive
and exposed in the AI conversation through authenticated download controls.

## 2. Goals

1. Generate downloadable PDF, DOCX, XLSX, CSV, PPTX, TXT, Markdown, HTML, JSON,
   ZIP, PNG, and JPG files from AI conversations.
2. Upload, persist, and let AI read common office documents, structured text,
   images, audio, video, and safe archives.
3. Keep binary files out of MySQL and avoid buffering large files in the
   shared-hosting Node.js process.
4. Automatically compress uploads and retain only the verified compressed
   result as the active attachment.
5. Show durable, truthful progress for upload, processing, AI generation, and
   output preparation, including after a page reload.
6. Enforce the existing AI session visibility and entity/department permission
   model on every attachment and download.
7. Make format support extensible through reader, compressor, extractor, and
   renderer registries.

## 3. Non-goals

- Running executables, macros, scripts, or other active content from uploads.
- Claiming that every possible binary format can be understood. Unknown formats
  are rejected with a specific error and can be added later through an adapter.
- Public or unauthenticated Shared Drive links.
- Keeping the original upload as an active attachment after successful
  compression.
- Full in-browser editing comparable to Microsoft Office or Google Workspace.
- Semantic vector search in the first release. Initial retrieval uses structured
  extraction, headings, sheet/slide metadata, and keyword ranking.

## 4. Confirmed Product Decisions

- Generated files are downloadable from the AI conversation; they are not
  automatically registered in the existing Documents module.
- Uploaded files are persistent and visible in conversation history.
- AI can read uploaded file contents, including audio transcription and video
  analysis.
- The active stored upload is the compressed version only.
- Google Workspace Shared Drive is the primary storage system.
- Cloud Run is the file-processing runtime; GoDaddy shared hosting remains the
  application runtime.
- Initial per-message attachment count is five.
- Initial limits are 50 MB for documents/images, 100 MB for audio, and 250 MB
  for video, measured before compression.

## 5. Existing-System Context

The repository already contains:

- React/Vite frontend and Node.js/Express backend.
- MySQL-backed AI sessions and messages with entity, department, ownership, and
  visibility controls.
- AI providers for OpenAI, Gemini, Claude, Claude Team, and n8n.
- A Documents module that uploads files to Google Drive.
- A Google service-account integration with Drive, Docs, Sheets, and Slides
  scopes and Shared Drive support.
- A PDF service used for signed-document audit output.
- A current Multer upload path that buffers one file in memory and caps it at
  20 MB.
- Partial AI loading states in the frontend.

The new subsystem must not reuse the memory-buffered upload path for large AI
attachments. Existing uncommitted work in the repository is outside the scope
of this design and must be preserved.

## 6. Architecture

```text
Browser
  | 1. create attachment record / receive resumable session
  | 2. compress locally when safe and upload chunks
  v
Google Shared Drive: quarantine
  | 3. processing job
  v
Cloud Run file processor
  |-- validate signature and scan malware
  |-- compress or normalize
  |-- extract text/tables/OCR/transcript/video frames
  |-- render requested output files
  |-- write final + sidecar files to Shared Drive
  |-- send signed, idempotent callback
  v
GoDaddy Node.js API + MySQL
  |-- permissions and job state
  |-- attachment/output metadata
  |-- relevant-content selection for AI
  v
Configured AI provider
  |-- answer in chat or return a validated artifact specification
  v
Cloud Run renderer -> Shared Drive -> authenticated download
```

### 6.1 Frontend

The AI conversation gains a drag-and-drop zone, attachment button, attachment
cards, per-file progress, retry/cancel controls, and generated-file cards. The
frontend uploads chunks directly to the Google resumable session returned by
the backend. It never receives a Google service-account credential.

### 6.2 Backend orchestrator

The Express backend:

- authorizes attachment and download actions;
- creates upload, processing, and generation records;
- initiates Google Drive resumable upload sessions;
- starts Cloud Run jobs;
- receives authenticated, idempotent processor callbacks;
- selects relevant extracted chunks for the AI prompt;
- persists all user-visible states; and
- issues short-lived download grants.

It does not read an entire large upload into memory and does not run FFmpeg,
LibreOffice, OCR, or antivirus scanning in the web process.

### 6.3 Shared Drive

Shared Drive is the canonical binary and extraction store. The application
service account must be at least Content Manager on the selected drive. A
single configurable root folder is used:

```text
Prakasa AI Work OS/
  Entity-{entityId}/
    AI-Sessions/
      Session-{sessionId}/
        quarantine/
        attachments/
        extracted-content/
        generated-files/
```

Folder IDs, not folder names, are persisted after creation. File ownership
belongs to the Workspace organization. Application users are not required to
be direct members of the Shared Drive.

### 6.4 Cloud Run processor

A private Cloud Run Job performs bounded processing tasks. Its container
includes the required tools, such as ClamAV, LibreOffice headless, FFmpeg,
Tesseract, PDF optimization tooling, and format-specific libraries. Each job
receives an opaque job ID and the minimum file metadata required to fetch the
source from Shared Drive.

The processor writes progress callbacks at durable stage boundaries and a
terminal success or failure callback. Callbacks are signed, timestamped, and
idempotent. The processor cannot change application permissions or AI session
ownership.

### 6.5 AI provider and artifact renderer

Extracted attachment content is wrapped as untrusted context. The selected AI
provider returns either a normal text answer or a schema-validated artifact
specification. AI output is never treated as executable code.

Artifact renderers convert specifications into deterministic formats:

- DOCX document renderer;
- XLSX/CSV workbook renderer with formula-injection protection;
- PPTX presentation renderer;
- HTML-to-PDF renderer;
- TXT/Markdown/HTML/JSON serializer;
- PNG/JPG chart and visual renderer; and
- ZIP packager for multi-file output.

Renderers run in Cloud Run, write the result to `generated-files/`, then report
the final Drive file ID, MIME type, checksum, and size to the backend.

### 6.6 Authenticated download gateway

The backend validates the current application user against the session and
file record, then issues a short-lived, single-purpose download grant. A small
Cloud Run download service validates that signed grant and streams the file
from Shared Drive with range support. This prevents public Drive links and
avoids tying up a shared-hosting Node.js process during a large download.

## 7. Data Model

### 7.1 `ai_attachments`

Stores one row per user attachment:

- `id`, `session_id`, `entity_id`, `department_id`, `uploaded_by`
- `original_name`, `display_name`, `detected_mime`, `detected_extension`
- `source_size`, `compressed_size`, `checksum_sha256`
- `quarantine_drive_file_id`, `final_drive_file_id`
- `extraction_drive_file_id`, `thumbnail_drive_file_id`
- `status`, `stage`, `progress_percent`, `error_code`, `error_message`
- `created_at`, `updated_at`, `ready_at`, `deleted_at`

The quarantine file ID is cleared after the source is moved to Trash.

### 7.2 `ai_file_jobs`

Stores durable processing state:

- `id`, `attachment_id`, `session_id`, `job_type`
- `status`, `stage`, `attempt`, `max_attempts`
- `idempotency_key`, `processor_execution_id`
- `progress_current`, `progress_total`, `heartbeat_at`
- `started_at`, `finished_at`, `next_retry_at`
- `error_code`, `error_message`, `metadata_json`

Allowed job types include `compress_extract`, `transcribe`, `analyze_video`,
`generate_artifact`, `package_outputs`, and `cleanup`.

### 7.3 `ai_attachment_chunks`

Stores searchable metadata and bounded text chunks, not binary content:

- `id`, `attachment_id`, `chunk_index`, `content_type`
- `heading`, `page_no`, `sheet_name`, `slide_no`, `start_ms`, `end_ms`
- `content`, `char_count`, `metadata_json`

Long raw extraction output remains in Shared Drive. MySQL stores only chunks
needed for permission-aware retrieval and AI context construction.

### 7.4 `ai_generated_files`

Stores downloadable AI output metadata:

- `id`, `session_id`, `source_message_id`, `created_by`
- `title`, `file_name`, `format`, `mime_type`, `size`
- `drive_file_id`, `checksum_sha256`
- `status`, `error_code`, `error_message`
- `created_at`, `ready_at`, `deleted_at`

Foreign keys and indexes cover session, owner, status, and cleanup queries.
Deletion is soft in MySQL until the corresponding Drive operation succeeds.

## 8. State Machines

### 8.1 Attachment state

```text
created -> uploading -> uploaded -> queued -> scanning -> compressing
        -> extracting -> ready

Any active state -> failed -> queued (retry)
Any non-terminal state -> cancelled
ready/failed/cancelled -> deleting -> deleted
```

Upload progress can show an exact percentage. Processing stages show exact
progress only when the underlying tool reports measurable work. Otherwise the
UI shows the active stage and elapsed time, not a fabricated percentage.

### 8.2 Session generation state

The existing `idle` and `generating` states are extended with
`waiting_for_attachments` and `generating_file`. A message referencing an
attachment is persisted immediately, then waits until all referenced files are
`ready`. The backend transitions automatically into AI generation without
requiring the user to resend the prompt.

The composer is locked while the session is in any non-idle generation state
to preserve ordering and prevent concurrent answers in the same session.

### 8.3 Generated-file state

```text
proposed -> queued -> rendering -> uploading -> ready
                         |                    |
                         +------ failed <-----+
```

## 9. Upload and Processing Flow

1. The browser sends file metadata to an attachment-init endpoint.
2. The backend validates session access, attachment count, declared type, and
   size, then creates a `created` attachment row.
3. The backend creates a quarantine Drive file target and resumable session.
4. The browser uploads in chunks and reports completion to the backend.
5. The backend verifies Drive metadata and queues a processing job.
6. Cloud Run downloads the source as a stream, verifies file signature,
   performs malware and archive-safety checks, and applies the format profile.
7. The processor verifies the compressed file can be opened and parsed.
8. The compressed file is written to `attachments/`; extraction sidecars and
   thumbnails are written to their respective folders.
9. The backend persists chunks and marks the attachment `ready`.
10. The quarantine source is moved to Shared Drive Trash and its active file ID
    is cleared from the attachment record.
11. If a message is waiting for this attachment, AI generation resumes.

If processing fails before a verified compressed result exists, the quarantined
original is retained for no more than 24 hours to permit retry without another
upload. It is not exposed as an active attachment and is then moved to Trash.

## 10. Format Capability Registry

Every supported type declares:

- accepted extensions and MIME values;
- file-signature detector;
- maximum input size;
- malware and active-content policy;
- compressor/normalizer;
- integrity verifier;
- content extractor;
- preview generator; and
- supported AI capabilities.

### 10.1 Read support

| Category | Initial formats | Extraction behavior |
|---|---|---|
| Documents | PDF, DOC, DOCX, RTF, ODT | Text, headings, pages, tables, OCR fallback |
| Spreadsheets | XLS, XLSX, CSV, ODS | Sheet names, cell values, formulas as inert text, tables |
| Presentations | PPT, PPTX, ODP | Slide text, notes, layout metadata, image OCR |
| Structured/text | TXT, MD, HTML, JSON, XML | Sanitized text and structure |
| Images | PNG, JPG/JPEG, WebP, HEIC, TIFF | OCR plus vision description when requested |
| Audio | MP3, WAV, M4A, AAC, OGG | Timestamped transcription and metadata |
| Video | MP4, MOV, WebM, MKV | Audio transcript plus selected scene frames |
| Archives | ZIP | Safe recursive extraction of supported children |

Password-protected or encrypted files fail with `FILE_ENCRYPTED`. The user is
asked to upload an unprotected copy; passwords are not stored by the system.

### 10.2 Output support

The first release generates PDF, DOCX, XLSX, CSV, PPTX, TXT, Markdown, HTML,
JSON, ZIP, PNG, and JPG. The registry allows additional renderers without
changing conversation or storage APIs.

## 11. Compression Profiles

Compression prioritizes readability and business-document integrity over the
smallest possible byte size.

- Office documents: remove unsafe active content, normalize embedded media,
  recompress oversized images, and save into a modern open format when legacy
  input requires conversion.
- PDF: remove redundant objects, subset fonts where safe, compress images, and
  verify page count and extractability after optimization.
- Images: correct orientation, remove nonessential metadata, cap excessive
  dimensions, and encode as WebP/JPEG with a quality floor suitable for OCR.
- Audio: normalize speech media and encode an efficient listening/transcription
  copy; preserve enough quality for accurate transcription.
- Video: encode H.264/AAC with fast-start metadata, cap frame rate, and normally
  target 720p. Screen recordings with small text can retain 1080p when the
  processor detects that reducing resolution would harm readability.
- Text/JSON/XML/CSV: normalize encoding and line endings; do not apply lossy
  transformations.
- ZIP: extract and process supported children, then create a new safe archive
  without paths, links, executables, or unsupported nested archives.

The processor records source and compressed size so the UI can show the
reduction. A result that fails integrity checks never replaces the source.

## 12. AI Reading and Context Selection

Extraction sidecars preserve page, sheet, slide, and timestamp references. The
backend ranks chunks using filenames, headings, structured location metadata,
and keyword relevance to the latest user message. Only permission-authorized,
relevant chunks within the provider context budget are sent to AI.

Each attachment is wrapped with explicit boundaries and a warning that its
contents are untrusted data. Instructions embedded in files cannot override
the application system prompt, permission checks, or action-confirmation rules.

For comparisons, the context builder guarantees representation from every
explicitly referenced attachment before filling remaining budget with the
highest-ranked chunks.

## 13. User Experience

### 13.1 Attachment composer

- Paperclip button and drag-and-drop target.
- Up to five files per message.
- Preflight display of name, type, size, and limit violations.
- Per-file upload percentage and cancel control.
- Send is allowed after selection; the persisted message waits for attachment
  readiness when necessary.

### 13.2 Durable status display

User-facing stages are:

```text
Mengompres -> Mengunggah -> Memeriksa keamanan -> Membaca isi
-> AI memproses -> Membuat file -> Siap diunduh
```

The displayed stage comes from persisted job state. Reopening or refreshing a
conversation reconstructs status from the backend. Active stages use a spinner;
terminal states stop animating. Upload progress uses actual transferred bytes.

### 13.3 Error and recovery

Each failed attachment shows a stable error category and a retry action. Failure
of one attachment does not discard successful siblings. Retry reuses an existing
safe source or compressed file when available. Users only re-upload when no safe
source remains.

### 13.4 Generated output

An AI response can contain one or more output cards showing filename, format,
size, creation time, and a primary `Unduh` action. Multi-file requests can also
offer a generated ZIP. A file remains available while the session remains
available and the user retains access.

## 14. API Surface

Proposed authenticated endpoints:

- `POST /ai-command/sessions/:id/attachments/init`
- `POST /ai-command/sessions/:id/attachments/:attachmentId/complete`
- `GET /ai-command/sessions/:id/attachments`
- `GET /ai-command/sessions/:id/attachments/:attachmentId`
- `POST /ai-command/sessions/:id/attachments/:attachmentId/retry`
- `POST /ai-command/sessions/:id/attachments/:attachmentId/cancel`
- `DELETE /ai-command/sessions/:id/attachments/:attachmentId`
- `POST /ai-command/sessions/:id/messages` with attachment IDs
- `GET /ai-command/sessions/:id/jobs`
- `POST /ai-command/internal/file-jobs/:id/progress`
- `POST /ai-command/internal/file-jobs/:id/complete`
- `GET /ai-command/generated-files/:id/download-grant`

Internal callback routes are not authenticated with end-user JWTs. They require
a rotated processor secret, timestamp, request-body signature, and idempotency
key. The backend rejects replays outside a narrow time window.

Polling is the initial status transport because it works reliably on cPanel and
across proxies. The frontend polls only while work is active, uses backoff, and
stops on terminal state. Server-sent events can be added later without changing
the persisted job model.

## 15. Permissions and Security

- Every operation resolves the attachment through its AI session and applies
  the existing session view/manage/send permissions.
- Entity and department IDs come from the authenticated session context, not
  untrusted upload fields.
- Shared Drive credentials never reach the browser or AI provider.
- Resumable session URLs and download grants are treated as secrets and are not
  logged.
- Extension, declared MIME, detected MIME, and magic bytes must agree with an
  allowed registry entry.
- Files are scanned before extraction or AI use.
- Archive entry count, expanded bytes, compression ratio, nesting depth, path
  traversal, symlinks, and unsupported children are bounded.
- Macros, embedded scripts, external workbook links, formula execution, and
  active HTML are disabled. CSV/XLSX output escapes formula-injection prefixes.
- Filenames are normalized, length-bounded, and separated from Drive IDs.
- SHA-256 checksums are stored for integrity and deduplication diagnostics.
- Logs contain metadata and status, not extracted document content.
- Processor callbacks are signed and idempotent.
- Cloud Run services are private except for the grant-protected download path.
- Secrets are stored in environment/secret stores and are rotatable.

## 16. Error Taxonomy and Retry Policy

Stable error codes include:

- `FILE_TYPE_UNSUPPORTED`
- `FILE_TOO_LARGE`
- `FILE_SIGNATURE_MISMATCH`
- `FILE_ENCRYPTED`
- `FILE_CORRUPT`
- `FILE_MALWARE_DETECTED`
- `ARCHIVE_UNSAFE`
- `COMPRESSION_FAILED`
- `EXTRACTION_FAILED`
- `TRANSCRIPTION_FAILED`
- `VIDEO_ANALYSIS_FAILED`
- `DRIVE_UPLOAD_FAILED`
- `DRIVE_DOWNLOAD_FAILED`
- `PROCESSOR_TIMEOUT`
- `AI_PROVIDER_ERROR`
- `ARTIFACT_SPEC_INVALID`
- `ARTIFACT_RENDER_FAILED`
- `DOWNLOAD_GRANT_INVALID`

Transient Drive, Cloud Run, and provider errors retry up to three times with
exponential backoff and jitter. Validation, malware, encrypted-file, and
permission errors do not retry automatically. All job starts and callbacks use
idempotency keys to prevent duplicate files or assistant messages.

## 17. Retention and Deletion

- Ready compressed attachments and generated files live as long as their
  conversation unless an authorized user deletes them earlier.
- Deleting an attachment or session first marks database records as deleting,
  then moves associated Drive files to Trash.
- Shared Drive Trash provides a 30-day recovery window under Google Workspace
  behavior.
- Database tombstones remain through the recovery window, then a scheduled
  cleanup removes chunks and non-audit metadata.
- Quarantine sources are trashed immediately after verified compression or
  within 24 hours after terminal failure/cancellation.
- Audit records retain file IDs, checksum, actor, action, and timestamps without
  retaining extracted sensitive content.

## 18. Observability and Administration

An administrator view reports:

- active, queued, failed, and stale jobs;
- per-stage duration and failure counts;
- source versus compressed bytes;
- Shared Drive file/item growth;
- processing attempts and terminal errors; and
- AI file-generation usage by provider, entity, and department.

Alerts are required for callback authentication failures, repeated processor
failures, stale jobs, Drive quota errors, and cleanup failures. The system
should warn well before a Shared Drive approaches its item-count limit.

## 19. Testing Strategy

### 19.1 Unit tests

- registry detection and allowlist behavior;
- size and attachment-count limits;
- state transitions and stale-job recovery;
- permission filters and download grants;
- callback signature, replay protection, and idempotency;
- chunk ranking and multi-file representation;
- artifact schema validation and CSV/XLSX injection protection; and
- deletion and retry rules.

### 19.2 Integration tests

- resumable Shared Drive upload and interrupted-upload resume;
- Shared Drive folder creation and metadata persistence;
- Cloud Run invocation, progress callback, retry, and terminal callback;
- processor adapters for each supported category;
- AI response using extracted content; and
- generated artifact storage and authenticated download.

External services use dedicated test folders and fixtures. Destructive cleanup
targets only IDs created by that test run.

### 19.3 End-to-end tests

- upload five mixed files, refresh mid-process, and observe restored status;
- ask a question that requires document, spreadsheet, image, and transcript
  content;
- create each initial output format and download it;
- verify a user outside the session scope cannot list or download files;
- retry a transient failure without duplicate output;
- process corrupt, encrypted, malicious, oversized, and archive-bomb fixtures;
- delete a session and verify files move to Trash; and
- confirm backend memory stays bounded during large upload/download flows.

### 19.4 Visual and accessibility checks

- loading states are distinguishable without color alone;
- progress and errors have accessible names/live announcements;
- keyboard-only attachment, cancel, retry, and download flows work;
- long filenames and multiple cards remain usable on mobile; and
- reduced-motion preferences disable nonessential animation.

## 20. Delivery Sequence

Implementation is one coherent subsystem delivered in milestones:

1. Data model, format registry, Shared Drive folder service, and durable jobs.
2. Resumable attachment upload with document/text/image processing.
3. AI context integration and persistent conversation loading states.
4. Artifact specification and PDF/DOCX/XLSX/CSV/PPTX/text renderers.
5. Audio transcription and video analysis/compression.
6. Secure download gateway, deletion/retention, and admin observability.
7. Full security, load, accessibility, and end-to-end verification.

Each milestone must preserve existing AI text-chat behavior and can be enabled
behind feature flags until its acceptance tests pass.

## 21. Acceptance Criteria

The feature is complete when:

1. An authorized user can attach up to five supported files within the approved
   size limits without the Node.js backend buffering the entire payload.
2. The active stored attachment is a verified compressed file in the configured
   Shared Drive; the source is no longer active after successful processing.
3. AI answers accurately from extracted text, tables, OCR, audio transcripts,
   and selected video content while treating file content as untrusted.
4. AI can create every initial output format and show a working authenticated
   download card in the originating conversation.
5. Upload percentage and all subsequent processing stages survive refresh and
   never present fabricated progress.
6. Retry, cancellation, partial failure, timeout, and provider failure have
   clear user-visible outcomes without duplicate messages or files.
7. Users outside the session's visibility scope cannot list, inspect, or
   download its files, even when they know a Drive ID or application file ID.
8. Session or attachment deletion moves related files to Shared Drive Trash and
   scheduled cleanup removes expired metadata safely.
9. Security fixtures for malware, ZIP bombs, path traversal, macro/script
   content, and formula injection are rejected or neutralized as designed.
10. Large-file upload, processing, and download tests keep shared-hosting memory
    bounded and do not block normal AI or application requests.

## 22. External Configuration Required

- `GOOGLE_SHARED_DRIVE_ID` and a persistent application root folder ID.
- A service account with the minimum required Shared Drive role.
- Google Cloud project with Cloud Run, Artifact Registry, and required APIs
  enabled.
- Private processor job/service identity with Drive access.
- Rotatable callback-signing and download-grant secrets.
- Cloud Run region selected with latency, data policy, and cost in mind.
- Feature flags and per-category size limits configurable through environment or
  administrator settings.

Google Workspace storage and Google Cloud processing are separate services.
Workspace provides the Shared Drive capacity; Cloud Run provides pay-per-use
compute for compression, extraction, OCR, transcription, rendering, and secure
streaming.

## 23. References

- Google Drive resumable uploads:
  https://developers.google.com/workspace/drive/api/guides/manage-uploads
- Google Drive Shared Drive support:
  https://developers.google.com/workspace/drive/api/guides/enable-shareddrives
- Google Shared Drive overview and limits:
  https://developers.google.com/workspace/drive/api/guides/about-shareddrives
- Cloud Run Jobs:
  https://docs.cloud.google.com/run/docs/execute/jobs
- Cloud Run pricing:
  https://cloud.google.com/run/pricing
- GoDaddy resource limits:
  https://www.godaddy.com/en-au/help/resource-limits-12001
