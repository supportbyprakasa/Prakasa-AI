import { useEffect, useId, useRef, useState } from 'react';
import IconButton from '../IconButton';
import { formatMetric, motionScores, rankScores } from './chartModel';
import { usePrefersReducedMotion, useSeen } from './motion';
import './charts.css';

const ROW = 40;
const STEP_MS = 1100;

// Motion chart: the division's metrics racing through the months. Each bar is
// how a metric did that month — against its target when one is set, else
// against its own best month (100). Bars grow, shrink and change places as
// the months play; the play button replays, the slider (or arrow keys) picks
// a month. It plays by itself once when it comes into view. The month is
// announced only when the user picks it (not on every step while playing).
// months: [{ key, label }]; series: [{ key, label, unit, better, values, targets }].
// `dataLabels`: the series labels are record data (channel or product names),
// never translated by the language switch.
export default function MotionChart({ months, series, title = 'Grafik capaian bulanan', dataLabels = false }) {
  const id = useId();
  const box = useRef(null);
  const seen = useSeen(box);
  const reduced = usePrefersReducedMotion();
  const last = months.length - 1;
  const [index, setIndex] = useState(last);
  const [playing, setPlaying] = useState(false);
  const played = useRef(false);

  // First time on screen: play from the first month (not with reduced motion).
  useEffect(() => {
    if (!seen || played.current || reduced || months.length < 2) return;
    played.current = true;
    setIndex(0);
    setPlaying(true);
  }, [seen, reduced, months.length]);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => {
      setIndex((i) => {
        if (i >= last) { setPlaying(false); return i; }
        return i + 1;
      });
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [playing, last]);

  const toggle = () => {
    if (playing) { setPlaying(false); return; }
    if (index >= last) setIndex(0);
    setPlaying(true);
  };

  const scores = motionScores(series, index);
  const ranked = rankScores(scores);
  const rankOf = new Map(ranked.map((s, i) => [s.key, i]));
  const max = Math.max(100, ...scores.map((s) => s.score ?? 0));

  return (
    <div className="pw-motion" ref={box}>
      <div className="pw-motion__bar">
        <IconButton icon={playing ? 'pause' : (index >= last ? 'replay' : 'play_arrow')} label={playing ? 'Jeda' : 'Putar perjalanan 12 bulan'} variant="filled" onClick={toggle} />
        <div className="pw-motion__month" aria-live={playing ? 'off' : 'polite'}>{months[index]?.label}</div>
        <input
          className="pw-motion__slider"
          type="range"
          min={0}
          max={last}
          step={1}
          value={index}
          aria-label={`${title}: pilih bulan`}
          aria-valuetext={months[index]?.label}
          onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); }}
        />
      </div>
      <div className="pw-motion__race" style={{ height: series.length * ROW }} role="list" aria-label={`${title}, ${months[index]?.label}`}>
        {scores.map((s) => (
          <div key={s.key} className="pw-motion__row" role="listitem" style={{ transform: `translateY(${rankOf.get(s.key) * ROW}px)` }}>
            <span className="pw-motion__label" id={`${id}-${s.key}`} data-no-translate={dataLabels && !s.translate ? '' : undefined}>{s.label}</span>
            <span className="pw-motion__track">
              <span className={`pw-motion__fill${s.basis === 'target' ? ' is-target' : ''}${s.score !== null && s.score >= 100 ? ' is-full' : ''}`} style={{ width: `${s.score === null ? 0 : (s.score / max) * 100}%` }} />
              <span className="pw-motion__mark" style={{ left: `${(100 / max) * 100}%` }} aria-hidden="true" />
            </span>
            <span className="pw-motion__value">
              {s.value === null ? 'Tidak ada data' : (
                <>
                  {formatMetric(s.value, s.unit, { compact: true })}
                  <span className="pw-motion__score">{` · ${s.score}${s.basis === 'target' ? '% target' : ''}`}</span>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
      <p className="pw-motion__legend">Panjang batang = capaian bulan itu: terhadap target bila ada (batang hijau), selain itu terhadap bulan terbaik metrik itu dalam 12 bulan (100). Untuk ukuran "lebih kecil lebih baik" seperti jumlah hari, batang dibalik.</p>
    </div>
  );
}
