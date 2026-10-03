import './drive.css';

// A titled group of FileCards ("Folder", "Dokumen", …) laid out as Drive's
// grid: as many 240px-plus columns as fit, 16px apart.
export default function FileGrid({ title, children }) {
  return (
    <section className="drive-group" aria-label={title}>
      {title ? <h2 className="pw-title-section">{title}</h2> : null}
      <div className="drive-grid">{children}</div>
    </section>
  );
}
