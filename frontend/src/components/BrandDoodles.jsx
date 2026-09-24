// Small floating brand doodles used as ambient decoration on welcoming screens
// (login, AI landing). Purely decorative: hidden from assistive tech, ignores
// pointer events, kept small/semi-transparent, and respects
// prefers-reduced-motion via CSS. The host element must be
// `position: relative` (and ideally `overflow: hidden`) for the doodles to
// stay within its bounds.
export default function BrandDoodles({ className = '' }) {
  return (
    <div className={`pw-doodles ${className}`.trim()} aria-hidden="true">
      <img className="pw-doodle pw-doodle--a" src="/doodles/sparkle.png" alt="" draggable="false" />
      <img className="pw-doodle pw-doodle--b" src="/doodles/leaf.png" alt="" draggable="false" />
      <img className="pw-doodle pw-doodle--c" src="/doodles/wave.png" alt="" draggable="false" />
      <img className="pw-doodle pw-doodle--d" src="/doodles/sparkle.png" alt="" draggable="false" />
    </div>
  );
}
