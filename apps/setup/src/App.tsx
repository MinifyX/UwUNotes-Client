/**
 * The setup, as one window.
 *
 * There is no wizard here. The window says what it is about to do and where it
 * will put it, offers the two things worth offering — the folder and a desktop
 * shortcut — and then has one button. After that it shows what it is doing, and
 * finally either "start UwUNotes now" or what went wrong.
 *
 * Two things are worth knowing before changing anything in here.
 *
 * **Update mode is not a silent mode.** An update the editor itself hands over
 * never reaches this page at all: `app.rs` installs and exits without ever
 * starting Tauri, precisely so nobody is left looking for a window behind an
 * editor that has already closed. So a page that sees `mode: 'update'` has a
 * person in front of it who double-clicked the setup, and that person gets the
 * same one button as everybody else rather than an install that starts on its
 * own. `silent` is honoured anyway, for the day that changes.
 *
 * **Failures are plain.** `scenes.tsx` has a drawing for it and `texts.ts` has
 * the words, and neither is funny. The rule is the editor's: Nyu may be pleased
 * when something worked, and says nothing clever when it did not.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Nyu } from '../../desktop/src/components/nyu/Nyu';
import {
  api,
  toSetupError,
  type InstallOptions,
  type Installed,
  type Progress,
  type SetupError,
  type SetupState,
} from './api';
import {
  DoneScene,
  FailedScene,
  GoodbyeScene,
  UninstallScene,
  WaitingScene,
  WorkingScene,
} from './scenes';
import { chirp } from './sound';
import { fill, texts as t } from './texts';

type Screen = 'loading' | 'ready' | 'working' | 'done' | 'failed';
type Job = 'install' | 'uninstall';

const PROJECT = 'https://github.com/MinifyX/UwUNotes-Client';

/**
 * Long enough to see that something happened. Unpacking six megabytes onto an
 * SSD is over before the eye catches up, and a progress bar that appears and
 * vanishes in one frame reads as a glitch rather than as work.
 */
const MIN_WORKING_MS = 1600;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ICONS = {
  minimize: 'M0 5.5h10',
  close: 'M.5.5l9 9 M9.5.5l-9 9',
  soundOn: 'M1 4h2l3-2.5v7L3 6H1z M7.5 3.5a2.6 2.6 0 0 1 0 3 M9 2a4.6 4.6 0 0 1 0 6',
  soundOff: 'M1 4h2l3-2.5v7L3 6H1z M7.5 3.5l3 3 M10.5 3.5l-3 3',
};

function ControlIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 10 10" aria-hidden focusable="false" stroke="currentColor" fill="none">
      <path d={path} />
    </svg>
  );
}

/** The title bar, which is also the window frame: `decorations: false`. */
function TitleBar({
  busy,
  muted,
  onToggleSound,
}: {
  busy: boolean;
  muted: boolean;
  onToggleSound: () => void;
}) {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <span className="titlebar-brand" data-tauri-drag-region>
        <Nyu size={20} blink={false} title="UwUNotes" />
        <span className="titlebar-wordmark" data-tauri-drag-region>
          <span>UwU</span>Notes
        </span>
      </span>
      <span className="titlebar-spacer" data-tauri-drag-region />
      <div className="window-controls">
        {/* Labelled with what pressing it does, not with where it stands: a
            tooltip that reads "sound on" while the sound is on helps nobody. */}
        <button
          type="button"
          className={muted ? 'window-control window-control-muted' : 'window-control'}
          onClick={onToggleSound}
          aria-label={muted ? t.soundOn : t.soundOff}
          title={muted ? t.soundOn : t.soundOff}
        >
          <ControlIcon path={muted ? ICONS.soundOff : ICONS.soundOn} />
        </button>
        <button
          type="button"
          className="window-control"
          onClick={() => void api.minimize()}
          aria-label={t.minimize}
          title={t.minimize}
        >
          <ControlIcon path={ICONS.minimize} />
        </button>
        <button
          type="button"
          className="window-control window-control-close"
          // Closing mid-install would leave half an editor on the disk.
          disabled={busy}
          onClick={() => void api.close()}
          aria-label={t.close}
          title={t.close}
        >
          <ControlIcon path={ICONS.close} />
        </button>
      </div>
    </header>
  );
}

/** Nyu, a headline and at most one sentence. Every screen opens with one. */
function Stage({ scene, title, body }: { scene: ReactNode; title: string; body?: string }) {
  return (
    <div className="stage setup-fade">
      {scene}
      <h1 className="stage-title">{title}</h1>
      {body ? <p className="stage-body">{body}</p> : null}
    </div>
  );
}

/**
 * What the first screen says. `installedVersion` is only ever missing when
 * something unreadable is installed, and `app.rs` calls that a reinstall — so
 * the two lines that name it are never the ones with nothing to name.
 */
function headline(state: SetupState): { title: string; body: string } {
  const version = state.setupVersion;
  const installed = state.installedVersion ?? '';
  switch (state.mode) {
    case 'update':
      return {
        title: fill(t.updateTitle, { version }),
        body: fill(t.updateBody, { installed, version }),
      };
    case 'reinstall':
      return { title: t.reinstallTitle, body: fill(t.reinstallBody, { version }) };
    case 'downgrade':
      return {
        title: t.downgradeTitle,
        body: fill(t.downgradeBody, { installed, version }),
      };
    case 'uninstall':
      return { title: t.uninstallTitle, body: t.uninstallBody };
    case 'install':
      return { title: t.installTitle, body: t.installBody };
  }
}

function actionLabel(state: SetupState): string {
  switch (state.mode) {
    case 'update':
      return t.actionUpdate;
    case 'reinstall':
      return t.actionReinstall;
    case 'downgrade':
      return t.actionDowngrade;
    case 'uninstall':
      return t.actionUninstall;
    case 'install':
      return t.actionInstall;
  }
}

export function App() {
  const [state, setState] = useState<SetupState | null>(null);
  const [screen, setScreen] = useState<Screen>('loading');
  const [job, setJob] = useState<Job>('install');
  const [folder, setFolder] = useState('');
  const [desktopShortcut, setDesktopShortcut] = useState(true);
  const [keepSettings, setKeepSettings] = useState(true);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [shown, setShown] = useState(0);
  const [installed, setInstalled] = useState<Installed | null>(null);
  const [failure, setFailure] = useState<SetupError | null>(null);
  const [muted, setMuted] = useState(false);

  // The chirp is played from inside a job that started long before the toggle
  // was last touched, so it reads the current value rather than a captured one.
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  const started = useRef(false);

  const run = async (kind: Job, options: InstallOptions, keep: boolean, silent: boolean) => {
    setJob(kind);
    setProgress(null);
    setShown(0);
    setFailure(null);
    setScreen('working');
    const begin = Date.now();
    try {
      if (kind === 'uninstall') {
        await api.uninstall(keep);
        setInstalled(null);
      } else {
        setInstalled(await api.install(options, setProgress));
      }
      await wait(Math.max(0, MIN_WORKING_MS - (Date.now() - begin)));
      setProgress({ step: 'done', percent: 100 });
      await wait(320);
      setScreen('done');
      if (!mutedRef.current) chirp();
      // Only a run nobody is watching closes itself; everyone else presses the
      // button that starts the editor, or the one that does not.
      if (silent) {
        await wait(900);
        await api.close();
      }
    } catch (reason) {
      setFailure(toSetupError(reason));
      setScreen('failed');
    }
  };
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    let gone = false;
    void api
      .state()
      .then((loaded) => {
        if (gone) return;
        setState(loaded);
        setFolder(loaded.defaultFolder);
        setDesktopShortcut(loaded.desktopShortcut);
        setScreen('ready');
        // No window is ever built for a silent run, so this is unreachable
        // today. It stays because the alternative — a page that assumes it is
        // being looked at — is the failure nobody would find until it shipped.
        // Strict mode runs effects twice in development; start once.
        if (loaded.silent && !started.current) {
          started.current = true;
          void runRef.current(
            'install',
            {
              folder: loaded.defaultFolder,
              desktopShortcut: loaded.desktopShortcut,
              launchWhenDone: true,
            },
            true,
            true,
          );
        }
      })
      .catch((reason: unknown) => {
        if (gone) return;
        setFailure(toSetupError(reason));
        setScreen('failed');
      });
    return () => {
      gone = true;
    };
  }, []);

  // Glide towards the reported percentage instead of jumping between steps.
  useEffect(() => {
    const target = progress?.percent ?? 0;
    let frame = 0;
    const tick = () => {
      setShown((current) => {
        const next = current + (target - current) * 0.16;
        return Math.abs(target - next) < 0.4 ? target : next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [progress]);

  const busy = screen === 'working';
  const shell = (content: ReactNode) => (
    <div className="setup">
      <TitleBar busy={busy} muted={muted} onToggleSound={() => setMuted(!muted)} />
      <main className="setup-main">{content}</main>
    </div>
  );

  if (!state || screen === 'loading') return shell(null);

  const uninstalling = state.mode === 'uninstall';
  const options: InstallOptions = {
    folder: folder.trim(),
    desktopShortcut,
    // False on purpose: the finish screen has its own button, and starting the
    // editor while the user is still reading would take the window away.
    launchWhenDone: false,
  };
  const start = () =>
    void run(uninstalling ? 'uninstall' : 'install', options, keepSettings, false);

  if (screen === 'ready') {
    const { title, body } = headline(state);
    return shell(
      <>
        <Stage
          scene={uninstalling ? <UninstallScene /> : <WaitingScene />}
          title={title}
          body={body}
        />
        <div className="card setup-fade">
          <label className="field">
            <span className="field-label">{t.folder}</span>
            {uninstalling ? (
              <span className="field-static" title={state.defaultFolder}>
                {state.defaultFolder}
              </span>
            ) : (
              <input
                className="field-input"
                type="text"
                spellCheck={false}
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
              />
            )}
          </label>
          {uninstalling ? (
            <label className="check">
              <input
                type="checkbox"
                checked={keepSettings}
                onChange={(event) => setKeepSettings(event.target.checked)}
              />
              <span>
                {t.keepSettings}
                <span className="check-hint">{t.keepSettingsHint}</span>
              </span>
            </label>
          ) : (
            <label className="check">
              <input
                type="checkbox"
                checked={desktopShortcut}
                onChange={(event) => setDesktopShortcut(event.target.checked)}
              />
              <span>
                {t.desktopShortcut}
                <span className="check-hint">{t.desktopShortcutHint}</span>
              </span>
            </label>
          )}
        </div>
        <div className="actions">
          {uninstalling ? (
            <button type="button" className="button-quiet" onClick={() => void api.close()}>
              {t.keep}
            </button>
          ) : null}
          <button
            type="button"
            className="button-primary"
            autoFocus
            disabled={!state.hasPayload || (!uninstalling && options.folder === '')}
            onClick={start}
          >
            {actionLabel(state)}
          </button>
        </div>
        <p className="footer">
          {!state.hasPayload ? (
            t.devBuild
          ) : (
            <>
              {fill(t.footer, { version: state.setupVersion })}
              <span className="footer-dot">·</span>
              <button
                type="button"
                className="footer-link"
                onClick={() => void api.openExternal(PROJECT)}
              >
                {t.project}
              </button>
            </>
          )}
        </p>
      </>,
    );
  }

  if (screen === 'working') {
    const percent = Math.round(shown);
    const step = progress?.step ?? 'preparing';
    return shell(
      <>
        <Stage
          scene={<WorkingScene />}
          title={
            job === 'uninstall'
              ? t.workingUninstall
              : state.mode === 'update'
                ? t.workingUpdate
                : t.workingInstall
          }
        />
        <div className="progress">
          <div
            className="bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span className="bar-fill" style={{ width: `${Math.max(2, percent)}%` }} />
          </div>
          <p className="progress-line">
            <span>{t.steps[step]}</span>
            <span className="progress-percent">{percent} %</span>
          </p>
        </div>
      </>,
    );
  }

  if (screen === 'done') {
    if (job === 'uninstall') {
      return shell(
        <>
          <Stage scene={<GoodbyeScene />} title={t.goodbyeTitle} body={t.goodbyeBody} />
          <div className="actions">
            <button
              type="button"
              className="button-primary"
              autoFocus
              onClick={() => void api.close()}
            >
              {t.close}
            </button>
          </div>
        </>,
      );
    }
    const updated = state.mode === 'update';
    return shell(
      <>
        <Stage
          scene={<DoneScene />}
          title={updated ? t.updateDoneTitle : t.doneTitle}
          body={
            updated
              ? fill(t.updateDoneBody, { version: state.setupVersion })
              : fill(t.doneBody, { folder: installed?.folder ?? options.folder })
          }
        />
        <div className="actions">
          <button type="button" className="button-quiet" onClick={() => void api.close()}>
            {t.close}
          </button>
          <button
            type="button"
            className="button-primary"
            autoFocus
            onClick={() =>
              void (async () => {
                await api.launchApp().catch(() => undefined);
                await api.close();
              })()
            }
          >
            {t.start}
          </button>
        </div>
      </>,
    );
  }

  const error = failure ?? { kind: 'other' as const, message: '' };
  return shell(
    <>
      <Stage
        scene={<FailedScene />}
        title={t.errorTitles[error.kind]}
        body={t.errorBodies[error.kind]}
      />
      {/* English and technical, straight from the engine: the sentence above is
          for the user, this line is for whoever they forward it to. */}
      {error.message ? <p className="error-message">{error.message}</p> : null}
      <div className="actions">
        <button type="button" className="button-quiet" onClick={() => void api.close()}>
          {t.close}
        </button>
        <button
          type="button"
          className="button-primary"
          autoFocus
          disabled={error.kind === 'noPayload'}
          onClick={() => void run(job, options, keepSettings, false)}
        >
          {t.retry}
        </button>
      </div>
    </>,
  );
}
