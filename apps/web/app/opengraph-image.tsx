import { ImageResponse } from 'next/og';

export const alt =
  'weft: describe the change, review the pull request. A coding agent for GitHub repositories.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const BG = '#0b0b0c';
const ACCENT = '#f0814a';
const FG = '#ececee';

function markDataUri() {
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">${paths}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function dotsDataUri() {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">` +
    `<defs>` +
    `<pattern id="d" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="11" cy="11" r="1.4" fill="#ffffff"/></pattern>` +
    `<radialGradient id="f" cx="0.82" cy="0.1" r="0.85"><stop offset="0" stop-color="#fff" stop-opacity="0.32"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `<mask id="m"><rect width="1200" height="630" fill="url(#f)"/></mask>` +
    `<radialGradient id="g" cx="0.85" cy="0" r="0.6"><stop offset="0" stop-color="${ACCENT}" stop-opacity="0.3"/><stop offset="1" stop-color="${ACCENT}" stop-opacity="0"/></radialGradient>` +
    `</defs>` +
    `<rect width="1200" height="630" fill="url(#g)"/>` +
    `<rect width="1200" height="630" fill="url(#d)" mask="url(#m)"/>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const PILLS = ['Isolated sandbox', 'Verified by your tests', 'Ask mode', 'Any model'];

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px 80px',
        position: 'relative',
        background: BG,
        color: FG,
        fontFamily: 'Geist',
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <img
        src={dotsDataUri()}
        width={1200}
        height={630}
        style={{ position: 'absolute', top: 0, left: 0 }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <img src={markDataUri()} width={64} height={64} />
        <span style={{ fontSize: 44, letterSpacing: '-0.04em' }}>weft</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: 84,
            lineHeight: 1.02,
            letterSpacing: '-0.035em',
          }}
        >
          <span>Describe the change.</span>
          <span style={{ color: '#8f8f98' }}>Review the pull request.</span>
        </div>
        <span style={{ fontSize: 30, lineHeight: 1.4, color: '#a3a3ab', maxWidth: 900 }}>
          A coding agent for your GitHub repositories. It works in an isolated sandbox, proves the
          change against your tests, and opens the pull request.
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 12 }}>
          {PILLS.map((p) => (
            <span
              key={p}
              style={{
                display: 'flex',
                fontSize: 22,
                color: '#c9c9cf',
                padding: '8px 18px',
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.14)',
                background: 'rgba(255,255,255,0.04)',
              }}
            >
              {p}
            </span>
          ))}
        </div>
        <span style={{ fontSize: 24, color: ACCENT }}>weft.avichal.me</span>
      </div>
    </div>,
    size,
  );
}
