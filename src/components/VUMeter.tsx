'use client';

// A classic analog VU meter face: curved dB scale, swinging needle. Used by
// any module that wants an analog read-out instead of a plain bar — the
// face/needle colors are props so each module can give it its own finish.

type VUMeterProps = {
  level01: number; // 0..1, already-smoothed signal level
  faceColor?: string;
  needleColor?: string;
  scaleColor?: string;
  width?: number;
};

const TICKS: { db: number; label: string }[] = [
  { db: -50, label: '-50' },
  { db: -30, label: '-30' },
  { db: -20, label: '-20' },
  { db: -10, label: '-10' },
  { db: -5, label: '-5' },
  { db: 0, label: '0' },
  { db: 3, label: '+3' },
];

const MIN_DB = -50;
const MAX_DB = 3;
const MIN_ANGLE = -52;
const MAX_ANGLE = 52;

function dbToAngle(db: number) {
  const clamped = Math.min(MAX_DB, Math.max(MIN_DB, db));
  const t = (clamped - MIN_DB) / (MAX_DB - MIN_DB);
  return MIN_ANGLE + t * (MAX_ANGLE - MIN_ANGLE);
}

// Server and client can round a raw float-to-string pixel value a hair
// differently, which React's hydration check flags even though the visual
// difference is thousandths of a pixel. Rounding here makes both passes
// produce byte-identical output.
function r2(n: number) {
  return Math.round(n * 100) / 100;
}

export default function VUMeter({
  level01,
  faceColor = '#d9a63a',
  needleColor = '#1a1a1a',
  scaleColor = '#2a1a08',
  width = 210,
}: VUMeterProps) {
  const db = level01 <= 0.0006 ? MIN_DB : 20 * Math.log10(level01);
  const angle = dbToAngle(db);
  const height = Math.round(width * 0.58);
  const pivotX = width / 2;
  const pivotY = height * 0.96;
  const radius = height * 0.82;

  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        borderRadius: '6px',
        background: `radial-gradient(circle at 50% 110%, ${faceColor} 0%, ${faceColor} 55%, rgba(0,0,0,0.18) 100%)`,
        border: '2px solid #141414',
        boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.4), 0 3px 10px rgba(0,0,0,0.55)',
        overflow: 'hidden',
      }}
    >
      {TICKS.map((tick) => {
        const a = dbToAngle(tick.db);
        const rad = (a * Math.PI) / 180;
        const x = r2(pivotX + radius * Math.sin(rad));
        const y = r2(pivotY - radius * Math.cos(rad));
        return (
          <div
            key={tick.db}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              transform: 'translate(-50%, -50%)',
              fontSize: r2(Math.max(9, width * 0.045)),
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 700,
              color: tick.db >= 0 ? '#8a1f14' : scaleColor,
            }}
          >
            {tick.label}
          </div>
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: pivotX,
          top: pivotY,
          width: 2,
          height: r2(radius * 0.9),
          background: needleColor,
          transformOrigin: '50% 100%',
          transform: `translate(-50%, -100%) rotate(${r2(angle)}deg)`,
          transition: 'transform 90ms ease-out',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: pivotX,
          top: pivotY,
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: needleColor,
          transform: 'translate(-50%, -50%)',
        }}
      />
    </div>
  );
}
