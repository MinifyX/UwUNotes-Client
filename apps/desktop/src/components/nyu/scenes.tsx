/**
 * Composed pictures of Nyu for the three places the app has nothing to show:
 * the pane with no document in it, the search panel with no match, and the
 * moment the session is still being restored.
 *
 * Scenes are decorative and say nothing: they carry `aria-hidden`, and the text
 * beside them is the real message. Nothing here reads settings or state — a
 * caller picks the scene, this file only draws it.
 */

import type { ReactNode } from 'react';
import { NYU, NyuFigure, Paw, Sticker } from './Nyu';

// Every scene is drawn on a 320 × 220 canvas, the same as UwUMail's and
// UwUSSH's. Nyu sits at about 0.6 scale, so props use a 6 px outline and an
// 18 px edge to match.

const S = { stroke: NYU.outline, strokeWidth: 6 } as const;
const EDGE = 18;
/** Nyu's own edge at scene scale: 30 × 0.6 ≈ the props' 18 px. */
const NYU_EDGE = 30;

export function Shadow({ cx = 160, rx = 104 }: { cx?: number; rx?: number }) {
  return (
    <ellipse
      className="no-edge"
      cx={cx}
      cy="204"
      rx={rx}
      ry="8"
      fill={NYU.outline}
      opacity="0.08"
    />
  );
}

export function Star({
  x,
  y,
  r = 12,
  className,
}: {
  x: number;
  y: number;
  r?: number;
  className?: string;
}) {
  const k = r * 0.2;
  return (
    <path
      className={className}
      d={`M${x} ${y - r} Q${x + k} ${y - k} ${x + r} ${y} Q${x + k} ${y + k} ${x} ${y + r} Q${x - k} ${y + k} ${x - r} ${y} Q${x - k} ${y - k} ${x} ${y - r}Z`}
      fill={NYU.star}
      stroke={NYU.outline}
      strokeWidth={r > 10 ? 4 : 3}
    />
  );
}

export function Heart({
  x,
  y,
  size = 1,
  fill = NYU.body,
}: {
  x: number;
  y: number;
  size?: number;
  fill?: string;
}) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${size})`}
      d="M0 13 C-15 3 -18 -4 -17 -8 C-16 -15 -7 -16 -3 -11 L0 -8 L3 -11 C7 -16 16 -15 17 -8 C18 -4 15 3 0 13Z"
      fill={fill}
      stroke={NYU.outline}
      strokeWidth={4 / size}
    />
  );
}

/**
 * A loose sheet with the same dog-ear as Nyu's own body. `writing` draws the
 * middle line as it is being written and parks a caret behind it; the line
 * carries `pathLength` because the scribble keyframes measure in those units,
 * not in the path's real length.
 */
export function Sheet({
  x,
  y,
  rotate = 0,
  size = 1,
  writing = false,
}: {
  x: number;
  y: number;
  rotate?: number;
  size?: number;
  writing?: boolean;
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${size})`}>
      <path d="M-34 -46 H18 L34 -30 V46 H-34 Z" fill={NYU.paper} {...S} strokeWidth={5} />
      <g className="no-edge">
        <path d="M18 -46 V-30 H34" fill="none" stroke={NYU.outline} strokeWidth={4} />
        <g fill="none" stroke={NYU.body} strokeWidth={5}>
          <path d="M-22 -10 H22" />
          <path className={writing ? 'nyu-scribble' : undefined} pathLength={120} d="M-22 6 H14" />
          <path d="M-22 22 H24" />
        </g>
        {writing && (
          <path className="nyu-cursor" d="M20 -1 V13" stroke={NYU.outline} strokeWidth={5} />
        )}
      </g>
    </g>
  );
}

/** A closed spiral notebook, sturdy enough for a cat to sleep on. */
export function Notebook({
  x,
  y,
  rotate = 0,
  size = 1,
}: {
  x: number;
  y: number;
  rotate?: number;
  size?: number;
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${size})`}>
      {/* Pages first and a shade narrower: what shows below the cover is their edge. */}
      <rect x="-78" y="-4" width="156" height="20" rx="6" fill={NYU.paper} {...S} strokeWidth={5} />
      <rect x="-84" y="-18" width="168" height="24" rx="8" fill={NYU.lilac} {...S} />
      <g className="no-edge" fill="none">
        <path d="M-62 -18 V6 M-38 -18 V6 M-14 -18 V6" stroke={NYU.outline} strokeWidth={4} />
        <path d="M56 -18 V6" stroke={NYU.blush} strokeWidth={6} />
      </g>
    </g>
  );
}

/** The magnifying glass, held over whatever the search did not find. */
export function Glass({
  x,
  y,
  rotate = 0,
  size = 1,
}: {
  x: number;
  y: number;
  rotate?: number;
  size?: number;
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${size})`}>
      {/* Handle first: the lens then covers the end that would stick into it. */}
      <path d="M18 18 L42 42" fill="none" stroke={NYU.outline} strokeWidth={14} />
      <circle cx="0" cy="0" r="26" fill={NYU.sky} fillOpacity={0.55} {...S} />
      <path
        className="no-edge"
        d="M-14 -6 a16 16 0 0 1 10 -12"
        fill="none"
        stroke={NYU.paper}
        strokeWidth={5}
      />
    </g>
  );
}

/** The session is being restored: Nyu waves, already writing on something. */
function Startup() {
  return (
    <>
      <Shadow cx={152} />
      <NyuFigure
        mood="happy"
        x={148}
        y={132}
        scale={0.62}
        tilt={-5}
        edge={NYU_EDGE}
        front={<Paw x={238} y={104} className="nyu-wave" />}
      />
      <Sticker edge={EDGE}>
        <Sheet x={272} y={150} rotate={8} size={0.85} writing />
      </Sticker>
      <Sticker edge={12}>
        <Star x={40} y={54} r={11} className="nyu-twinkle" />
        <Heart x={52} y={150} size={0.7} fill={NYU.lilac} />
      </Sticker>
    </>
  );
}

/** No document in this pane: Nyu naps on a shut notebook. */
function Empty() {
  return (
    <>
      <Shadow cx={160} rx={96} />
      <Sticker edge={EDGE}>
        <Notebook x={160} y={182} rotate={-2} />
      </Sticker>
      <NyuFigure mood="sleepy" x={156} y={122} scale={0.58} tilt={6} edge={NYU_EDGE} />
      <g className="nyu-zzz" fill="none" stroke={NYU.violet} strokeWidth={5}>
        <path d="M228 76 h16 l-16 16 h16" />
        <path d="M254 46 h11 l-11 11 h11" />
      </g>
    </>
  );
}

/** The search found nothing: Nyu checks the page again, closely. */
function NoResults() {
  return (
    <>
      <Shadow cx={146} />
      <NyuFigure
        mood="puzzled"
        x={124}
        y={130}
        scale={0.6}
        tilt={-6}
        edge={NYU_EDGE}
        front={<Paw x={230} y={152} />}
      />
      <Sticker edge={EDGE}>
        <Sheet x={248} y={122} rotate={9} size={0.9} />
        <Glass x={252} y={136} rotate={-12} size={0.95} />
      </Sticker>
      <Sticker edge={12}>
        <Star x={40} y={58} r={9} />
      </Sticker>
    </>
  );
}

const SCENES = {
  startup: Startup,
  empty: Empty,
  noResults: NoResults,
} satisfies Record<string, () => ReactNode>;

export type SceneName = keyof typeof SCENES;

/** A small illustration of Nyu for empty states. Decorative only. */
export function NyuScene({ name, className }: { name: SceneName; className?: string }) {
  const Scene = SCENES[name];
  return (
    <svg
      viewBox="-10 -10 340 230"
      className={className ? `nyu-host nyu-blink ${className}` : 'nyu-host nyu-blink'}
      style={{ overflow: 'visible' }}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <Scene />
    </svg>
  );
}
