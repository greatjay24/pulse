import { Fragment, ReactNode } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { Headline as HeadlineData } from '../utils/today';
import { formatUsd } from '../utils/tracker';

// "Today: 4 moves · 22 decisions need you · $1,240 in this month", the one line every view
// leads with. The numbers carry the weight; the words around them stay quiet.
export function HeadlineLine({ data, size = 'clamp(22px, 2.3vw, 30px)' }: { data: HeadlineData; size?: string }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const n = (v: number) => <span style={{ color: c.text, fontVariantNumeric: 'tabular-nums' }}>{v.toLocaleString()}</span>;
  const parts: ReactNode[] = [];
  if (data.moves !== null) parts.push(<>{n(data.moves)} {data.moves === 1 ? 'move' : 'moves'}</>);
  parts.push(
    <>
      {n(data.decisions)} {data.decisions === 1 ? 'decision needs' : 'decisions need'} you
    </>,
  );
  parts.push(
    data.cash === null ? (
      <span style={{ color: c.textDim }}>money not connected</span>
    ) : (
      <>
        <span style={{ color: c.text, fontVariantNumeric: 'tabular-nums' }}>{formatUsd(data.cash)}</span> in this month
      </>
    ),
  );
  return (
    <p
      style={{
        fontFamily: tokens.fonts.display,
        fontSize: size,
        lineHeight: 1.3,
        letterSpacing: '-0.01em',
        color: c.textMuted,
        fontWeight: 400,
      }}
    >
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <span style={{ color: c.textDim, margin: '0 0.35em' }}>·</span>}
          <span style={{ whiteSpace: 'nowrap' }}>
            {i === 0 && <span style={{ color: c.accent }}>Today: </span>}
            {p}
          </span>
        </Fragment>
      ))}
    </p>
  );
}
