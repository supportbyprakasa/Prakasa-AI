import { AlertTriangle, PlayCircle, ShieldCheck, SkipForward, XCircle } from 'lucide-react';
import Badge from './Badge';
import Button from './Button';
import Card from './Card';

const STATUS = {
  passed: { tone: 'success', label: 'Passed', icon: ShieldCheck },
  warning: { tone: 'warning', label: 'Warning', icon: AlertTriangle },
  failed: { tone: 'error', label: 'Failed', icon: XCircle },
  skipped: { tone: 'default', label: 'Skipped', icon: SkipForward },
};

const SEVERITY = {
  low: 'default',
  medium: 'warning',
  high: 'error',
};

export default function SignaturePrecheckPanel({
  precheck,
  onRun,
  running = false,
  canRun = false,
}) {
  const meta = precheck ? (STATUS[precheck.status] || STATUS.skipped) : null;
  const StatusIcon = meta?.icon;

  return (
    <Card
      title="AI Signature Precheck"
      actions={
        onRun && canRun ? (
          <Button variant="secondary" onClick={onRun} disabled={running}>
            <PlayCircle size={14} />
            {running ? 'Memproses…' : 'Run Precheck'}
          </Button>
        ) : null
      }
    >
      <div
        style={{
          fontSize: 12,
          color: 'var(--color-text-muted)',
          marginBottom: 12,
          lineHeight: 1.5,
        }}
      >
        AI precheck bersifat <b>advisory / read-only</b>. Hasil ini bukan keputusan
        approval dan tidak dapat menyetujui atau menolak dokumen.
      </div>

      {!precheck ? (
        <div
          style={{
            padding: 20,
            textAlign: 'center',
            color: 'var(--color-text-muted)',
            fontSize: 13,
            border: '1px dashed var(--color-border)',
            borderRadius: 8,
          }}
        >
          Belum ada precheck untuk dokumen ini.
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 12,
              flexWrap: 'wrap',
            }}
          >
            <Badge tone={meta.tone}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <StatusIcon size={12} />
                {meta.label}
              </span>
            </Badge>

            {precheck.provider && (
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {precheck.provider}
                {precheck.model ? ` · ${precheck.model}` : ''}
              </span>
            )}

            {precheck.durationMs != null && (
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {precheck.durationMs} ms
              </span>
            )}

            {precheck.createdAt && (
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--color-text-muted)',
                  marginLeft: 'auto',
                }}
              >
                {new Date(precheck.createdAt).toLocaleString('id-ID')}
              </span>
            )}
          </div>

          {precheck.summary && (
            <div
              style={{
                fontSize: 13,
                whiteSpace: 'pre-wrap',
                marginBottom: 12,
                background: '#f8fafc',
                padding: 10,
                borderRadius: 8,
                border: '1px solid var(--color-border)',
              }}
            >
              {precheck.summary}
            </div>
          )}

          {Array.isArray(precheck.findings) && precheck.findings.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--color-text-muted)',
                  marginBottom: 6,
                }}
              >
                Temuan ({precheck.findings.length})
              </div>

              {precheck.findings.map((finding, index) => (
                <div
                  key={`${finding.ref || 'finding'}-${index}`}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-start',
                    padding: 8,
                    marginBottom: 4,
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                >
                  <Badge tone={SEVERITY[finding.severity] || 'default'}>
                    {finding.severity || 'info'}
                  </Badge>
                  <div style={{ flex: 1 }}>
                    <div>{finding.message}</div>
                    {finding.ref && (
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--color-text-muted)',
                          marginTop: 2,
                        }}
                      >
                        Referensi: {finding.ref}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
