const LINES = [6.5, 12, 17.5];
const WIDTH = 3.2;
const GAP = 4.8;
const OVER = 3.9;
const START = 3;
const END = 21;

function Strand({ d, color, gap }: { d: string; color: string; gap: string }) {
  return (
    <>
      <path d={d} stroke={gap} strokeWidth={GAP} strokeLinecap="round" />
      <path d={d} stroke={color} strokeWidth={WIDTH} strokeLinecap="round" />
    </>
  );
}

export function LogoMark({
  className = 'size-6',
  gap = 'var(--bg)',
}: {
  className?: string;
  gap?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      {LINES.map((y) => (
        <Strand key={`w${y}`} d={`M${START} ${y}H${END}`} color="var(--accent)" gap={gap} />
      ))}
      {LINES.map((x) => (
        <Strand key={`v${x}`} d={`M${x} ${START}V${END}`} color="var(--fg)" gap={gap} />
      ))}
      {LINES.flatMap((x, i) =>
        LINES.filter((_, j) => (i + j) % 2 === 0).map((y) => (
          <g key={`o${x}-${y}`}>
            <path d={`M${x - GAP / 2} ${y}H${x + GAP / 2}`} stroke={gap} strokeWidth={GAP} />
            <path
              d={`M${Math.max(START, x - OVER)} ${y}H${Math.min(END, x + OVER)}`}
              stroke="var(--accent)"
              strokeWidth={WIDTH}
            />
          </g>
        )),
      )}
    </svg>
  );
}

export function Logo({ gap }: { gap?: string }) {
  return (
    <span className="flex items-center gap-2">
      <LogoMark {...(gap ? { gap } : {})} />
      <span className="text-[16px] font-semibold tracking-[-0.04em]">weft</span>
    </span>
  );
}
