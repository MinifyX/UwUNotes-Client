/**
 * The Nyu-Zentrale: everything about Nyu on one page, in tabs.
 *
 * - **Übersicht** — her level, the XP bar and what you have written together.
 * - **Erfolge** — every achievement: unlocked with the day, open ones greyed
 *   with how to get them, the secret ones as "???" until found.
 * - **Garderobe** — what she wears, and the occasions she has been around for.
 * - **Pomodoro** — the timer with its buttons, and how many rounds so far.
 * - **Geheimnisse** — the easter eggs, found or teased.
 * - **Einstellungen** — her switches, the same keys as Settings → Nyu.
 *
 * Opened from the Nyu menu (which can land on a tab: `lib/nyu-page.ts`), the
 * palette, Settings → Nyu, and by double-clicking the companion. Everything
 * shown is local (`lib/nyu-progress.ts`) and nothing here sends anything
 * anywhere.
 *
 * With levels switched off the page still offers the hats she already has —
 * taking a crown away because somebody turned off the counting would be mean —
 * but shows no level, no XP and no achievements.
 */

import { Button, Switch as SuiteSwitch } from '@uwusuite/design';
import { useId, useMemo, useRef, type ReactNode } from 'react';
import {
  closeDialog,
  NYU_SWITCHES,
  openDialog,
  runCommand,
  useUiState,
} from '../../../lib/commands';
import { language, N_, t, useLanguage } from '../../../lib/i18n';
import {
  achievementRows,
  NYU_TABS,
  occasionRows,
  roundsUntilLongBreak,
  secretRows,
  setNyuTab,
  stepTab,
  useNyuTab,
  type NyuTab,
} from '../../../lib/nyu-page';
import {
  configFrom,
  formatRemaining,
  isRunning,
  remainingMs,
  usePomodoro,
} from '../../../lib/nyu-pomodoro';
import {
  ACHIEVEMENTS,
  chooseHat,
  HAT_LABELS,
  hatSource,
  levelProgress,
  resetProgress,
  SECRETS,
  unlockedHats,
  useNyuHat,
  useProgress,
  type HatChoice,
  type NyuProgress,
} from '../../../lib/nyu-progress';
import { ask } from '../../../lib/prompt';
import { updateSettings, useSettings, type Settings } from '../../../lib/settings';
import { Modal } from '../../Modal';
import { HAT_IDS, hatParts, type HatId } from '../hats';
import { Nyu, Sticker, type NyuMood } from '../Nyu';
import { occasionHat } from '../occasions';
import { Tomato } from '../props';
import { phaseName, useSecondTick } from './PomodoroItem';
import './nyu-dialog.css';

export function NyuDialog() {
  const { dialog } = useUiState();
  if (dialog !== 'nyu') return null;
  return <NyuDialogBody />;
}

/** Her face on each tab: she is proud of her trophies and sleepy about settings. */
const TAB_MOODS: Record<NyuTab, NyuMood> = {
  overview: 'happy',
  achievements: 'sparkle',
  wardrobe: 'cheer',
  pomodoro: 'uwu',
  secrets: 'puzzled',
  settings: 'sleepy',
};

function NyuDialogBody() {
  useLanguage();
  const settings = useSettings();
  const progress = useProgress();
  const hat = useNyuHat();
  const tab = useNyuTab();
  const levels = settings.nyuLevels;
  const format = useMemo(() => new Intl.NumberFormat(language()), [settings.language]);
  const prefix = useId();
  const tabRefs = useRef(new Map<NyuTab, HTMLButtonElement>());

  const go = (next: NyuTab) => {
    setNyuTab(next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    <Modal title={t('Nyu-Zentrale')} onClose={closeDialog} wide>
      <div className="nyu-page">
        <header className="nyu-page-head">
          <div className="nyu-page-portrait">
            <Nyu size={104} mood={TAB_MOODS[tab]} title={t('Nyu')} {...hatParts(hat)} />
          </div>
          {levels ? (
            <LevelCard progress={progress} format={format} />
          ) : (
            <p className="nyu-page-off">
              {t(
                'Level und Erfolge sind ausgeschaltet. Nyu zählt nichts mit, bis du sie in den Einstellungen wieder einschaltest.',
              )}
            </p>
          )}
        </header>

        <div className="nyu-tabs" role="tablist" aria-label={t('Nyu-Zentrale')}>
          {NYU_TABS.map((entry) => (
            <button
              key={entry.id}
              ref={(element) => {
                if (element) tabRefs.current.set(entry.id, element);
                else tabRefs.current.delete(entry.id);
              }}
              type="button"
              role="tab"
              id={`${prefix}tab-${entry.id}`}
              aria-selected={tab === entry.id}
              aria-controls={`${prefix}panel`}
              tabIndex={tab === entry.id ? 0 : -1}
              className="nyu-tab"
              onClick={() => setNyuTab(entry.id)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                  event.preventDefault();
                  go(stepTab(entry.id, event.key === 'ArrowRight' ? 1 : -1));
                } else if (event.key === 'Home' || event.key === 'End') {
                  event.preventDefault();
                  go(NYU_TABS[event.key === 'Home' ? 0 : NYU_TABS.length - 1]!.id);
                }
              }}
            >
              {t(entry.label)}
            </button>
          ))}
        </div>

        <div
          className="nyu-tab-panel"
          role="tabpanel"
          id={`${prefix}panel`}
          aria-labelledby={`${prefix}tab-${tab}`}
        >
          {tab === 'overview' ? <Overview progress={progress} format={format} /> : null}
          {tab === 'achievements' ? <Achievements progress={progress} /> : null}
          {tab === 'wardrobe' ? <Wardrobe progress={progress} settings={settings} /> : null}
          {tab === 'pomodoro' ? <Pomodoro progress={progress} format={format} /> : null}
          {tab === 'secrets' ? <Secrets progress={progress} /> : null}
          {tab === 'settings' ? <NyuSettings settings={settings} /> : null}
        </div>
      </div>
    </Modal>
  );
}

/** What a tab shows instead of numbers while the counting is off. */
function LevelsOff() {
  return (
    <p className="nyu-page-empty">
      {t('Level und Erfolge sind ausgeschaltet.')}{' '}
      <button type="button" className="nyu-page-link" onClick={() => setNyuTab('settings')}>
        {t('Einschalten…')}
      </button>
    </p>
  );
}

function Overview({ progress, format }: { progress: NyuProgress; format: Intl.NumberFormat }) {
  const settings = useSettings();
  const reset = async () => {
    const answer = await ask(
      t('Nyus Fortschritt zurücksetzen?'),
      t(
        'Level, Erfolge, Statistik und freigeschaltete Accessoires gehen verloren. Deine Dateien bleiben, wie sie sind.',
      ),
      [
        { id: 'reset', label: t('Zurücksetzen'), tone: 'danger' },
        { id: 'cancel', label: t('Abbrechen'), tone: 'quiet' },
      ],
    );
    if (answer === 'reset') resetProgress();
  };
  if (!settings.nyuLevels) return <LevelsOff />;
  const unlocked = Object.keys(progress.achievements).length;
  return (
    <div className="nyu-page-stack">
      <ul className="nyu-highlights">
        <Highlight
          value={`${unlocked} / ${ACHIEVEMENTS.length}`}
          label={t('Erfolge')}
          onClick={() => setNyuTab('achievements')}
        />
        <Highlight
          value={`${unlockedHats(progress).length} / ${HAT_IDS.length}`}
          label={t('Accessoires')}
          onClick={() => setNyuTab('wardrobe')}
        />
        <Highlight
          value={format.format(progress.stats.pomodoros)}
          label={t('Pomodoros')}
          onClick={() => setNyuTab('pomodoro')}
        />
        <Highlight
          value={`${progress.found.length} / ${SECRETS.length}`}
          label={t('Geheimnisse')}
          onClick={() => setNyuTab('secrets')}
        />
      </ul>
      <section className="nyu-page-section">
        <h3 className="nyu-page-title">{t('Zusammen geschafft')}</h3>
        <Stats progress={progress} format={format} />
      </section>
      <footer className="nyu-page-footer">
        <Button variant="secondary" size="sm" type="button" onClick={() => openDialog('settings')}>
          {t('Einstellungen…')}
        </Button>
        <Button
          variant="danger"
          size="sm"
          type="button"
          className="settings-reset"
          onClick={() => void reset()}
        >
          {t('Fortschritt zurücksetzen')}
        </Button>
      </footer>
    </div>
  );
}

function Highlight({
  value,
  label,
  onClick,
}: {
  value: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button type="button" className="nyu-highlight" onClick={onClick}>
        <span className="nyu-highlight-value">{value}</span>
        <span className="nyu-highlight-label">{label}</span>
      </button>
    </li>
  );
}

function Achievements({ progress }: { progress: NyuProgress }) {
  const settings = useSettings();
  if (!settings.nyuLevels) return <LevelsOff />;
  const rows = achievementRows(progress);
  const done = rows.filter((row) => row.state === 'done').length;
  return (
    <section className="nyu-page-section">
      <h3 className="nyu-page-title">
        {t('Erfolge')}{' '}
        <span className="nyu-page-count">
          {done} / {rows.length}
        </span>
      </h3>
      <ul className="nyu-achievements">
        {rows.map((row) => (
          <li
            key={row.id}
            className="nyu-achievement"
            data-done={row.state === 'done' ? 'true' : 'false'}
            data-secret={row.state === 'secret' ? 'true' : undefined}
            title={row.hint ? t(row.hint) : t('Ein Geheimnis. Nyu verrät nichts.')}
          >
            <span className="nyu-achievement-mark" aria-hidden>
              {row.state === 'done' ? '★' : row.state === 'secret' ? '?' : '☆'}
            </span>
            <span className="nyu-achievement-text">
              <span className="nyu-achievement-name">{row.title ? t(row.title) : '???'}</span>
              <span className="nyu-achievement-hint">
                {row.state === 'done' && row.at
                  ? t('Geschafft am {date}', {
                      date: new Date(row.at).toLocaleDateString(language()),
                    })
                  : row.hint
                    ? t(row.hint)
                    : t('Ein Geheimnis. Nyu verrät nichts.')}
              </span>
            </span>
            <span className="nyu-sr-only">
              {row.state === 'done' ? t('freigeschaltet') : t('noch nicht freigeschaltet')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Wardrobe({ progress, settings }: { progress: NyuProgress; settings: Settings }) {
  return (
    <div className="nyu-page-stack">
      <section className="nyu-page-section">
        <h3 className="nyu-page-title">{t('Was Nyu trägt')}</h3>
        <HatPicker progress={progress} occasions={settings.nyuOccasions} />
      </section>
      <section className="nyu-page-section">
        <h3 className="nyu-page-title">
          {t('Anlässe erlebt')}{' '}
          <span className="nyu-page-count">
            {progress.seen.length} / {occasionRows(progress).length}
          </span>
        </h3>
        {settings.nyuOccasions ? null : (
          <p className="nyu-page-empty">{t('Anlässe sind ausgeschaltet.')}</p>
        )}
        <ul className="nyu-occasions">
          {occasionRows(progress).map((row) => (
            <li key={row.id} className="nyu-occasion" data-seen={row.seen ? 'true' : 'false'}>
              <Nyu
                size={34}
                mood={row.seen ? 'happy' : 'sleepy'}
                blink={false}
                title=""
                {...hatParts(row.hat)}
              />
              <span className="nyu-occasion-name">{t(row.name)}</span>
              <span className="nyu-sr-only">{row.seen ? t('erlebt') : t('noch nicht erlebt')}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Pomodoro({ progress, format }: { progress: NyuProgress; format: Intl.NumberFormat }) {
  const settings = useSettings();
  const state = usePomodoro();
  const running = isRunning(state);
  useSecondTick(running);
  const config = configFrom(settings);
  const active = state.phase !== null;
  const left = active ? remainingMs(state, Date.now()) : config.focusMs;
  const until = roundsUntilLongBreak(state.done, config.longEvery);
  return (
    <div className="nyu-page-stack">
      <div className="nyu-pomodoro" data-running={running ? 'true' : undefined}>
        <svg
          className="nyu-pomodoro-tomato"
          viewBox="-44 -48 88 84"
          width={72}
          height={72}
          aria-hidden
          focusable="false"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <Sticker edge={8}>
            <Tomato x={0} y={0} />
          </Sticker>
        </svg>
        <div className="nyu-pomodoro-clock">
          <p className="nyu-pomodoro-phase">
            {state.phase
              ? `${phaseName(state.phase)}${running ? '' : ` · ${t('pausiert')}`}`
              : t('Bereit für eine Runde')}
          </p>
          <p className="nyu-pomodoro-time" aria-live="off">
            {formatRemaining(left)}
          </p>
          <p className="nyu-pomodoro-next">
            {until === 1
              ? t('Nach dieser Runde gibt es die lange Pause.')
              : t('Noch {count} Runden bis zur langen Pause.', { count: until })}
          </p>
        </div>
        <div className="nyu-pomodoro-actions">
          {active ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => runCommand('pomodoro.pause')}
              >
                {running ? t('Pausieren') : t('Fortsetzen')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => runCommand('pomodoro.skip')}
              >
                {t('Überspringen')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                type="button"
                className="settings-reset"
                onClick={() => runCommand('pomodoro.stop')}
              >
                {t('Beenden')}
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              size="sm"
              type="button"
              onClick={() => runCommand('pomodoro.start')}
            >
              {t('Pomodoro starten')}
            </Button>
          )}
        </div>
      </div>
      <dl className="nyu-stats">
        <div className="nyu-stat">
          <dt>{t('Pomodoros insgesamt')}</dt>
          <dd>{format.format(progress.stats.pomodoros)}</dd>
        </div>
        <div className="nyu-stat">
          <dt>{t('Seit der langen Pause')}</dt>
          <dd>{format.format(state.done)}</dd>
        </div>
        <div className="nyu-stat">
          <dt>{t('Fokus')}</dt>
          <dd>{t('{minutes} min', { minutes: settings.pomodoroFocusMinutes })}</dd>
        </div>
        <div className="nyu-stat">
          <dt>{t('Kurze Pause')}</dt>
          <dd>{t('{minutes} min', { minutes: settings.pomodoroBreakMinutes })}</dd>
        </div>
        <div className="nyu-stat">
          <dt>{t('Lange Pause')}</dt>
          <dd>{t('{minutes} min', { minutes: settings.pomodoroLongBreakMinutes })}</dd>
        </div>
        <div className="nyu-stat">
          <dt>{t('Lange Pause nach')}</dt>
          <dd>{t('{count} Runden', { count: settings.pomodoroLongEvery })}</dd>
        </div>
      </dl>
      <p className="nyu-page-note">
        {t('Die Zeiten stellst du unter Einstellungen → Nyu ein.')}{' '}
        <button type="button" className="nyu-page-link" onClick={() => openDialog('settings')}>
          {t('Einstellungen…')}
        </button>
      </p>
    </div>
  );
}

function Secrets({ progress }: { progress: NyuProgress }) {
  const settings = useSettings();
  const rows = secretRows(progress);
  const found = rows.filter((row) => row.found).length;
  return (
    <section className="nyu-page-section">
      <h3 className="nyu-page-title">
        {t('Geheimnisse')}{' '}
        <span className="nyu-page-count">
          {found} / {rows.length}
        </span>
      </h3>
      {!settings.nyuGimmicks || !settings.nyuLevels ? (
        <p className="nyu-page-empty">
          {t('Nyu merkt sich Geheimnisse nur mit eingeschalteten Spielereien und Erfolgen.')}
        </p>
      ) : null}
      <div
        className="nyu-secret-bar"
        role="progressbar"
        aria-label={t('Geheimnisse entdeckt')}
        aria-valuemin={0}
        aria-valuemax={rows.length}
        aria-valuenow={found}
      >
        <span style={{ width: `${(found / rows.length) * 100}%` }} />
      </div>
      <ul className="nyu-secrets">
        {rows.map((row) => (
          <li key={row.id} className="nyu-secret" data-found={row.found ? 'true' : 'false'}>
            <span className="nyu-secret-mark" aria-hidden>
              {row.found ? '♥' : '?'}
            </span>
            <span className="nyu-secret-text">{t(row.text)}</span>
            <span className="nyu-sr-only">
              {row.found ? t('entdeckt') : t('noch nicht entdeckt')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The help line under each switch, the same words Settings → Nyu uses. */
const SWITCH_HINTS: Record<(typeof NYU_SWITCHES)[number]['key'], string> = {
  nyuCompanion: N_(
    'Sie tippt mit, schläft ein, wenn du Pause machst, und freut sich übers Speichern.',
  ),
  nyuGimmicks: N_('Geheimwörter, Streicheln und ab und zu ein Gastauftritt am Fensterrand.'),
  nyuOccasions: N_('Hüte und kleine Szenen zu Halloween, Weihnachten, Ostern und anderen Tagen.'),
  nyuLevels: N_('Nyu sammelt beim Schreiben Erfahrung. Alles bleibt auf diesem Rechner.'),
  nyuTips: N_('Ab und zu ein Tastenkürzel in einer Sprechblase. Nur im verspielten Tonfall.'),
  pomodoroButton: N_('Starten geht auch über die Befehlspalette.'),
};

function NyuSettings({ settings }: { settings: Settings }) {
  return (
    <div className="nyu-page-stack">
      <div className="nyu-switches">
        {NYU_SWITCHES.map(({ id, key, title }) => (
          <Switch
            key={id}
            label={t(title)}
            hint={t(SWITCH_HINTS[key])}
            checked={settings[key]}
            disabled={key === 'nyuTips' && !settings.nyuCompanion}
            onChange={(value) => updateSettings({ [key]: value })}
          />
        ))}
      </div>
      <p className="nyu-page-note">
        {t('Pomodoro-Zeiten, Tonfall und alles andere stehen in den Einstellungen.')}{' '}
        <button type="button" className="nyu-page-link" onClick={() => openDialog('settings')}>
          {t('Einstellungen…')}
        </button>
      </p>
    </div>
  );
}

function Switch({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="settings-field settings-field-switch">
      <span className="settings-label" id={`${id}-label`}>
        {label}
      </span>
      <span className="settings-switch">
        <SuiteSwitch checked={checked} disabled={disabled} label={label} onChange={onChange} />
      </span>
      <p className="settings-hint" id={`${id}-hint`}>
        {hint}
      </p>
    </div>
  );
}

function LevelCard({ progress, format }: { progress: NyuProgress; format: Intl.NumberFormat }) {
  const { level, into, needed } = levelProgress(progress.xp);
  const percent = Math.round((into / needed) * 100);
  return (
    <div className="nyu-level">
      <p className="nyu-level-number">{t('Level {level}', { level })}</p>
      <div
        className="nyu-level-bar"
        role="progressbar"
        aria-label={t('Fortschritt bis zum nächsten Level')}
        aria-valuemin={0}
        aria-valuemax={needed}
        aria-valuenow={into}
      >
        <span className="nyu-level-fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="nyu-level-xp">
        {t('{into} von {needed} XP · insgesamt {total} XP', {
          into: format.format(into),
          needed: format.format(needed),
          total: format.format(progress.xp),
        })}
      </p>
      <p className="nyu-level-streak">
        {progress.days.streak > 1
          ? t('{days} Tage in Folge dabei · Rekord {best}', {
              days: progress.days.streak,
              best: progress.days.best,
            })
          : t('Rekord: {best} Tage in Folge', { best: progress.days.best })}
      </p>
    </div>
  );
}

function HatPicker({ progress, occasions }: { progress: NyuProgress; occasions: boolean }) {
  const unlocked = unlockedHats(progress);
  const today = occasions ? occasionHat(new Date()) : null;
  const choices: { id: HatChoice; label: string; hat: HatId | null; locked: string | null }[] = [
    {
      id: 'auto',
      label: today ? t('Zum Anlass') : t('Automatisch'),
      hat: today,
      locked: null,
    },
    { id: 'none', label: t('Ohne'), hat: null, locked: null },
    ...HAT_IDS.map((hat) => {
      const source = hatSource(hat);
      const locked = unlocked.includes(hat)
        ? null
        : source.level
          ? t('Ab Level {level}', { level: source.level })
          : source.achievement
            ? t('Erfolg: {name}', { name: t(source.achievement.title) })
            : t('Noch nicht freigeschaltet');
      return { id: hat, label: t(HAT_LABELS[hat]), hat, locked };
    }),
  ];

  return (
    <ul className="nyu-hats">
      {choices.map((choice) => (
        <li key={choice.id}>
          <button
            type="button"
            className="nyu-hat"
            aria-pressed={progress.hat === choice.id}
            disabled={choice.locked !== null}
            title={choice.locked ?? choice.label}
            onClick={() => chooseHat(choice.id)}
          >
            <Nyu size={44} mood="happy" blink={false} title="" {...hatParts(choice.hat)} />
            <span className="nyu-hat-label">{choice.label}</span>
            {choice.locked ? <span className="nyu-hat-lock">{choice.locked}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Stats({ progress, format }: { progress: NyuProgress; format: Intl.NumberFormat }) {
  const { stats, days } = progress;
  const rows: [string, number][] = [
    [t('Getippte Zeichen'), stats.chars],
    [t('Neue Zeilen'), stats.lines],
    [t('Speicherungen'), stats.saves],
    [t('Makros abgespielt'), stats.macros],
    [t('Dateien geöffnet'), stats.filesOpened],
    [t('Tage dabei'), days.total],
    [t('Längste Serie'), days.best],
    [t('Nyu-Pomodoros'), stats.pomodoros],
    [t('Meiste Tabs auf einmal'), stats.maxTabs],
    [t('Streicheleinheiten'), stats.pets],
  ];
  return (
    <dl className="nyu-stats">
      {rows.map(([label, value]) => (
        <div key={label} className="nyu-stat">
          <dt>{label}</dt>
          <dd>{format.format(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
