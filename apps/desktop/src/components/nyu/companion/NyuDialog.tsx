/**
 * Nyu's page: her level, her achievements, her wardrobe, and what you have
 * written together.
 *
 * Opened from the palette ("Nyu-Erfolge"), from Settings → Nyu, and by
 * double-clicking the companion. Everything shown is local (`lib/nyu-progress.ts`)
 * and nothing here sends anything anywhere.
 *
 * With levels switched off the page still offers the hats she already has —
 * taking a crown away because somebody turned off the counting would be mean —
 * but shows no level, no XP and no achievements.
 */

import { useMemo } from 'react';
import { closeDialog, openDialog, useUiState } from '../../../lib/commands';
import { language, t, useLanguage } from '../../../lib/i18n';
import {
  ACHIEVEMENTS,
  chooseHat,
  HAT_LABELS,
  hatSource,
  levelProgress,
  resetProgress,
  unlockedHats,
  useNyuHat,
  useProgress,
  type HatChoice,
  type NyuProgress,
} from '../../../lib/nyu-progress';
import { ask } from '../../../lib/prompt';
import { useSettings } from '../../../lib/settings';
import { Modal } from '../../Modal';
import { HAT_IDS, hatParts, type HatId } from '../hats';
import { Nyu } from '../Nyu';
import { occasionHat } from '../occasions';
import './nyu-dialog.css';

export function NyuDialog() {
  const { dialog } = useUiState();
  if (dialog !== 'nyu') return null;
  return <NyuDialogBody />;
}

function NyuDialogBody() {
  useLanguage();
  const settings = useSettings();
  const progress = useProgress();
  const hat = useNyuHat();
  const levels = settings.nyuLevels;
  const format = useMemo(() => new Intl.NumberFormat(language()), [settings.language]);

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

  return (
    <Modal title={t('Nyu')} onClose={closeDialog} wide>
      <div className="nyu-page">
        <header className="nyu-page-head">
          <div className="nyu-page-portrait">
            <Nyu size={104} mood="happy" title={t('Nyu')} {...hatParts(hat)} />
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

        <section className="nyu-page-section">
          <h3 className="nyu-page-title">{t('Was Nyu trägt')}</h3>
          <HatPicker progress={progress} occasions={settings.nyuOccasions} />
        </section>

        {levels ? (
          <>
            <section className="nyu-page-section">
              <h3 className="nyu-page-title">
                {t('Erfolge')}{' '}
                <span className="nyu-page-count">
                  {Object.keys(progress.achievements).length} / {ACHIEVEMENTS.length}
                </span>
              </h3>
              <ul className="nyu-achievements">
                {ACHIEVEMENTS.map((achievement) => {
                  const at = progress.achievements[achievement.id];
                  const done = at !== undefined;
                  return (
                    <li
                      key={achievement.id}
                      className="nyu-achievement"
                      data-done={done ? 'true' : 'false'}
                      title={t(achievement.hint)}
                    >
                      <span className="nyu-achievement-mark" aria-hidden>
                        {done ? '★' : '☆'}
                      </span>
                      <span className="nyu-achievement-text">
                        <span className="nyu-achievement-name">{t(achievement.title)}</span>
                        <span className="nyu-achievement-hint">
                          {done && at
                            ? t('Geschafft am {date}', {
                                date: new Date(at).toLocaleDateString(language()),
                              })
                            : t(achievement.hint)}
                        </span>
                      </span>
                      <span className="nyu-sr-only">
                        {done ? t('freigeschaltet') : t('noch nicht freigeschaltet')}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="nyu-page-section">
              <h3 className="nyu-page-title">{t('Zusammen geschafft')}</h3>
              <Stats progress={progress} format={format} />
            </section>
          </>
        ) : null}

        <footer className="nyu-page-footer">
          <button type="button" className="nyu-page-button" onClick={() => openDialog('settings')}>
            {t('Einstellungen…')}
          </button>
          {levels ? (
            <button type="button" className="settings-reset" onClick={() => void reset()}>
              {t('Fortschritt zurücksetzen')}
            </button>
          ) : null}
        </footer>
      </div>
    </Modal>
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
    [t('Gespeichert'), stats.saves],
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
