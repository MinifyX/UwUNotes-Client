/**
 * The little Nyu at the left end of the status bar.
 *
 * She sits in the bar, not over the text: only her ears (and a hat, when she
 * wears one) poke a few pixels above its top edge. Everything she does is
 * driven from outside — `lib/nyu-life.ts` says whether she idles, types along,
 * sleeps or reacts, `lib/nyu.ts` decides when — and this component only draws
 * the result.
 *
 * Cheap at rest, which is most of the time:
 *
 * - It re-renders when her pose or reaction changes, never per keystroke.
 * - Blinking is a timer every few seconds that flips one class on the SVG, not
 *   an infinite CSS animation repainting the bar sixty times a second.
 * - Her pupils follow the caret and the pointer through two CSS variables set
 *   straight on the element; React never hears about it.
 * - Every loop stops when the window is hidden or animations are off.
 *
 * A click pets her, a double-click opens her page (`NyuDialog`).
 */

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { openDialog } from '../../../lib/commands';
import { t, useLanguage } from '../../../lib/i18n';
import { petCompanion } from '../../../lib/nyu';
import { onLook, useLife, type Burst, type Pose } from '../../../lib/nyu-life';
import { useNyuHat } from '../../../lib/nyu-progress';
import { useSettings } from '../../../lib/settings';
import { withHat } from '../hats';
import { NYU, NyuFigure, Paw, type NyuMood } from '../Nyu';
import { occasionsOn, type Occasion } from '../occasions';
import { Cake, Egg, Note, Pumpkin, Snowflake } from '../props';
import { Heart, Star } from '../scenes';
import './companion.css';

/** Pupils that can look somewhere: the "happy" eyes, wrapped in a group CSS moves. */
const LOOKING_EYES = (
  <g className="nyu-look">
    <g fill={NYU.ink}>
      <ellipse cx="102" cy="148" rx="8" ry="10" />
      <ellipse cx="154" cy="148" rx="8" ry="10" />
    </g>
    <g fill={NYU.paper}>
      <circle cx="105" cy="144" r="3" />
      <circle cx="157" cy="144" r="3" />
    </g>
  </g>
);

const POSE_MOOD: Record<Pose, NyuMood> = {
  idle: 'happy',
  typing: 'happy',
  excited: 'sparkle',
  sleeping: 'sleepy',
  waking: 'uwu',
};

/** How far the pupils may travel, in Nyu's units (the eye is about 16 wide). */
const LOOK_X = 9;
const LOOK_Y = 6;

/** The prop an occasion sets beside her, small enough for the bar. */
function OccasionProp({ occasion }: { occasion: Occasion | null }) {
  switch (occasion) {
    case 'halloween':
      return <Pumpkin x={246} y={196} size={0.95} />;
    case 'advent':
      return <Snowflake x={246} y={186} size={1.1} />;
    case 'valentine':
      return <Heart x={246} y={190} size={1.2} />;
    case 'easter':
      return <Egg x={246} y={192} size={0.95} />;
    case 'birthday':
    case 'newyear':
      return <Cake x={248} y={196} size={0.85} />;
    default:
      return null;
  }
}

/** The first occasion that has a prop, or none. */
function propOccasion(enabled: boolean): Occasion | null {
  if (!enabled) return null;
  return (
    occasionsOn(new Date()).find((occasion) => occasion !== 'night' && occasion !== 'friday13') ??
    null
  );
}

export function NyuCompanion() {
  useLanguage();
  const settings = useSettings();
  const life = useLife();
  const hat = useNyuHat();
  const svgRef = useRef<SVGSVGElement>(null);
  const { pose, reaction, bubble } = life;

  const mood: NyuMood = reaction?.mood ?? POSE_MOOD[pose];
  const canLook = mood === 'happy';
  const visible = settings.nyuCompanion;

  // Blinking: now and then, at an irregular pace, only while her eyes are open
  // and somebody could see it. A hidden window stops the timer altogether
  // rather than waking every few seconds to decide not to blink.
  useEffect(() => {
    if (!visible || !canLook) return;
    let timer = 0;
    let open = 0;
    const svg = svgRef.current;
    const next = () => {
      window.clearTimeout(timer);
      timer = document.hidden ? 0 : window.setTimeout(blink, 3_000 + Math.random() * 5_000);
    };
    const blink = () => {
      if (document.documentElement.dataset.motion !== 'reduced') {
        svg?.classList.add('is-blinking');
        open = window.setTimeout(() => svg?.classList.remove('is-blinking'), 160);
      }
      next();
    };
    next();
    document.addEventListener('visibilitychange', next);
    return () => {
      document.removeEventListener('visibilitychange', next);
      window.clearTimeout(timer);
      window.clearTimeout(open);
      svg?.classList.remove('is-blinking');
    };
  }, [visible, canLook]);

  // Looking: the caret while typing, the pointer otherwise. Straight to the
  // element's style; nothing re-renders.
  useEffect(() => {
    if (!visible) return;
    return onLook((x, y) => {
      const svg = svgRef.current;
      if (!svg) return;
      const box = svg.getBoundingClientRect();
      const dx = x - (box.left + box.width / 2);
      const dy = y - (box.top + box.height / 2);
      const distance = Math.hypot(dx, dy) || 1;
      // Near things get a little glance, far things the full turn of the eye.
      const reach = Math.min(1, distance / 240);
      svg.style.setProperty('--nyu-look-x', `${((dx / distance) * LOOK_X * reach).toFixed(1)}px`);
      svg.style.setProperty('--nyu-look-y', `${((dy / distance) * LOOK_Y * reach).toFixed(1)}px`);
    });
  }, [visible]);

  if (!visible) return null;

  const typing = pose === 'typing' || pose === 'excited';
  const paws: ReactNode = typing ? (
    <>
      <Paw x={92} y={214} className="nyu-type-paw nyu-type-paw-l" />
      <Paw x={164} y={214} className="nyu-type-paw nyu-type-paw-r" />
    </>
  ) : reaction?.motion === 'wave' ? (
    <Paw x={232} y={120} className="nyu-wave" />
  ) : null;
  const parts = withHat(hat, { front: paws });
  const occasion = propOccasion(settings.nyuOccasions);

  return (
    <div
      className="nyu-companion"
      data-pose={pose}
      data-prop={occasion ? 'yes' : undefined}
      style={occasion ? ({ '--nyu-companion-extra': '6px' } as CSSProperties) : undefined}
    >
      <button
        type="button"
        className="nyu-companion-button"
        onClick={petCompanion}
        onDoubleClick={() => openDialog('nyu')}
        title={t('Nyu — Klick zum Streicheln, Doppelklick für ihre Erfolge')}
        aria-label={t('Nyu streicheln')}
      >
        <svg
          ref={svgRef}
          viewBox={occasion ? '20 30 252 196' : '20 30 216 196'}
          className="nyu-host nyu-companion-svg"
          style={{ overflow: 'visible' }}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          focusable="false"
        >
          <g
            key={reaction?.id ?? 0}
            className="nyu-companion-body"
            data-motion={reaction?.motion ?? undefined}
          >
            <NyuFigure mood={mood} eyes={canLook ? LOOKING_EYES : undefined} {...parts} />
          </g>
          <OccasionProp occasion={occasion} />
          {pose === 'sleeping' ? (
            <g className="nyu-companion-zzz" fill="none" stroke={NYU.violet} strokeWidth={14}>
              <path d="M226 4 h28 l-28 28 h28" />
            </g>
          ) : null}
        </svg>
      </button>
      {reaction?.burst ? (
        <BurstView key={reaction.id} kind={reaction.burst} ms={reaction.ms} />
      ) : null}
      {bubble ? (
        <div key={bubble.id} className="nyu-bubble" role="status">
          {bubble.text}
        </div>
      ) : null}
    </div>
  );
}

/* ── Bursts ────────────────────────────────────────────── */

type Particle = [x: number, y: number, size: number, delay: number];

/** Where each particle flies to, from the middle of her head (0, 0), in px. */
const SPREAD: Particle[] = [
  [-26, -30, 0.9, 0],
  [-6, -42, 1.1, 60],
  [18, -34, 0.8, 120],
  [30, -14, 0.9, 30],
  [-32, -6, 0.7, 90],
];

const CONFETTI_COLOURS = [NYU.body, NYU.star, NYU.mint, NYU.sky, NYU.lilac];

function Particle({ kind, index, size }: { kind: Burst; index: number; size: number }) {
  if (kind === 'hearts') return <Heart x={0} y={0} size={size * 0.9} />;
  if (kind === 'notes') return <Note x={0} y={0} size={size * 0.9} />;
  if (kind === 'confetti') {
    return (
      <rect
        x="-7"
        y="-4"
        width="14"
        height="8"
        rx="2"
        transform={`rotate(${index * 47})`}
        fill={CONFETTI_COLOURS[index % CONFETTI_COLOURS.length]}
        stroke={NYU.ink}
        strokeWidth={2.5}
      />
    );
  }
  return <Star x={0} y={0} r={10 * size} />;
}

/**
 * A handful of particles flying off her head, once. Plays for the reaction's
 * length and is unmounted with it; with motion reduced it is never mounted.
 */
function BurstView({ kind, ms }: { kind: Burst; ms: number }) {
  const particles =
    kind === 'confetti'
      ? [...SPREAD, ...SPREAD.map(([x, y, s, d]) => [x * 1.4, y * 0.8, s, d + 80] as Particle)]
      : SPREAD;
  if (kind === 'dizzy') {
    return (
      <svg
        className="nyu-burst nyu-burst-dizzy"
        viewBox="-40 -20 80 40"
        aria-hidden
        focusable="false"
        style={{ '--nyu-burst-ms': `${ms}ms` } as CSSProperties}
      >
        <g className="nyu-dizzy-ring">
          <Star x={-22} y={0} r={7} />
          <Star x={22} y={0} r={7} />
          <Star x={0} y={-8} r={5} />
        </g>
      </svg>
    );
  }
  return (
    <svg
      className="nyu-burst"
      viewBox="-60 -60 120 80"
      aria-hidden
      focusable="false"
      style={{ '--nyu-burst-ms': `${ms}ms` } as CSSProperties}
    >
      {particles.map(([x, y, size, delay], index) => (
        <g
          key={index}
          className="nyu-particle"
          style={
            {
              '--to-x': `${x}px`,
              '--to-y': `${y}px`,
              animationDelay: `${delay}ms`,
            } as CSSProperties
          }
        >
          <g transform="scale(0.5)">
            <Particle kind={kind} index={index} size={size} />
          </g>
        </g>
      ))}
    </svg>
  );
}
