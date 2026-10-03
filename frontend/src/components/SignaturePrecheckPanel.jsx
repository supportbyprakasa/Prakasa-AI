import Badge from './Badge';
import Button from './Button';
import Card from './Card';
import EmptyState from './EmptyState';
import Icon from './Icon';
import PriorityBadge from './PriorityBadge';
import { formatDateTime } from './format';
import { statusTone } from './statusTone';
import { aiProviderLabel } from '../pages/admin/aiLabels';
import './primitives.css';

// Tones come from statusTone() / priorityTone() only (docs/ui-guideline.md
// §4.12): passed success, warning warning, failed error, skipped default; a
// finding's severity is shown like a priority (high = warning).
// Icons are Material Symbols names (docs/ui-guideline.md §1.11).
const STATUS = {
  passed: { label: 'Lolos', icon: 'verified_user' },
  warning: { label: 'Peringatan', icon: 'warning' },
  failed: { label: 'Gagal', icon: 'cancel' },
  skipped: { label: 'Dilewati', icon: 'skip_next' },
};

export default function SignaturePrecheckPanel({
  precheck,
  onRun,
  running = false,
  canRun = false,
}) {
  const statusKey = precheck && STATUS[precheck.status] ? precheck.status : 'skipped';
  const meta = precheck ? STATUS[statusKey] : null;

  return (
    <Card
      title="Cek awal tanda tangan (AI)"
      actions={
        onRun && canRun ? (
          <Button variant="secondary" icon="play_circle" onClick={onRun} loading={running}>
            Jalankan precheck
          </Button>
        ) : null
      }
    >
      <div className="pw-precheck">
        <div className="pw-precheck__note">
          AI precheck bersifat <b>advisory / read-only</b>. Hasil ini bukan keputusan
          approval dan tidak dapat menyetujui atau menolak dokumen.
        </div>

        {!precheck ? (
          <EmptyState compact icon="verified_user" title="Belum ada precheck untuk dokumen ini." />
        ) : (
          <>
            <div className="pw-precheck__meta">
              <Badge tone={statusTone(statusKey)}>
                <Icon name={meta.icon} size="sm" />
                {meta.label}
              </Badge>

              {precheck.provider && (
                <span className="pw-precheck__meta-text">
                  {aiProviderLabel(precheck.provider)}
                  {precheck.model ? <>{' · '}<span data-no-translate="">{precheck.model}</span></> : null}
                </span>
              )}

              {precheck.durationMs != null && (
                <span className="pw-precheck__meta-text">
                  {precheck.durationMs} ms
                </span>
              )}

              {precheck.createdAt && (
                <span className="pw-precheck__meta-text pw-precheck__meta-text--end">
                  {formatDateTime(precheck.createdAt)}
                </span>
              )}
            </div>

            {precheck.summary && (
              <div className="pw-precheck__summary" data-no-translate="">
                {precheck.summary}
              </div>
            )}

            {Array.isArray(precheck.findings) && precheck.findings.length > 0 && (
              <div className="pw-precheck__findings">
                <div className="pw-precheck__heading">
                  Temuan ({precheck.findings.length})
                </div>

                {precheck.findings.map((finding, index) => {
                  return (
                    <div
                      key={`${finding.ref || 'finding'}-${index}`}
                      className="pw-precheck__finding"
                    >
                      <PriorityBadge priority={finding.severity || 'low'} label={finding.severity ? undefined : 'Info'} />
                      <div className="pw-precheck__finding-body">
                        {/* Written by the AI about the document: never translated. */}
                        <div data-no-translate="">{finding.message}</div>
                        {finding.ref && (
                          <div className="pw-precheck__ref">
                            Referensi: <span data-no-translate="">{finding.ref}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
