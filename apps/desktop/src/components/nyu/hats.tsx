/**
 * Things Nyu wears: the seasonal hats and the accessories she earns.
 *
 * Drawn in Nyu's own coordinates (the notebook spans 28–228 × 74–221, the ear
 * tips are at (50, 30) and (206, 30)), so a hat goes into `NyuFigure`'s `front` or
 * `behind` and lands on her head at every scale. Kept free of the app's
 * modules like everything else in this folder: which hat she wears is decided
 * in `lib/nyu-progress.ts`, this file only draws it.
 *
 * Every piece sits inside the figure's `Sticker`, so it gets the white die-cut
 * edge for free; interior detail that should not get one carries `no-edge`.
 */

import type { ReactNode } from 'react';
import { Face, NYU } from './Nyu';

export type HatId =
  | 'witch'
  | 'santa'
  | 'party'
  | 'bunny'
  | 'nightcap'
  | 'bow'
  | 'glasses'
  | 'sunglasses'
  | 'flower'
  | 'headphones'
  | 'beret'
  | 'crown';

export const HAT_IDS: readonly HatId[] = [
  'bow',
  'glasses',
  'flower',
  'headphones',
  'beret',
  'crown',
  'sunglasses',
  'witch',
  'santa',
  'party',
  'bunny',
  'nightcap',
];

/** The two colours that are not in Nyu's palette: Santa's red and a witch's night. */
const SANTA = '#F0525E';
const WITCH = '#7A4FD0';

const ink = { stroke: NYU.ink, strokeWidth: 8, strokeLinejoin: 'round' as const };

function Witch() {
  return (
    <g transform="translate(128 78) scale(1.15) translate(-128 -78)">
      <path
        d="M84 74 Q100 34 118 6 Q130 -14 156 -22 Q178 -26 190 -14 Q170 -12 160 0 Q148 16 158 46 Q164 62 174 74 Z"
        fill={WITCH}
        {...ink}
      />
      <path d="M92 60 Q128 70 166 60 L172 74 Q128 84 86 74 Z" fill={NYU.body} {...ink} />
      <ellipse cx="128" cy="78" rx="78" ry="13" fill={WITCH} {...ink} />
      <path
        className="no-edge"
        d="M128 60 L131 67 L138 67 L132 71 L135 78 L128 73 L121 78 L124 71 L118 67 L125 67 Z"
        fill={NYU.star}
        stroke={NYU.ink}
        strokeWidth={3}
      />
    </g>
  );
}

function Santa() {
  return (
    <g>
      <path
        d="M78 72 Q86 18 140 10 Q186 6 204 50 Q210 66 206 84 L186 80 Q186 56 168 44 L176 72 Z"
        fill={SANTA}
        {...ink}
      />
      <circle cx="200" cy="90" r="15" fill={NYU.paper} {...ink} />
      <rect x="66" y="62" width="124" height="26" rx="13" fill={NYU.paper} {...ink} />
    </g>
  );
}

function Party() {
  return (
    <g transform="rotate(10 128 70)">
      <path d="M96 78 L128 -6 L160 78 Q128 88 96 78 Z" fill={NYU.mint} {...ink} />
      <g className="no-edge" fill="none" stroke={NYU.body} strokeWidth={8}>
        <path d="M112 38 Q128 44 144 38" />
        <path d="M104 60 Q128 68 152 60" />
      </g>
      <circle cx="128" cy="-8" r="11" fill={NYU.star} {...ink} />
    </g>
  );
}

/** Behind the page: the ears stand up from behind her head, between her own. */
function BunnyBehind() {
  return (
    <g>
      <g transform="rotate(-10 112 80)">
        <path d="M100 84 Q92 10 112 -14 Q132 10 124 84 Z" fill={NYU.paper} {...ink} />
        <path className="no-edge" d="M106 70 Q102 20 112 4 Q122 20 118 70 Z" fill={NYU.flap} />
      </g>
      <g transform="rotate(10 144 80)">
        <path d="M132 84 Q124 10 144 -14 Q164 10 156 84 Z" fill={NYU.paper} {...ink} />
        <path className="no-edge" d="M138 70 Q134 20 144 4 Q154 20 150 70 Z" fill={NYU.flap} />
      </g>
    </g>
  );
}

function BunnyFront() {
  // A headband, so the ears read as worn rather than grown.
  return <path d="M92 80 Q128 62 164 80" fill="none" stroke={NYU.lilac} strokeWidth={10} />;
}

function Nightcap() {
  return (
    <g>
      <path
        d="M74 74 Q84 18 140 12 Q196 10 220 60 Q230 84 222 112 L204 104 Q206 70 184 52 Q192 66 186 74 Z"
        fill={NYU.sky}
        {...ink}
      />
      <g className="no-edge" fill="none" stroke={NYU.paper} strokeWidth={7}>
        <path d="M100 44 Q130 34 164 40" />
      </g>
      <circle cx="216" cy="118" r="13" fill={NYU.star} {...ink} />
      <rect x="64" y="62" width="128" height="24" rx="12" fill={NYU.lilac} {...ink} />
    </g>
  );
}

function Bow() {
  return (
    <g transform="translate(176 82) rotate(-14)">
      <path d="M0 0 L-30 -18 Q-38 0 -30 18 Z" fill={NYU.blushSolid} {...ink} />
      <path d="M0 0 L30 -18 Q38 0 30 18 Z" fill={NYU.blushSolid} {...ink} />
      <circle cx="0" cy="0" r="9" fill={NYU.body} {...ink} />
    </g>
  );
}

function Glasses({ dark = false }: { dark?: boolean }) {
  const lens = dark ? { fill: NYU.ink, fillOpacity: 0.9 } : { fill: NYU.sky, fillOpacity: 0.35 };
  // Written around the eyes' own coordinates, so `Face` carries them along.
  return (
    <Face>
      <path d="M124 148 Q128 142 132 148" fill="none" stroke={NYU.ink} strokeWidth={6} />
      <circle cx="102" cy="148" r="21" {...lens} stroke={NYU.ink} strokeWidth={6} />
      <circle cx="154" cy="148" r="21" {...lens} stroke={NYU.ink} strokeWidth={6} />
      <path d="M81 144 L52 138 M175 144 L204 138" stroke={NYU.ink} strokeWidth={6} />
      {dark ? (
        <g className="no-edge" fill="none" stroke={NYU.paper} strokeWidth={4}>
          <path d="M90 140 l8 -6" />
          <path d="M142 140 l8 -6" />
        </g>
      ) : null}
    </Face>
  );
}

function Flower() {
  const petals = [0, 72, 144, 216, 288];
  return (
    <g transform="translate(70 84)">
      {petals.map((angle) => (
        <ellipse
          key={angle}
          cx="0"
          cy="-14"
          rx="9"
          ry="13"
          transform={`rotate(${angle})`}
          fill={NYU.paper}
          stroke={NYU.ink}
          strokeWidth={5}
        />
      ))}
      <circle cx="0" cy="0" r="8" fill={NYU.star} stroke={NYU.ink} strokeWidth={5} />
    </g>
  );
}

function Headphones() {
  return (
    <g>
      <path
        d="M36 128 Q30 20 128 18 Q226 20 220 128"
        fill="none"
        stroke={NYU.ink}
        strokeWidth={14}
      />
      <path
        className="no-edge"
        d="M36 128 Q30 20 128 18 Q226 20 220 128"
        fill="none"
        stroke={NYU.violet}
        strokeWidth={6}
      />
      <rect x="14" y="110" width="30" height="50" rx="12" fill={NYU.violet} {...ink} />
      <rect x="212" y="110" width="30" height="50" rx="12" fill={NYU.violet} {...ink} />
    </g>
  );
}

function Beret() {
  return (
    <g transform="rotate(-8 128 64)">
      <path
        d="M70 76 Q66 36 128 32 Q192 34 190 70 Q160 84 70 76 Z"
        fill={NYU.blushSolid}
        {...ink}
      />
      <path d="M124 32 l2 -12" stroke={NYU.ink} strokeWidth={8} />
    </g>
  );
}

function Crown() {
  return (
    <g>
      <path d="M90 76 L84 26 L108 48 L128 14 L148 48 L172 26 L166 76 Z" fill={NYU.star} {...ink} />
      <g className="no-edge" stroke={NYU.ink} strokeWidth={3}>
        <circle cx="128" cy="60" r="7" fill={NYU.blushSolid} />
        <circle cx="104" cy="64" r="5" fill={NYU.sky} />
        <circle cx="152" cy="64" r="5" fill={NYU.mint} />
      </g>
    </g>
  );
}

/** What a hat adds behind the page and in front of it. */
export function hatParts(hat: HatId | null | undefined): { behind?: ReactNode; front?: ReactNode } {
  switch (hat) {
    case 'witch':
      return { front: <Witch /> };
    case 'santa':
      return { front: <Santa /> };
    case 'party':
      return { front: <Party /> };
    case 'bunny':
      return { behind: <BunnyBehind />, front: <BunnyFront /> };
    case 'nightcap':
      return { front: <Nightcap /> };
    case 'bow':
      return { front: <Bow /> };
    case 'glasses':
      return { front: <Glasses /> };
    case 'sunglasses':
      return { front: <Glasses dark /> };
    case 'flower':
      return { front: <Flower /> };
    case 'headphones':
      return { front: <Headphones /> };
    case 'beret':
      return { front: <Beret /> };
    case 'crown':
      return { front: <Crown /> };
    default:
      return {};
  }
}

/** Two optional parts into one, for a scene that already has a paw in `front`. */
export function withHat(
  hat: HatId | null | undefined,
  parts: { behind?: ReactNode; front?: ReactNode } = {},
): { behind?: ReactNode; front?: ReactNode } {
  const worn = hatParts(hat);
  return {
    behind:
      worn.behind || parts.behind ? (
        <>
          {worn.behind}
          {parts.behind}
        </>
      ) : undefined,
    front:
      worn.front || parts.front ? (
        <>
          {parts.front}
          {worn.front}
        </>
      ) : undefined,
  };
}
