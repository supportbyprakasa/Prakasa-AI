// "Prakasa Workspace" in the bar: "Workspace" in the Google logo colours, in
// Google's own order (blue, red, yellow, blue, green, red), repeating.
const COLOURS = ['blue', 'red', 'yellow', 'blue', 'green', 'red'];

export default function BrandWordmark({ restClassName = '' }) {
  return (
    <>
      Prakasa
      <span className={restClassName} data-no-translate="">
        {' '}
        {'Workspace'.split('').map((letter, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <span key={i} className={`pw-brand-letter pw-brand-letter--${COLOURS[i % COLOURS.length]}`}>{letter}</span>
        ))}
      </span>
    </>
  );
}
