/**
 * Where the cameos appear. Mounted once in `App.tsx`; draws nothing until
 * `lib/nyu-cameo.ts` has one to show, and loads the drawings only then (or a
 * little earlier, while the browser is idle).
 *
 * The stage never takes a click and never moves the layout: it is fixed,
 * `pointer-events: none`, and gone after a few seconds. It also gets out of
 * the way by itself when animations are switched off mid-cameo or zen mode
 * begins — `lib/nyu.ts` checks both before a cameo starts, this checks them
 * while it plays.
 */

import { lazy, Suspense, useEffect, type CSSProperties } from 'react';
import { clearCameo, useCameo } from '../../../lib/nyu-cameo';
import { useSettings } from '../../../lib/settings';
import './cameos.css';

const loadScenes = () => import('./CameoScenes');
const CameoScene = lazy(loadScenes);

export function NyuCameos() {
  const cameo = useCameo();
  const settings = useSettings();

  // Fetched while idle, so the first cameo does not wait for its drawings.
  useEffect(() => {
    if (!settings.nyuGimmicks) return;
    const preload = () => void loadScenes().catch(() => undefined);
    // WebKitGTK (Linux) has no requestIdleCallback; a plain delay does the job there.
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(preload, { timeout: 30_000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = setTimeout(preload, 5_000);
    return () => clearTimeout(timer);
  }, [settings.nyuGimmicks]);

  // Animations switched off while she is on stage: she leaves at once.
  useEffect(() => {
    if (!cameo) return;
    if (settings.motion === 'off' || !settings.nyuGimmicks) clearCameo();
  }, [cameo, settings.motion, settings.nyuGimmicks]);

  if (!cameo) return null;
  return (
    <div
      key={cameo.id}
      className="nyu-cameo"
      data-cameo={cameo.name}
      data-edge={cameo.name === 'peek' ? cameo.edge : undefined}
      style={
        {
          '--nyu-cameo-ms': `${cameo.duration}ms`,
          '--nyu-cameo-along': String(cameo.along),
        } as CSSProperties
      }
      aria-hidden
    >
      <div className="nyu-cameo-inner">
        <Suspense fallback={null}>
          <CameoScene name={cameo.name} hat={cameo.hat} />
        </Suspense>
      </div>
    </div>
  );
}
