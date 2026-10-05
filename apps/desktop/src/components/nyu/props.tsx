/**
 * Small props for the companion and the cameos: a tomato for the Pomodoro, the
 * occasions' little things (pumpkin, snowflake, egg, cake), a bat, a moon, a
 * music note, and the black cat that crosses the editor on Friday the 13th.
 *
 * Same sticker rules as `scenes.tsx`: plum outline, palette fills, each prop
 * centred on its `x`/`y` so a caller places it without knowing its shape. No
 * settings, no store — drawing only.
 */

import { NYU } from './Nyu';

const S = { stroke: NYU.ink, strokeWidth: 6, strokeLinejoin: 'round' as const };
const TOMATO = '#FF6B57';
const LEAF = '#7FD6A4';
const PUMPKIN = '#FFA94D';

type Placed = { x: number; y: number; size?: number; rotate?: number };

function place({ x, y, size = 1, rotate = 0 }: Placed): string {
  return `translate(${x} ${y}) rotate(${rotate}) scale(${size})`;
}

/** A tomato with cat ears and a tiny UwU face: the Nyu-Pomodoro's mascot. */
export function Tomato(props: Placed & { face?: boolean }) {
  return (
    <g transform={place(props)}>
      <path d="M-22 -16 L-16 -36 L-4 -22 Z" fill={TOMATO} {...S} />
      <path d="M22 -16 L16 -36 L4 -22 Z" fill={TOMATO} {...S} />
      <ellipse cx="0" cy="0" rx="30" ry="26" fill={TOMATO} {...S} />
      <path
        d="M-12 -24 Q0 -16 12 -24 Q6 -30 0 -22 Q-6 -30 -12 -24 Z"
        fill={LEAF}
        {...S}
        strokeWidth={4}
      />
      {props.face !== false ? (
        <g className="no-edge" fill="none" stroke={NYU.ink} strokeWidth={4}>
          <path d="M-14 0 q4 6 8 0" />
          <path d="M6 0 q4 6 8 0" />
          <path d="M-5 9 q2.5 4 5 0 q2.5 4 5 0" />
        </g>
      ) : null}
    </g>
  );
}

export function Pumpkin(props: Placed) {
  return (
    <g transform={place(props)}>
      <path d="M0 -24 q2 -10 10 -12" fill="none" stroke={NYU.ink} strokeWidth={6} />
      <ellipse cx="-12" cy="0" rx="16" ry="22" fill={PUMPKIN} {...S} />
      <ellipse cx="12" cy="0" rx="16" ry="22" fill={PUMPKIN} {...S} />
      <ellipse cx="0" cy="0" rx="14" ry="23" fill={PUMPKIN} {...S} />
      <g className="no-edge" fill={NYU.ink}>
        <path d="M-12 -6 l5 -6 l5 6 Z" />
        <path d="M2 -6 l5 -6 l5 6 Z" />
        <path d="M-10 8 q10 8 20 0 l-4 2 l-3 -3 l-3 3 l-3 -3 l-3 3 Z" />
      </g>
    </g>
  );
}

export function Snowflake(props: Placed) {
  return (
    <g transform={place(props)} fill="none" stroke={NYU.sky} strokeWidth={5}>
      <g stroke={NYU.ink} strokeWidth={10}>
        <path d="M0 -20 V20 M-17 -10 L17 10 M-17 10 L17 -10" />
      </g>
      <path d="M0 -20 V20 M-17 -10 L17 10 M-17 10 L17 -10" stroke={NYU.paper} />
    </g>
  );
}

export function Egg(props: Placed) {
  return (
    <g transform={place(props)}>
      <path
        d="M0 -26 C16 -26 22 2 20 10 C18 22 8 26 0 26 C-8 26 -18 22 -20 10 C-22 2 -16 -26 0 -26 Z"
        fill={NYU.mint}
        {...S}
      />
      <path
        className="no-edge"
        d="M-19 2 l6 -5 l6 5 l6 -5 l6 5 l6 -5 l6 5"
        fill="none"
        stroke={NYU.body}
        strokeWidth={5}
      />
      <circle className="no-edge" cx="-6" cy="14" r="3.5" fill={NYU.violet} />
      <circle className="no-edge" cx="8" cy="15" r="3.5" fill={NYU.star} />
    </g>
  );
}

export function Cake(props: Placed) {
  return (
    <g transform={place(props)}>
      <rect x="-28" y="-6" width="56" height="30" rx="6" fill={NYU.paper} {...S} />
      <path
        className="no-edge"
        d="M-28 4 q7 6 14 0 q7 6 14 0 q7 6 14 0 q7 6 14 0"
        fill="none"
        stroke={NYU.body}
        strokeWidth={6}
      />
      <rect
        x="-3"
        y="-24"
        width="6"
        height="18"
        rx="2"
        fill={NYU.sky}
        stroke={NYU.ink}
        strokeWidth={4}
      />
      <path
        className="nyu-flame"
        d="M0 -40 q7 8 0 13 q-7 -5 0 -13 Z"
        fill={NYU.star}
        stroke={NYU.ink}
        strokeWidth={3}
      />
    </g>
  );
}

export function Moon(props: Placed) {
  return (
    <g transform={place(props)}>
      <path
        d="M-4 -30 A30 30 0 1 0 26 14 A24 24 0 1 1 -4 -30 Z"
        fill={NYU.star}
        {...S}
        strokeWidth={5}
      />
    </g>
  );
}

/** A small round bat; wings in their own groups so CSS can flap them. */
export function Bat(props: Placed) {
  return (
    <g transform={place(props)}>
      <g className="nyu-bat-wing nyu-bat-wing-l">
        <path
          d="M-10 0 Q-30 -22 -52 -8 Q-42 -4 -40 6 Q-30 0 -24 10 Q-18 2 -10 6 Z"
          fill={NYU.ink}
          stroke={NYU.ink}
          strokeWidth={4}
        />
      </g>
      <g className="nyu-bat-wing nyu-bat-wing-r">
        <path
          d="M10 0 Q30 -22 52 -8 Q42 -4 40 6 Q30 0 24 10 Q18 2 10 6 Z"
          fill={NYU.ink}
          stroke={NYU.ink}
          strokeWidth={4}
        />
      </g>
      <path
        d="M-10 -12 L-8 -24 L-2 -14 L2 -14 L8 -24 L10 -12 Q14 4 0 10 Q-14 4 -10 -12 Z"
        fill={NYU.ink}
      />
      <g className="no-edge" fill={NYU.star}>
        <circle cx="-4" cy="-6" r="2.6" />
        <circle cx="4" cy="-6" r="2.6" />
      </g>
    </g>
  );
}

/** A music note, for a purr or a "miau". */
export function Note(props: Placed) {
  return (
    <g transform={place(props)}>
      <path
        d="M4 -18 V8 M4 -18 L16 -14 V-6 L4 -10"
        fill={NYU.lilac}
        stroke={NYU.ink}
        strokeWidth={5}
      />
      <ellipse cx="-2" cy="10" rx="8" ry="6" fill={NYU.lilac} stroke={NYU.ink} strokeWidth={5} />
    </g>
  );
}

/**
 * The black cat of Friday the 13th: a silhouette, walking right, tail up.
 * Legs in two groups so CSS can make it trot.
 */
export function BlackCat(props: Placed) {
  const fill = '#2A1426';
  return (
    <g transform={place(props)}>
      <path d="M-36 -6 Q-58 -14 -54 -44" fill="none" stroke={fill} strokeWidth={9} />
      <g className="nyu-trot-a" fill={fill}>
        <rect x="-30" y="2" width="8" height="22" rx="4" />
        <rect x="16" y="2" width="8" height="22" rx="4" />
      </g>
      <g className="nyu-trot-b" fill={fill}>
        <rect x="-18" y="2" width="8" height="22" rx="4" />
        <rect x="26" y="2" width="8" height="22" rx="4" />
      </g>
      <ellipse cx="0" cy="-2" rx="38" ry="16" fill={fill} />
      <circle cx="40" cy="-18" r="16" fill={fill} />
      <path d="M28 -28 L30 -46 L40 -32 Z M46 -32 L54 -46 L54 -26 Z" fill={fill} />
      <g className="no-edge" fill={NYU.star}>
        <ellipse cx="36" cy="-20" rx="3" ry="4" />
        <ellipse cx="47" cy="-20" rx="3" ry="4" />
      </g>
    </g>
  );
}
