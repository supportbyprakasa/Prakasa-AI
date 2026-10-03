import { lazy, Suspense } from 'react';
import PageHeader from '../../components/PageHeader';

// Development-only gallery of every shared component in every state, used to
// measure the build against docs/ui-guideline.md with getComputedStyle and to
// take before/after screenshots. The route exists only in `vite` dev mode
// (App.jsx), never in a production build. Each design work package owns one
// section file in ./gallery.
const SECTIONS = [
  ['Kontrol', lazy(() => import('./gallery/ControlsGallery'))],
  ['Overlay dan tampilan', lazy(() => import('./gallery/DisplayGallery'))],
  ['Tabel', lazy(() => import('./gallery/GridGallery'))],
];

export default function DesignGallery() {
  return (
    <div className="pw-stack">
      <PageHeader title="Galeri komponen" description="Semua komponen bersama dalam setiap keadaan (khusus pengembangan)." />
      {SECTIONS.map(([title, Section]) => (
        <section key={title} className="pw-stack" data-gallery={title}>
          <h2 className="pw-title-section">{title}</h2>
          <Suspense fallback={null}><Section /></Suspense>
        </section>
      ))}
    </div>
  );
}
