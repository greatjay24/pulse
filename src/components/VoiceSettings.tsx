import { useEffect, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { PROACTIVE_TEST_EVENT } from '../hooks/useProactiveVoice';
import { HOTKEYS, InstalledVoice, SpeakMode, VoiceEngineStatus, VoiceSettings as Settings, applyHotkey, listVoices, loadVoice, saveVoice, speak, stopSpeaking, voiceEngineStatus, warmVoice } from '../utils/voice';
import { ROO_VOICES, choiceValue, parseChoice } from '../utils/voiceText';

// Settings › General: how Roo talks back, and the hotkey that opens the listening panel.
export function VoiceSettings() {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [v, setV] = useState<Settings>(loadVoice);
  const [voices, setVoices] = useState<InstalledVoice[]>([]);
  const [hotkeyNote, setHotkeyNote] = useState<string | null>(null);
  const [engine, setEngine] = useState<VoiceEngineStatus | null>(null);

  useEffect(() => {
    voiceEngineStatus().then(setEngine).catch(() => setEngine(null));
  }, []);

  useEffect(() => {
    listVoices()
      .then((list) => {
        const lang = (navigator.language || 'en').slice(0, 2);
        setVoices([...list].sort((a, b) => Number(b.locale.startsWith(lang)) - Number(a.locale.startsWith(lang)) || a.name.localeCompare(b.name)));
      })
      .catch(() => setVoices([]));
  }, []);

  const update = (next: Partial<Settings>) => {
    const merged = { ...v, ...next };
    setV(merged);
    saveVoice(merged);
  };

  const pickHotkey = (hotkey: string) => {
    setHotkeyNote(null);
    applyHotkey(hotkey)
      .then(() => update({ hotkey }))
      .catch((e) => setHotkeyNote(String(e)));
  };

  const select = { background: c.bgElevated, color: c.text, border: `1px solid ${c.border}`, borderRadius: tokens.radius.sm, padding: '6px 10px', fontFamily: 'inherit', fontSize: tokens.type.small } as const;
  const row = { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } as const;
  const label = { width: '150px', fontSize: tokens.type.small, color: c.textMuted } as const;

  return (
    <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: tokens.radius.lg, padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div>
        <div style={{ fontWeight: 600 }}>Voice</div>
        <div style={{ fontSize: tokens.type.small, color: c.textMuted, marginTop: '4px', lineHeight: 1.5 }}>
          Talk to Roo with the hotkey, from anywhere. Speech is turned into text on this Mac (macOS on-device recognition), and replies are
          read in Roo's own voice, made on this Mac too (nothing leaves it). The first time, macOS asks for the microphone and speech recognition.
        </div>
      </div>
      <div style={row}>
        <span style={label}>Read replies aloud</span>
        <select value={v.mode} onChange={(e) => update({ mode: e.target.value as SpeakMode })} style={select}>
          <option value="summary">The summary line only</option>
          <option value="full">The whole reply</option>
          <option value="off">Off</option>
        </select>
      </div>
      <div style={row}>
        <span style={label}>Voice</span>
        <select
          value={choiceValue(v.engine, v.voice)}
          onChange={(e) => {
            const next = parseChoice(e.target.value);
            update(next);
            if (next.engine !== 'mac') warmVoice().catch(() => {});
          }}
          style={select}
        >
          <optgroup label="Roo">
            {ROO_VOICES.map((r) => (
              <option key={r.engine} value={choiceValue(r.engine, null)}>
                {r.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Mac voices">
            <option value="mac:">System voice</option>
            {voices.map((x) => (
              <option key={x.name} value={choiceValue('mac', x.name)}>
                {x.name} ({x.locale})
              </option>
            ))}
          </optgroup>
        </select>
        <button
          onClick={() => speak("Morning. Two things are waiting: a reply to send, and a pull request to review. The rest can wait.", true).catch(() => {})}
          style={{ ...select, cursor: 'pointer' }}
        >
          Try it
        </button>
        <button onClick={() => stopSpeaking().catch(() => {})} style={{ ...select, cursor: 'pointer' }}>
          Stop
        </button>
      </div>
      {v.engine !== 'mac' && engine && !engine.installed && (
        <div style={{ fontSize: tokens.type.micro, color: c.textDim, marginLeft: '162px', lineHeight: 1.5 }}>
          Roo's voice isn't installed on this Mac, so the Mac voice below reads instead. See README › Voice to set it up.
        </div>
      )}
      <div style={row}>
        <span style={label}>{v.engine === 'mac' ? 'Rate' : 'Mac voice rate'}</span>
        <input type="range" min={120} max={300} step={10} value={v.rate} onChange={(e) => update({ rate: Number(e.target.value) })} />
        <span style={{ fontSize: tokens.type.small, color: c.textDim }}>
          {v.rate} words a minute{v.engine === 'mac' ? '' : ' (Roo speaks at its natural pace; this is for the Mac voice fallback)'}
        </span>
      </div>
      <div style={row}>
        <span style={label}>Listening hotkey</span>
        <select value={v.hotkey} onChange={(e) => pickHotkey(e.target.value)} style={select}>
          {HOTKEYS.map((h) => (
            <option key={h.value} value={h.value}>
              {h.label}
            </option>
          ))}
        </select>
        <span style={{ fontSize: tokens.type.micro, color: hotkeyNote ? c.danger : c.textDim }}>{hotkeyNote ?? '⌥Space is left alone: ChatGPT and Claude use it.'}</span>
      </div>
      <div style={row}>
        <span style={label}>Proactive voice</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: tokens.type.small, cursor: 'pointer' }}>
          <input type="checkbox" checked={v.proactive} onChange={(e) => update({ proactive: e.target.checked })} />
          Roo speaks first: replies to send, decisions, money, a meeting about to start, and the morning brief
        </label>
        <button onClick={() => window.dispatchEvent(new Event(PROACTIVE_TEST_EVENT))} style={{ ...select, cursor: 'pointer' }} title="Speaks a sample and shows its notification; click the notification to open the Roo thread">
          Try it
        </button>
      </div>
      <div style={row}>
        <span style={label}>Quiet hours</span>
        <input type="time" value={v.quietStart} disabled={!v.proactive} onChange={(e) => e.target.value && update({ quietStart: e.target.value })} style={select} />
        <span style={{ fontSize: tokens.type.small, color: c.textDim }}>to</span>
        <input type="time" value={v.quietEnd} disabled={!v.proactive} onChange={(e) => e.target.value && update({ quietEnd: e.target.value })} style={select} />
        <span style={{ fontSize: tokens.type.micro, color: c.textDim }}>
          Never during a call (mic in use) or with the screen locked. At most once every 10 minutes. Mute for an hour from the menu bar.
        </span>
      </div>
    </div>
  );
}
