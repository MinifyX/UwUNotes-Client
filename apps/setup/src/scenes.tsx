/**
 * The pictures of Nyu the setup shows, one per thing that can be happening.
 *
 * Nyu herself, her props and her stylesheet are imported straight out of the
 * editor's source tree — `apps/desktop/src/components/nyu` is written to depend
 * on nothing but React, exactly so an installer can use it. A second copy of
 * the cat in here would be a cat that slowly stops looking like the app's.
 *
 * Same 320 × 220 canvas as the editor's own scenes and UwUSSH's, so she stands
 * the same size in all three. Everything here is decorative and carries
 * `aria-hidden`: the sentence beside the picture is the message.
 *
 * What this module deliberately does not do: put a joke in front of a failure.
 * `Failed` is Nyu, a shadow and nothing else — no stars, no hopping, no props
 * with faces on them. A user whose disk is full is not the audience for a gag.
 */

import type { ReactNode } from 'react';
import { NYU, NyuFigure, Paw, Sticker } from '../../desktop/src/components/nyu/Nyu';
import {
  Heart,
  Notebook,
  NyuScene,
  Shadow,
  Sheet,
  Star,
} from '../../desktop/src/components/nyu/scenes';

/** Props are drawn at scene scale: a 6 px outline and an 18 px die-cut edge. */
const S = { stroke: NYU.outline, strokeWidth: 6 } as const;
const EDGE = 18;
/** Nyu's own edge at scene scale: 30 × 0.6 ≈ the props' 18 px. */
const NYU_EDGE = 30;

function Canvas({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="-10 -10 340 230"
      className="nyu-host nyu-blink setup-scene"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

/**
 * The open carton the editor goes into. Drawn the same way as the one in
 * UwUSSH's installer on purpose: the two setups are siblings, and a user who
 * has seen one should recognise the other.
 */
function Carton() {
  return (
    <>
      <path d="M206 134 L178 116 L190 102 L226 134Z" fill={NYU.kraftLight} {...S} />
      <path d="M290 134 L318 116 L306 102 L270 134Z" fill={NYU.kraftLight} {...S} />
      <path d="M200 134 H296 L288 200 H208Z" fill={NYU.kraft} {...S} />
    </>
  );
}

/**
 * Waiting to be told to go: the editor's own start-up scene, where Nyu waves
 * and is already writing on something. Reused rather than redrawn — it is the
 * same moment, and one picture that cannot drift beats two that can.
 */
export function WaitingScene() {
  return <NyuScene name="startup" className="setup-scene" />;
}

/** Working: Nyu hops and tosses pages into the box, over and over. */
export function WorkingScene() {
  return (
    <Canvas>
      <Shadow cx={150} rx={118} />
      <Sticker edge={EDGE}>
        <Carton />
      </Sticker>
      {[0, 1, 2].map((index) => (
        <g key={index} className="setup-toss" style={{ animationDelay: `${index * 0.55}s` }}>
          <Sticker edge={12}>
            <Sheet x={118} y={96} rotate={-12} size={0.5} />
          </Sticker>
        </g>
      ))}
      <g className="setup-hop">
        <NyuFigure
          mood="happy"
          x={88}
          y={138}
          scale={0.56}
          tilt={-4}
          edge={NYU_EDGE}
          front={<Paw x={232} y={108} />}
        />
      </g>
    </Canvas>
  );
}

/** Installed: Nyu is pleased about it, and says so with her whole face. */
export function DoneScene() {
  return (
    <div className="setup-pop">
      <Canvas>
        <Shadow cx={158} rx={98} />
        <Sticker edge={EDGE}>
          <Notebook x={160} y={184} rotate={-2} />
        </Sticker>
        <NyuFigure mood="cheer" x={156} y={122} scale={0.58} tilt={-3} edge={NYU_EDGE} />
        <Sticker edge={12}>
          <Star x={46} y={58} r={11} className="nyu-twinkle" />
          <Star x={278} y={44} r={9} className="nyu-twinkle" />
          <Heart x={268} y={140} size={0.7} fill={NYU.lilac} />
        </Sticker>
      </Canvas>
    </div>
  );
}

/** Something went wrong. Nyu is sorry, and that is the entire performance. */
export function FailedScene() {
  return (
    <Canvas>
      <Shadow cx={158} rx={92} />
      <Sticker edge={EDGE}>
        <Sheet x={268} y={168} rotate={14} size={0.7} />
      </Sticker>
      <NyuFigure mood="sad" x={150} y={124} scale={0.58} tilt={2} edge={NYU_EDGE} />
    </Canvas>
  );
}

/** About to be removed: everything packed up, Nyu not sure what to make of it. */
export function UninstallScene() {
  return (
    <Canvas>
      <Shadow cx={158} rx={104} />
      <Sticker edge={EDGE}>
        <Carton />
        <Notebook x={248} y={128} rotate={-6} size={0.52} />
      </Sticker>
      <NyuFigure mood="puzzled" x={96} y={126} scale={0.56} tilt={-3} edge={NYU_EDGE} />
    </Canvas>
  );
}

/** Removed. One wave on the way out, nothing else. */
export function GoodbyeScene() {
  return (
    <Canvas>
      <Shadow cx={152} rx={92} />
      <NyuFigure
        mood="sad"
        x={150}
        y={124}
        scale={0.58}
        tilt={-4}
        edge={NYU_EDGE}
        front={<Paw x={238} y={104} className="nyu-wave" />}
      />
    </Canvas>
  );
}
