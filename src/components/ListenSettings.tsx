import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { LISTEN_MODES, ListenMode, ListenSettings as Settings, PAUSE_MAX, PAUSE_MIN, loadListen, saveListen } from '../utils/listen';

// Settings › General: how the listening panel knows you're done talking (utils/listen.ts).
export function ListenSettings() {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [s, setS] = useState<Settings>(loadListen);

  const update = (next: Partial<Settings>) => {
    const merged = { ...s, ...next };
    setS(merged);
    saveListen(merged);
  };

  const select = { background: c.bgElevated, color: c.text, border: `1px solid ${c.border}`, borderRadius: tokens.radius.sm, padding: '6px 10px', fontFamily: 'inherit', fontSize: tokens.type.small } as const;
  const row = { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } as const;
  const label = { width: '150px', fontSize: tokens.type.small, color: c.textMuted } as const;
  const hint: Record<ListenMode, string> = {
    press: 'Press the hotkey, talk as long as you like (pauses are fine), press it again or Enter to send.',
    hold: 'Hold the hotkey while you talk and let go to send. A quick tap works like press to send.',
    pause: 'Sends on its own once you stop talking for the pause below, or on Enter.',
  };

  return (
    <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: tokens.radius.lg, padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ fontWeight: 600 }}>Listening</div>
      <div style={row}>
        <span style={label}>When to send</span>
        <select value={s.mode} onChange={(e) => update({ mode: e.target.value as ListenMode })} style={select}>
          {LISTEN_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <span style={{ fontSize: tokens.type.micro, color: c.textDim, flex: '1 1 240px' }}>{hint[s.mode]} Esc cancels.</span>
      </div>
      {s.mode === 'pause' && (
        <div style={row}>
          <span style={label}>Pause before sending</span>
          <input type="range" min={PAUSE_MIN} max={PAUSE_MAX} step={0.5} value={s.pauseSecs} onChange={(e) => update({ pauseSecs: Number(e.target.value) })} />
          <span style={{ fontSize: tokens.type.small, color: c.textDim }}>{s.pauseSecs} seconds</span>
        </div>
      )}
    </div>
  );
}
