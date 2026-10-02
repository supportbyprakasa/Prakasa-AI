import StatCard from '../../../components/StatCard';

// One step of a flow: how many got there (and their share), and how long the
// step before it took — a StatCard whose note carries the share, the
// explanation and the step time.
export default function StepCard({ title, count, share, sub, gapLabel, gap }) {
  const note = share || sub || gapLabel ? (
    <span className="mflow-note">
      {share ? <span>{share}</span> : null}
      {sub ? <span>{sub}</span> : null}
      {gapLabel ? <span className="mflow-gap"><span className="mflow-gap__label">{gapLabel}</span> {gap}</span> : null}
    </span>
  ) : null;
  return <StatCard label={title} value={count} note={note} />;
}
