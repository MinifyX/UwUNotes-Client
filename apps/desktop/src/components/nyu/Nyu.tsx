/**
 * Nyu, the notepad cat.
 *
 * The same cat as in UwUMail and UwUSSH — her body is an envelope there and a
 * terminal window there; here it is a spiral notebook with an elastic band and
 * a pencil tucked behind her right ear, and the cover is the face. The colours are fixed artwork, not theme
 * tokens: a sticker looks like itself in dark mode too, and the white die-cut
 * edge is what keeps the outlines readable on a dark ground.
 *
 * This module draws Nyu and nothing else. It knows no settings, no store and no
 * strings; the lines she says live in `greetings.ts`, the composed pictures in
 * `scenes.tsx`. Nothing in here may depend on the app's stylesheet beyond
 * `nyu.css`, so the symbol can be dropped into an about box or an installer.
 */

import type { ReactNode } from 'react';

// She brings her own stylesheet: without it the die-cut edge paints in the
// artwork's colours instead of white, which is a strange thing to debug.
import './nyu.css';

export const NYU = {
  outline: '#4B1D3F',
  body: '#FF6FA6',
  // Kept the sibling's name: in UwUSSH this fills the terminal screen, here the
  // ruled area of the page. Renaming it would fork a shared palette over a word.
  screen: '#FFB8D3',
  blush: '#FF4D8D',
  edge: '#FFFFFF',
  paper: '#FFFFFF',
  star: '#FFD66E',
  tear: '#9ED8FF',
  lilac: '#C9B6F0',
  violet: '#A78BFA',
  mint: '#B9F0D0',
  sky: '#BDE6FF',
  kraft: '#F2C58F',
  kraftLight: '#F8DDB8',
  /** The pencil: bare wood at the tip, the metal band before the eraser. */
  wood: '#F6D2A8',
  ferrule: '#D9C4D0',
  tile: '#FFE4EF',
} as const;

export type NyuMood = 'uwu' | 'happy' | 'cheer' | 'sparkle' | 'sad' | 'puzzled' | 'sleepy';

/** Draws its children twice: first as a white die-cut edge, then as they are. */
export function Sticker({ edge, children }: { edge: number; children: ReactNode }) {
  return (
    <>
      <g className="nyu-edge" strokeWidth={edge}>
        {children}
      </g>
      {children}
    </>
  );
}

const line = { fill: 'none', stroke: NYU.outline, strokeWidth: 8 } as const;

const EYES: Record<NyuMood, ReactNode> = {
  uwu: (
    <g {...line}>
      <path d="M88 142 Q102 160 116 142" />
      <path d="M140 142 Q154 160 168 142" />
    </g>
  ),
  happy: (
    <g>
      <g fill={NYU.outline}>
        <ellipse cx="102" cy="148" rx="8" ry="10" />
        <ellipse cx="154" cy="148" rx="8" ry="10" />
      </g>
      <g fill={NYU.paper}>
        <circle cx="105" cy="144" r="3" />
        <circle cx="157" cy="144" r="3" />
      </g>
    </g>
  ),
  cheer: (
    <g {...line}>
      <path d="M92 138 L110 148 L92 158" />
      <path d="M164 138 L146 148 L164 158" />
    </g>
  ),
  sparkle: (
    <g fill={NYU.star} stroke={NYU.outline} strokeWidth={4}>
      <path d="M102 134 Q104 146 116 148 Q104 150 102 162 Q100 150 88 148 Q100 146 102 134Z" />
      <path d="M154 134 Q156 146 168 148 Q156 150 154 162 Q152 150 140 148 Q152 146 154 134Z" />
    </g>
  ),
  sad: (
    <g>
      <g {...line}>
        <path d="M90 152 Q102 142 114 152" />
        <path d="M142 152 Q154 142 166 152" />
      </g>
      <g fill={NYU.tear} stroke={NYU.outline} strokeWidth={4}>
        <path d="M94 158 q-6 9 0 13 q6 -4 0 -13Z" />
        <path d="M162 158 q-6 9 0 13 q6 -4 0 -13Z" />
      </g>
    </g>
  ),
  puzzled: (
    <g fill={NYU.outline}>
      <circle cx="102" cy="148" r="7" />
      <circle cx="154" cy="148" r="7" />
    </g>
  ),
  sleepy: (
    <g {...line}>
      <path d="M90 150 q12 8 24 0" />
      <path d="M142 150 q12 8 24 0" />
    </g>
  ),
};

const W_MOUTH = <path d="M112 170 q8 13 16 0 q8 13 16 0" {...line} />;

const MOUTHS: Record<NyuMood, ReactNode> = {
  uwu: W_MOUTH,
  happy: W_MOUTH,
  sparkle: W_MOUTH,
  cheer: (
    <path d="M114 170 Q128 194 142 170 Z" fill={NYU.outline} stroke={NYU.outline} strokeWidth={6} />
  ),
  sad: <path d="M114 184 Q128 172 142 184" {...line} />,
  puzzled: <path d="M114 180 q7 -6 14 0 q7 6 14 0" {...line} strokeWidth={7} />,
  sleepy: <path d="M120 180 q4 5 8 0 q4 5 8 0" {...line} strokeWidth={6} />,
};

/**
 * The notebook: a rounded cover in Nyu's usual bounds — 28–228 × 74–221, the
 * same box as the envelope and the terminal window of her siblings — so scenes
 * place all three cats identically. Drawn from the app icon's 512 artwork at
 * 0.64 scale, so the stroke widths come out at her usual 9.
 */
const COVER = { x: 28, y: 74, width: 200, height: 147, rx: 26 } as const;

/**
 * Where the face sits on the cover, relative to the coordinates the eyes and
 * mouths below are written in. The face is high on the notebook, with the two
 * ruled lines underneath, as on the icon. Anything drawn on the face from the
 * outside — glasses, eyes that follow the pointer — is wrapped in {@link Face}
 * so it moves with it.
 */
export const FACE_OFFSET = { x: 4, y: -50 } as const;

/** Puts face-relative parts (written around eyes at y 148) onto the cover. */
export function Face({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <g className={className} transform={`translate(${FACE_OFFSET.x} ${FACE_OFFSET.y})`}>
      {children}
    </g>
  );
}

/** The four rings of the spiral binding, top to bottom. */
const RINGS = [93.2, 120.1, 147, 173.8];

/** The pencil behind her right ear, in its own rotated frame; the tip hides behind the cover. */
function Pencil() {
  return (
    <g transform="translate(202 58.6) rotate(-38)" stroke={NYU.outline} strokeWidth={7}>
      <path d="M-76.8 -12.8 L-102.4 0 L-76.8 12.8 Z" fill={NYU.wood} />
      <path d="M-102.4 0 L-92.8 -4.8 L-92.8 4.8 Z" fill={NYU.outline} />
      <rect x="-76.8" y="-12.8" width="121.6" height="25.6" fill={NYU.star} />
      <rect x="44.8" y="-12.8" width="15.4" height="25.6" fill={NYU.ferrule} />
      <rect x="60.2" y="-12.8" width="19.2" height="25.6" rx="6.4" fill={NYU.body} />
    </g>
  );
}

/** A paw in Nyu's own coordinates (the body spans 28–228 × 74–221). */
export function Paw({ x, y, className }: { x: number; y: number; className?: string }) {
  return (
    <g className={className}>
      <ellipse cx={x} cy={y} rx="19" ry="16" fill={NYU.body} stroke={NYU.outline} strokeWidth={9} />
      <path
        d={`M${x - 5} ${y + 3} v6 M${x + 5} ${y + 3} v6`}
        fill="none"
        stroke={NYU.outline}
        strokeWidth={5}
      />
    </g>
  );
}

type FigureProps = {
  mood?: NyuMood;
  /** Centre of the body in the parent's coordinates. */
  x?: number;
  y?: number;
  /** 1 is the size of the app symbol: the body is 200 wide. */
  scale?: number;
  tilt?: number;
  /** Extra parts in Nyu's own coordinates. */
  behind?: ReactNode;
  front?: ReactNode;
  /** Replaces the mood's eyes, e.g. pupils that follow something. The mouth stays the mood's. */
  eyes?: ReactNode;
  /** The white die-cut edge, in Nyu's own coordinates. */
  edge?: number;
};

/** Nyu as a group, for scenes: placed, scaled and tilted in the parent's coordinates. */
export function NyuFigure({
  mood = 'uwu',
  x = 128,
  y = 147,
  scale = 1,
  tilt = 0,
  behind,
  front,
  eyes,
  edge = 20,
}: FigureProps) {
  return (
    <g
      transform={`translate(${x} ${y}) rotate(${tilt}) scale(${scale}) translate(-128 -147)`}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Sticker edge={edge}>
        {behind}
        <Pencil />
        {/* Ears before the cover, so they tuck behind it. */}
        <g className="nyu-ear nyu-ear-l">
          <path
            d="M39.5 104.7 L48.5 40.7 Q50.4 29.2 60.6 35 L111.2 76.6 Z"
            fill={NYU.body}
            stroke={NYU.outline}
            strokeWidth={9}
          />
          <path d="M57.4 72.7 L60.6 51 Q61.3 45.8 65.8 48.4 L89.4 68.9 Z" fill={NYU.screen} />
        </g>
        <g className="nyu-ear nyu-ear-r">
          <path
            d="M216.2 104.7 L207.2 40.7 Q205.3 29.2 195 35 L144.5 76.6 Z"
            fill={NYU.body}
            stroke={NYU.outline}
            strokeWidth={9}
          />
          <path d="M198.2 72.7 L195 51 Q194.4 45.8 189.9 48.4 L166.2 68.9 Z" fill={NYU.screen} />
        </g>
        {/*
          The cover is the pale colour her siblings keep for the envelope flap
          and the terminal screen — it is the face here, and the face wants the
          same ground everywhere. The pink goes to the ears, the elastic band
          and the ruling, which is what makes her read as a notebook.
        */}
        <rect {...COVER} fill={NYU.screen} />
        {/* Band, ruling and rings are interior detail, so no die-cut. */}
        <g className="no-edge">
          <rect x="194.4" y={COVER.y} width="12.8" height={COVER.height} fill={NYU.body} />
          <g fill="none" stroke={NYU.body} strokeWidth={7.5}>
            <path d="M69 172.6 H168.8" />
            <path d="M69 195.6 H136" />
          </g>
        </g>
        <rect {...COVER} fill="none" stroke={NYU.outline} strokeWidth={9} />
        <g fill="none" stroke={NYU.outline} strokeWidth={7}>
          {RINGS.map((top) => (
            <path key={top} d={`M45.9 ${top} H25.4 A9 9 0 0 0 25.4 ${top + 17.9} H45.9`} />
          ))}
        </g>
        <Face>
          {mood !== 'puzzled' && (
            <g className="no-edge" fill={NYU.blush} opacity={0.5}>
              <ellipse cx={82} cy={174} rx={10} ry={6} />
              <ellipse cx={174} cy={174} rx={10} ry={6} />
            </g>
          )}
          <g className={mood === 'sleepy' ? undefined : 'nyu-eyes'}>{eyes ?? EYES[mood]}</g>
          {MOUTHS[mood]}
        </Face>
        {front}
      </Sticker>
    </g>
  );
}

type NyuProps = {
  size?: number;
  mood?: NyuMood;
  /** Blinking is on by default and stops on its own when motion is reduced. */
  blink?: boolean;
  title?: string;
  /** Extra parts in Nyu's own coordinates — a hat from `hats.tsx`, say. */
  behind?: ReactNode;
  front?: ReactNode;
};

/** The symbol on its own: title bar, empty states, the about box. */
export function Nyu({
  size = 96,
  mood = 'uwu',
  blink = true,
  title = 'Nyu',
  behind,
  front,
}: NyuProps) {
  return (
    <svg
      viewBox="0 0 256 256"
      width={size}
      height={size}
      role="img"
      aria-label={title}
      focusable="false"
      className={blink ? 'nyu-host nyu-blink' : 'nyu-host'}
      style={{ overflow: 'visible' }}
    >
      <NyuFigure mood={mood} behind={behind} front={front} />
    </svg>
  );
}
