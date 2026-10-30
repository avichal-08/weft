import { ImageResponse } from 'next/og';

export const alt =
  'weft: describe the change, review the pull request. A coding agent that searches the code, edits it, passes the tests in a clean sandbox and opens a pull request.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const BG = '#0b0b0c';
const SURFACE = '#141416';
const ACCENT = '#f0814a';
const FG = '#ececee';
const MUTED = '#9c9ca5';
const OK = '#4ade80';

const dataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

function mark() {
  const lines = [6.5, 12, 17.5];
  const [width, gap, over, start, end] = [3.2, 4.8, 3.9, 3, 21];
  const strand = (d: string, color: string) =>
    `<path d="${d}" stroke="${BG}" stroke-width="${gap}" stroke-linecap="round"/>` +
    `<path d="${d}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
  let paths = lines.map((y) => strand(`M${start} ${y}H${end}`, ACCENT)).join('');
  paths += lines.map((x) => strand(`M${x} ${start}V${end}`, FG)).join('');
  lines.forEach((x, i) =>
    lines.forEach((y, j) => {
      if ((i + j) % 2) return;
      paths += `<path d="M${x - gap / 2} ${y}H${x + gap / 2}" stroke="${BG}" stroke-width="${gap}"/>`;
      paths += `<path d="M${Math.max(start, x - over)} ${y}H${Math.min(end, x + over)}" stroke="${ACCENT}" stroke-width="${width}"/>`;
    }),
  );
  return dataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">${paths}</svg>`,
  );
}

function backdrop() {
  return dataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">` +
      `<defs>` +
      `<pattern id="d" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="11" cy="11" r="1.4" fill="#fff"/></pattern>` +
      `<radialGradient id="f" cx="0.3" cy="0.05" r="0.75"><stop offset="0" stop-color="#fff" stop-opacity="0.26"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
      `<mask id="m"><rect width="1200" height="630" fill="url(#f)"/></mask>` +
      `<radialGradient id="g" cx="0.75" cy="0.2" r="0.55"><stop offset="0" stop-color="${ACCENT}" stop-opacity="0.22"/><stop offset="1" stop-color="${ACCENT}" stop-opacity="0"/></radialGradient>` +
      `</defs>` +
      `<rect width="1200" height="630" fill="url(#g)"/>` +
      `<rect width="1200" height="630" fill="url(#d)" mask="url(#m)"/>` +
      `</svg>`,
  );
}

const icon = (body: string, color: string) =>
  dataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`,
  );

const ICONS = {
  search: icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', MUTED),
  file: icon(
    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    MUTED,
  ),
  edit: icon('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', OK),
  check: icon('<path d="m5 12 5 5 9-10"/>', OK),
  pr: icon(
    '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5v7"/><path d="M18 15.5V9a3 3 0 0 0-3-3h-4"/><path d="m13 3.5-2.5 2.5 2.5 2.5"/>',
    OK,
  ),
};

function Code({ children }: { children: string }) {
  return (
    <span
      style={{
        display: 'flex',
        padding: '2px 10px',
        borderRadius: 8,
        background: 'rgba(255,255,255,0.07)',
        color: FG,
      }}
    >
      {children}
    </span>
  );
}

function Row({
  src,
  children,
  note,
  tone = MUTED,
}: {
  src: string;
  children: React.ReactNode;
  note: string;
  tone?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 22, color: MUTED }}>
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <img src={src} width={23} height={23} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexGrow: 1 }}>{children}</div>
      {note && <span style={{ fontSize: 19, color: tone }}>{note}</span>}
    </div>
  );
}

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        padding: '68px 60px 68px 72px',
        background: BG,
        color: FG,
        fontFamily: 'Geist',
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <img
        src={backdrop()}
        width={1200}
        height={630}
        style={{ position: 'absolute', top: 0, left: 0 }}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: 600,
          paddingRight: 40,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <img src={mark()} width={56} height={56} />
          <span style={{ fontSize: 40, letterSpacing: '-0.04em' }}>weft</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontSize: 56,
              lineHeight: 1.08,
              letterSpacing: '-0.035em',
            }}
          >
            <span>Describe the change.</span>
            <span style={{ color: '#8f8f98' }}>Review the</span>
            <span style={{ color: '#8f8f98' }}>pull request.</span>
          </div>
          <span style={{ fontSize: 25, lineHeight: 1.4, color: '#a3a3ab' }}>
            A coding agent for your GitHub repositories.
          </span>
        </div>
        <span style={{ fontSize: 24, color: ACCENT }}>weft.avichal.me</span>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          alignSelf: 'center',
          borderRadius: 24,
          border: '1px solid rgba(240,129,74,0.35)',
          background: SURFACE,
          boxShadow: '0 30px 80px -30px rgba(0,0,0,0.8)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '16px 22px',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{ width: 12, height: 12, borderRadius: 6, background: '#2a2a2e' }}
            />
          ))}
          <span style={{ marginLeft: 8, fontSize: 18, color: '#5f5f68' }}>
            avichal-08/weft-playground
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '22px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <span
              style={{
                display: 'flex',
                fontSize: 21,
                lineHeight: 1.35,
                padding: '11px 16px',
                borderRadius: '18px 18px 6px 18px',
                background: '#1d1d21',
                border: '1px solid rgba(255,255,255,0.07)',
                maxWidth: 440,
              }}
            >
              Fix the LRU cache eviction bug.
            </span>
          </div>
          <Row src={ICONS.search} note="1 file">
            <span>Searched for</span>
            <Code>get(</Code>
          </Row>
          <Row src={ICONS.file} note="36 lines">
            <span>Read</span>
            <Code>src/lru.js</Code>
          </Row>
          <Row src={ICONS.edit} note="+4 −1" tone={OK}>
            <span>Edited</span>
            <Code>src/lru.js</Code>
          </Row>
          <Row src={ICONS.check} note="" tone={OK}>
            <span>Tests passed in a clean sandbox</span>
          </Row>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginTop: 4,
              padding: '14px 18px',
              borderRadius: 14,
              border: '1px solid rgba(74,222,128,0.3)',
              background: 'rgba(74,222,128,0.09)',
              fontSize: 22,
              color: OK,
            }}
          >
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <img src={ICONS.pr} width={26} height={26} />
            Pull request opened
          </div>
        </div>
      </div>
    </div>,
    size,
  );
}
