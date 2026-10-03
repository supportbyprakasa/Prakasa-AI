import './dashboard-section.css';

// One section of a dashboard: the heading every dashboard uses, in the one
// order every dashboard keeps (docs/dashboard-divisi-2026-10-03.md):
//   1 Angka utama · 2 Perlu perhatian · 3 Grafik capaian bulanan ·
//   4 Tren 12 bulan · 5 Komposisi / capaian · 6 Tabel kerja.
// A section whose data is not there yet still renders, with its empty state,
// so the page reads the same on every division.
export default function DashboardSection({ title, subtitle, actions, children, className = '' }) {
  return (
    <section className={`pw-dash-section ${className}`.trim()} aria-label={title}>
      <div className="pw-dash-section__head">
        <div className="pw-dash-section__heading">
          <h2 className="pw-title-section">{title}</h2>
          {subtitle ? <p className="pw-dash-section__subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="pw-dash-section__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
