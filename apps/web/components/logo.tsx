const LINES = [6.5, 12, 17.5];

function Strand({
  d,
  color,
  gap,
  opacity = 1,
  cap = 'round',
}: {
  d: string;
  color: string;
  gap: string;
  opacity?: number;
  cap?: 'round' | 'butt';
}) {
  return (
    <>
      <path d={d} stroke={gap} strokeWidth="5.4" strokeLinecap={cap} />
      <path d={d} stroke={color} strokeOpacity={opacity} strokeWidth="2.6" strokeLinecap={cap} />
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
  const warp = (x: number) => `M${x} 3.5V20.5`;
  const weft = (y: number) => `M3.5 ${y}H20.5`;
  const over = (x: number, y: number) => `M${x - 2.7} ${y}H${x + 2.7}`;
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      {LINES.map((y) => (
        <Strand key={`w${y}`} d={weft(y)} color="var(--accent)" gap={gap} />
      ))}
      {LINES.map((x) => (
        <Strand key={`v${x}`} d={warp(x)} color="var(--fg)" gap={gap} opacity={0.9} />
      ))}
      {LINES.flatMap((x, i) =>
        LINES.filter((_, j) => (i + j) % 2 === 0).map((y) => (
          <Strand key={`o${x}-${y}`} d={over(x, y)} color="var(--accent)" gap={gap} cap="butt" />
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
