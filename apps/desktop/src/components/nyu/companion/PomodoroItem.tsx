/**
 * The Nyu-Pomodoro in the status bar: a tiny tomato-Nyu, and the time left
 * while a round is on.
 *
 * Idle, it is just the tomato (and not even that when the setting hides it) —
 * one click starts a focus round. While a round runs, a click opens a short
 * menu: pause or resume, skip, stop.
 *
 * The countdown is the only thing here that ticks, once a second, and only
 * while a round is running and the window is visible. Paused or idle, nothing
 * runs at all.
 */

import { useEffect, useRef, useState } from 'react';
import { t, useLanguage } from '../../../lib/i18n';
import {
  formatRemaining,
  isRunning,
  remainingMs,
  skipPhase,
  startFocus,
  stopFocus,
  togglePomodoro,
  usePomodoro,
  type PomodoroPhase,
} from '../../../lib/nyu-pomodoro';
import { useSettings } from '../../../lib/settings';
import { ContextMenu } from '../../ContextMenu';
import { Sticker } from '../Nyu';
import { Tomato } from '../props';
import './companion.css';

function useSecondTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    let timer = 0;
    const start = () => {
      window.clearInterval(timer);
      if (!document.hidden) timer = window.setInterval(() => setTick((n) => n + 1), 1_000);
    };
    const onVisibility = () => {
      start();
      setTick((n) => n + 1);
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active]);
}

function phaseName(phase: PomodoroPhase): string {
  if (phase === 'focus') return t('Fokus');
  return phase === 'break' ? t('Kurze Pause') : t('Lange Pause');
}

/** The tomato-Nyu at status bar size. */
export function TomatoNyu({ size = 14 }: { size?: number }) {
  return (
    <svg
      viewBox="-44 -48 88 84"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Sticker edge={8}>
        <Tomato x={0} y={0} />
      </Sticker>
    </svg>
  );
}

export function PomodoroItem() {
  useLanguage();
  const settings = useSettings();
  const pomodoro = usePomodoro();
  const running = isRunning(pomodoro);
  useSecondTick(running);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const lastClosed = useRef(0);

  const active = pomodoro.phase !== null;
  if (!active && !settings.pomodoroButton) return null;

  const left = remainingMs(pomodoro, Date.now());
  const paused = active && !running;
  const title = active
    ? `${t('Nyu-Pomodoro')} · ${phaseName(pomodoro.phase!)}${paused ? ` · ${t('pausiert')}` : ''}`
    : t('Nyu-Pomodoro starten');

  return (
    <>
      <button
        type="button"
        className="statusbar-item nyu-pomodoro-item"
        data-phase={pomodoro.phase ?? undefined}
        data-paused={paused ? 'true' : undefined}
        aria-haspopup={active ? 'menu' : undefined}
        aria-expanded={active ? menu !== null : undefined}
        title={title}
        aria-label={title}
        onClick={(event) => {
          if (!active) {
            startFocus();
            return;
          }
          if (menu) {
            setMenu(null);
            return;
          }
          // Same guard as the status bar's own menus: the click that closed the
          // menu must not reopen it.
          if (performance.now() - lastClosed.current < 300) return;
          const box = event.currentTarget.getBoundingClientRect();
          setMenu({ x: box.left, y: box.top - 4 });
        }}
      >
        <TomatoNyu />
        {active ? <span className="nyu-pomodoro-time">{formatRemaining(left)}</span> : null}
      </button>
      {menu && active ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          grow="up"
          label={t('Nyu-Pomodoro')}
          items={[
            {
              id: 'toggle',
              label: paused ? t('Fortsetzen') : t('Pausieren'),
              run: () => togglePomodoro(),
            },
            {
              id: 'skip',
              label: pomodoro.phase === 'focus' ? t('Zur Pause springen') : t('Pause beenden'),
              run: () => skipPhase(),
            },
            { id: 'stop', label: t('Beenden'), run: () => stopFocus() },
          ]}
          onClose={() => {
            lastClosed.current = performance.now();
            setMenu(null);
          }}
        />
      ) : null}
    </>
  );
}
