/**
 * The cameos' drawings, loaded lazily by `NyuCameos` the first time one plays.
 *
 * Each scene is on the shared 320 × 220 canvas with Nyu at roughly half size,
 * like UwUMail's cameos. The resting state of every part is the picture that
 * tells the story; `cameos.css` moves the parts and brings them back. All of
 * them are decorative (`aria-hidden` on the stage) and say nothing.
 */

import type { CSSProperties, ReactNode } from 'react';
import type { CameoName } from '../../../lib/nyu-cameo';
import { withHat, type HatId } from '../hats';
import { NYU, NyuFigure, Paw, Sticker } from '../Nyu';
import { Bat, BlackCat, Cake, Egg, Moon, Snowflake, Tomato } from '../props';
import { Heart, Shadow, Star } from '../scenes';

type SceneProps = { hat: HatId | null };

const EDGE = 30;

/** Nyu's pupils, wrapped so CSS can make her look left and right. */
const LOOKING = (
  <g className="nyu-cameo-look">
    <g fill={NYU.outline}>
      <ellipse cx="102" cy="148" rx="8" ry="10" />
      <ellipse cx="154" cy="148" rx="8" ry="10" />
    </g>
    <g fill={NYU.paper}>
      <circle cx="105" cy="144" r="3" />
      <circle cx="157" cy="144" r="3" />
    </g>
  </g>
);

function Peek({ hat }: SceneProps) {
  return (
    <>
      <NyuFigure
        mood="happy"
        x={160}
        y={150}
        scale={0.62}
        edge={EDGE}
        eyes={LOOKING}
        {...withHat(hat, {
          front: (
            <>
              <Paw x={76} y={232} />
              <Paw x={180} y={232} />
            </>
          ),
        })}
      />
    </>
  );
}

function BatScene() {
  return (
    <Sticker edge={10}>
      <Bat x={160} y={110} size={1.4} />
    </Sticker>
  );
}

function BlackCatScene() {
  return (
    <Sticker edge={10}>
      <BlackCat x={160} y={150} size={1.3} />
    </Sticker>
  );
}

const CONFETTI: [x: number, y: number, rotate: number, fill: string][] = [
  [52, 50, -20, NYU.body],
  [92, 20, 30, NYU.star],
  [128, 36, 70, NYU.mint],
  [200, 24, -40, NYU.lilac],
  [240, 42, 15, NYU.body],
  [276, 18, 60, NYU.sky],
  [36, 110, 45, NYU.sky],
  [290, 104, -30, NYU.star],
];

function Confetti() {
  return (
    <g className="nyu-cameo-confetti">
      {CONFETTI.map(([x, y, rotate, fill]) => (
        <g
          key={`${x}-${y}`}
          style={{ '--dx': `${160 - x}px`, '--dy': `${120 - y}px` } as CSSProperties}
        >
          <rect
            x={x - 7}
            y={y - 4}
            width="14"
            height="8"
            rx="2"
            transform={`rotate(${rotate} ${x} ${y})`}
            fill={fill}
            stroke={NYU.outline}
            strokeWidth={3}
          />
        </g>
      ))}
    </g>
  );
}

function Party() {
  return (
    <>
      <Shadow cx={160} rx={70} />
      <Confetti />
      <g className="nyu-cameo-dance">
        <NyuFigure
          mood="cheer"
          x={160}
          y={128}
          scale={0.55}
          edge={EDGE}
          {...withHat('party', {
            front: (
              <>
                <Paw x={20} y={150} className="nyu-cameo-paw-l" />
                <Paw x={236} y={150} className="nyu-cameo-paw-r" />
              </>
            ),
          })}
        />
      </g>
    </>
  );
}

function Burst({ x, y, color, delay }: { x: number; y: number; color: string; delay: number }) {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <g
      className="nyu-cameo-firework"
      style={{ animationDelay: `${delay}ms`, transformOrigin: `${x}px ${y}px` } as CSSProperties}
    >
      {rays.map((angle) => (
        <path
          key={angle}
          d={`M${x} ${y} m0 -12 v-16`}
          transform={`rotate(${angle} ${x} ${y})`}
          stroke={color}
          strokeWidth={6}
        />
      ))}
      <circle cx={x} cy={y} r="5" fill={NYU.star} />
    </g>
  );
}

function Fireworks({ hat }: SceneProps) {
  return (
    <>
      <Shadow cx={160} rx={70} />
      <Burst x={70} y={50} color={NYU.body} delay={0} />
      <Burst x={250} y={40} color={NYU.sky} delay={500} />
      <Burst x={160} y={22} color={NYU.mint} delay={1000} />
      <NyuFigure
        mood="sparkle"
        x={160}
        y={140}
        scale={0.5}
        edge={EDGE}
        {...withHat(hat ?? 'party')}
      />
    </>
  );
}

function Birthday({ hat }: SceneProps) {
  return (
    <>
      <Shadow cx={160} rx={90} />
      <Confetti />
      <g className="nyu-cameo-hop">
        <NyuFigure
          mood="cheer"
          x={130}
          y={130}
          scale={0.5}
          edge={EDGE}
          {...withHat(hat ?? 'party')}
        />
      </g>
      <Sticker edge={14}>
        <Cake x={238} y={178} size={1.1} />
      </Sticker>
    </>
  );
}

const FLAKES: [x: number, y: number, delay: number][] = [
  [60, 20, 0],
  [120, 0, 400],
  [210, 10, 200],
  [270, 30, 700],
  [90, 60, 900],
  [240, 70, 1200],
];

function Snow({ hat }: SceneProps) {
  return (
    <>
      <Shadow cx={160} rx={70} />
      <NyuFigure mood="uwu" x={160} y={136} scale={0.52} edge={EDGE} {...withHat(hat ?? 'santa')} />
      {FLAKES.map(([x, y, delay]) => (
        <g key={`${x}-${y}`} className="nyu-cameo-flake" style={{ animationDelay: `${delay}ms` }}>
          <Snowflake x={x} y={y} size={0.7} />
        </g>
      ))}
    </>
  );
}

function Hearts({ hat }: SceneProps) {
  const hearts: [number, number, number, string, number][] = [
    [232, 62, 0.9, NYU.body, 0],
    [90, 70, 0.7, NYU.blush, 200],
    [264, 112, 0.65, NYU.lilac, 400],
    [64, 128, 0.6, NYU.body, 600],
  ];
  return (
    <>
      <Shadow cx={160} rx={70} />
      <g className="nyu-cameo-squish">
        <NyuFigure mood="uwu" x={160} y={132} scale={0.52} edge={EDGE} {...withHat(hat)} />
      </g>
      {hearts.map(([x, y, size, fill, delay]) => (
        <g key={x} className="nyu-cameo-heart" style={{ animationDelay: `${delay}ms` }}>
          <Sticker edge={10}>
            <Heart x={x} y={y} size={size} fill={fill} />
          </Sticker>
        </g>
      ))}
    </>
  );
}

function Easter({ hat }: SceneProps) {
  return (
    <>
      <Shadow cx={160} rx={90} />
      <g className="nyu-cameo-hop">
        <NyuFigure
          mood="happy"
          x={140}
          y={130}
          scale={0.5}
          edge={EDGE}
          {...withHat(hat ?? 'bunny')}
        />
      </g>
      <Sticker edge={14}>
        <Egg x={240} y={180} size={1.1} rotate={12} />
      </Sticker>
    </>
  );
}

function Night({ hat }: SceneProps) {
  return (
    <>
      <Shadow cx={160} rx={70} />
      <Sticker edge={12}>
        <Moon x={262} y={48} size={1} />
        <Star x={52} y={40} r={8} />
        <Star x={210} y={26} r={6} />
      </Sticker>
      <g className="nyu-cameo-sway">
        <NyuFigure
          mood="sleepy"
          x={150}
          y={136}
          scale={0.52}
          tilt={-6}
          edge={EDGE}
          {...withHat(hat ?? 'nightcap')}
        />
      </g>
      <g className="nyu-cameo-zzz" fill="none" stroke={NYU.violet} strokeWidth={5}>
        <path d="M224 92 h12 l-12 12 h12" />
        <path d="M246 62 h16 l-16 16 h16" />
      </g>
    </>
  );
}

function TomatoScene({ hat }: SceneProps) {
  return (
    <>
      <Shadow cx={160} rx={80} />
      <g className="nyu-cameo-hop">
        <NyuFigure
          mood="cheer"
          x={136}
          y={132}
          scale={0.5}
          edge={EDGE}
          {...withHat(hat, { front: <Paw x={250} y={150} /> })}
        />
      </g>
      <g className="nyu-cameo-raise">
        <Sticker edge={12}>
          <Tomato x={236} y={86} size={1.1} />
        </Sticker>
      </g>
      <g className="nyu-cameo-twinkle">
        <Sticker edge={10}>
          <Star x={282} y={50} r={9} />
          <Star x={196} y={40} r={6} />
        </Sticker>
      </g>
    </>
  );
}

const SCENES: Record<CameoName, (props: SceneProps) => ReactNode> = {
  peek: Peek,
  bat: BatScene,
  blackcat: BlackCatScene,
  party: Party,
  fireworks: Fireworks,
  birthday: Birthday,
  snow: Snow,
  hearts: Hearts,
  easter: Easter,
  night: Night,
  tomato: TomatoScene,
};

export default function CameoScene({ name, hat }: { name: CameoName; hat: HatId | null }) {
  const Scene = SCENES[name];
  return (
    <svg
      viewBox="-10 -10 340 230"
      className="nyu-host nyu-cameo-svg"
      style={{ overflow: 'visible' }}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      <Scene hat={hat} />
    </svg>
  );
}
