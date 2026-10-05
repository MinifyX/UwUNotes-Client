/**
 * Where Nyu meets the app: one `startNyu()` from `App.tsx` that listens to the
 * keyboard, the pointer and `lib/nyu-events.ts`, and turns what it hears into a
 * reaction from the companion, a little XP, an achievement, a cameo or a tip.
 *
 * Everything that decides *whether* something may happen lives here, in one
 * place, so the rules can be read in one sitting:
 *
 * - **Calm first.** Every reaction has a cooldown; cameos come at most every
 *   twenty to forty minutes and tips even less often; none of them while the
 *   user is typing, while a dialog is open, in zen mode or while the window is
 *   hidden. With animations off (`html[data-motion="reduced"]`) there are no
 *   cameos, no confetti and no movement — her face may still change, a still
 *   picture is not motion.
 * - **Tone.** Speech bubbles and playful toasts only in the playful tone. The
 *   neutral tone keeps the cat and drops the chatter.
 * - **Never on bad news.** Nothing here listens for errors, and the event kinds
 *   are all harmless ones (see `nyu-events.ts`). While an error toast or a
 *   question (`lib/prompt.ts`) is on screen she does not react, speak or
 *   appear at all.
 * - **Good news in one breath.** Achievements and level steps that arrive
 *   together — the first start hands out several at once — become one short
 *   toast, never a stack of them, and none at all in zen mode: they wait
 *   until it is left.
 * - **Nothing leaves the machine.** The progress is in the page's storage.
 *
 * The listeners are cheap on purpose: a keystroke into the editor costs a few
 * comparisons, one object spread for the XP bucket and at most one animation
 * frame to find the caret.
 */

import { getUiState, openDialog } from './commands';
import { allDocs, subscribeDocuments } from './documents';
import { N_, t } from './i18n';
import { clearCameo, playCameo, type CameoName } from './nyu-cameo';
import { EggDetector, KonamiDetector, type EggWord } from './nyu-eggs';
import { onNyu, type NyuEvent } from './nyu-events';
import {
  Cooldowns,
  getLife,
  hush,
  lifeKey,
  lookAt,
  petNyu,
  react,
  say,
  startLife,
  type Reaction,
} from './nyu-life';
import {
  ACHIEVEMENTS,
  currentHat,
  findSecret,
  flushProgress,
  gainEvent,
  gainTyping,
  getProgress,
  HAT_LABELS,
  LEVEL_HATS,
  levelForXp,
  noteTabs,
  setProgress,
  touchDay,
  unlockAchievements,
  type NyuProgress,
  type ProgressEvent,
} from './nyu-progress';
import {
  checkPomodoro,
  setPomodoroFinishHandler,
  startFocus,
  type PomodoroPhase,
  type PomodoroState,
} from './nyu-pomodoro';
import { promptOpen } from './prompt';
import { getSettings } from './settings';
import { shortcutLabel } from './shortcuts';
import { playChime } from './sound';
import { dismissToast, errorShowing, toast } from './toast';
import { activeView } from './views';
import { localDay, occasionsOn, type Occasion } from '../components/nyu/occasions';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

/* ── Conditions ────────────────────────────────────────── */

function motionOk(): boolean {
  return document.documentElement.dataset.motion !== 'reduced';
}

/**
 * Zen mode is another feature's (`lib/zen.ts` on the 0.5.0 branch puts
 * `data-zen` on the app's root element). Read from the DOM rather than
 * imported, so Nyu works with or without it: any element carrying `data-zen`,
 * or a `zen`/`zen-mode` class on `<html>` or `<body>`, and she stays away.
 * Only asked when something decorative is about to happen, never per key.
 */
export function zenShowing(): boolean {
  if (document.querySelector('[data-zen]:not([data-zen="false"])')) return true;
  for (const element of [document.documentElement, document.body]) {
    if (element?.classList.contains('zen') || element?.classList.contains('zen-mode')) return true;
  }
  return false;
}

function playful(): boolean {
  return getSettings().tone === 'playful';
}

let lastKeyAt = 0;

function typedWithin(ms: number, now = Date.now()): boolean {
  return now - lastKeyAt < ms;
}

/**
 * Something on screen that she must not stand next to: a question waiting for
 * an answer (an "empty the trash?", say) or an error toast.
 */
function badNewsShowing(): boolean {
  return promptOpen() || errorShowing();
}

/** A moment where something decorative may appear without being in the way. */
function quietMoment(now = Date.now()): boolean {
  return (
    !document.hidden &&
    !zenShowing() &&
    getUiState().dialog === null &&
    !badNewsShowing() &&
    !typedWithin(15 * SECOND, now)
  );
}

/* ── Reactions ─────────────────────────────────────────── */

const cooldowns = new Cooldowns();

/**
 * Plays a reaction on the companion, if she is there and the cooldown allows.
 * With reduced motion the face still changes; the movement and the burst do not.
 */
function companionReact(key: string, cooldownMs: number, reaction: Omit<Reaction, 'id'>): boolean {
  const settings = getSettings();
  if (!settings.nyuCompanion || zenShowing() || badNewsShowing()) return false;
  if (!cooldowns.allow(`react:${key}`, cooldownMs, Date.now())) return false;
  const still = !motionOk();
  react({
    ...reaction,
    motion: still ? null : reaction.motion,
    burst: still ? null : reaction.burst,
  });
  return true;
}

/** A line in her speech bubble — the playful tone only, and only when she is there. */
function companionSay(text: string, ms?: number): void {
  if (!playful() || !getSettings().nyuCompanion || zenShowing() || badNewsShowing()) return;
  say(text, ms);
}

/* ── Progress ──────────────────────────────────────────── */

/** When each counted event last counted, for the anti-farming spacing. */
const lastCounted = new Map<ProgressEvent, number>();

/**
 * Applies a gain and whatever achievements it unlocked, and celebrates a level
 * step. `announce` is false on the typing path while nothing visible changed.
 */
function commitGain(next: NyuProgress, before: NyuProgress, announce = true): void {
  const now = Date.now();
  const unlocked = unlockAchievements(next, now);
  const final = unlocked.progress;
  const visible =
    announce ||
    final.xp !== before.xp ||
    unlocked.unlocked.length > 0 ||
    final.stats.maxTabs !== before.stats.maxTabs;
  setProgress(final, visible);

  // Judged on the final value: the achievements' XP can carry a level step of
  // its own.
  const levelBefore = levelForXp(before.xp);
  const levelAfter = levelForXp(final.xp);
  const stepped = levelAfter > levelBefore;
  if (unlocked.unlocked.length > 0 || stepped) {
    queueNotice(unlocked.unlocked, stepped ? { from: levelBefore, to: levelAfter } : null);
  }

  if (stepped) {
    companionReact('level', 0, { mood: 'cheer', motion: 'dance', burst: 'confetti', ms: 2_400 });
  } else if (unlocked.unlocked.length > 0) {
    companionReact('achievement', 2 * SECOND, {
      mood: 'sparkle',
      motion: 'hop',
      burst: 'stars',
      ms: 1_600,
    });
  }
}

/* ── Notices: achievements and levels, gathered ────────── */

/**
 * How long after an unlock more may join it. The first start unlocks the
 * first day, the occasion of the season and maybe a level within a second or
 * two; one toast for all of them is good news, four stacked ones are a wall.
 */
export const NOTICE_GATHER_MS = 2_000;
/** However busy it gets, a notice waits no longer than this for company. */
const NOTICE_MAX_WAIT_MS = 6_000;

type LevelStep = { from: number; to: number };

let pendingAchievements: string[] = [];
let pendingLevel: LevelStep | null = null;
let noticeTimer = 0;
let noticeSince = 0;
/** The notice on screen, so a newer one replaces it instead of joining it. */
let noticeToast = 0;

function queueNotice(achievements: readonly string[], level: LevelStep | null): void {
  for (const id of achievements)
    if (!pendingAchievements.includes(id)) pendingAchievements.push(id);
  if (level) {
    pendingLevel = pendingLevel
      ? { from: Math.min(pendingLevel.from, level.from), to: Math.max(pendingLevel.to, level.to) }
      : level;
  }
  const now = Date.now();
  if (!noticeTimer) noticeSince = now;
  window.clearTimeout(noticeTimer);
  const wait = Math.max(0, Math.min(NOTICE_GATHER_MS, noticeSince + NOTICE_MAX_WAIT_MS - now));
  noticeTimer = window.setTimeout(flushNotices, wait);
}

/**
 * Shows what has gathered as one toast. In zen mode nothing pops up: the
 * notices stay queued and `zen-left` shows them — they are on Nyu's page in
 * the meantime anyway.
 */
function flushNotices(): void {
  noticeTimer = 0;
  if (pendingAchievements.length === 0 && !pendingLevel) return;
  if (zenShowing()) return;
  const text = noticeText(pendingAchievements, pendingLevel);
  pendingAchievements = [];
  pendingLevel = null;
  if (!text) return;
  dismissToast(noticeToast);
  noticeToast = toast(
    'success',
    text,
    { label: t('Ansehen'), run: () => openDialog('nyu') },
    { brief: true },
  );
}

/** The one sentence for a level step and the achievements that came with it. */
export function noticeText(achievements: readonly string[], level: LevelStep | null): string {
  const names = achievements
    .map((id) => ACHIEVEMENTS.find((entry) => entry.id === id))
    .filter((entry) => entry !== undefined)
    .map((entry) => t(entry.title));
  const fun = playful();
  let unlocked = '';
  if (names.length === 1) {
    const name = names[0] ?? '';
    unlocked = fun
      ? t('Neuer Erfolg: {name} ✧', { name })
      : t('Erfolg freigeschaltet: {name}', { name });
  } else if (names.length > 1) {
    const list = names.join(', ');
    unlocked = fun
      ? t('{count} neue Erfolge: {names} ✧', { count: names.length, names: list })
      : t('{count} Erfolge freigeschaltet: {names}', { count: names.length, names: list });
  }
  if (!level) return unlocked;

  const hats = LEVEL_HATS.filter((entry) => entry.level > level.from && entry.level <= level.to);
  const parts = [
    fun
      ? t('Level {level}! Nyu ist stolz auf dich. (ﾉ◕ヮ◕)ﾉ*:･ﾟ✧', { level: level.to })
      : t('Level {level} erreicht.', { level: level.to }),
  ];
  if (hats.length > 0) {
    parts.push(
      t('Neues Accessoire: {name}', { name: hats.map((h) => t(HAT_LABELS[h.hat])).join(', ') }),
    );
  }
  if (unlocked) parts.push(unlocked);
  return parts.join(' · ');
}

function count(event: ProgressEvent): void {
  if (!getSettings().nyuLevels) return;
  const now = Date.now();
  const before = getProgress();
  const gain = gainEvent(before, event, now, lastCounted.get(event));
  if (gain.progress === before || gain.progress.stats === before.stats) return;
  lastCounted.set(event, now);
  commitGain(gain.progress, before);
}

function countDay(): void {
  if (!getSettings().nyuLevels) return;
  const before = getProgress();
  const gain = touchDay(before, new Date());
  if (gain.progress === before) return;
  commitGain(gain.progress, before);
}

/* ── Typing ────────────────────────────────────────────── */

const eggs = new EggDetector();
const konami = new KonamiDetector();
let lookFrame = 0;
let lastMinute = -1;
let nightOwlSaid = false;

function scheduleCaretLook(): void {
  if (lookFrame || !motionOk() || !getSettings().nyuCompanion) return;
  lookFrame = requestAnimationFrame(() => {
    lookFrame = 0;
    const view = activeView();
    if (!view) return;
    const coords = view.coordsAtPos(view.state.selection.main.head);
    if (coords) lookAt(coords.left, coords.top);
  });
}

function typed(chars: number, lines: number, now: number): void {
  const minute = Math.floor(now / MINUTE);
  if (minute !== lastMinute) {
    lastMinute = minute;
    // Once a minute is often enough to notice that midnight passed.
    countDay();
    if (!nightOwlSaid && new Date(now).getHours() < 5 && new Date(now).getHours() >= 1) {
      nightOwlSaid = true;
      companionSay(t('Nachteule! Nyu hält mit dir durch.'), 6 * SECOND);
    }
  }
  if (!getSettings().nyuLevels) return;
  const before = getProgress();
  const gain = gainTyping(before, { chars, lines }, now);
  commitGain(gain.progress, before, false);
}

const EGG_REACTIONS: Record<EggWord, { reaction: Omit<Reaction, 'id'>; line: string }> = {
  uwu: {
    reaction: { mood: 'uwu', motion: 'wiggle', burst: 'hearts', ms: 1_600 },
    line: N_('uwu (〃▽〃)'),
  },
  owo: {
    reaction: { mood: 'sparkle', motion: 'hop', burst: 'stars', ms: 1_400 },
    line: N_('owo? Was ist das?'),
  },
  nyu: {
    reaction: { mood: 'happy', motion: 'wave', burst: null, ms: 1_600 },
    line: N_('Ja? Du hast gerufen?'),
  },
  meow: {
    reaction: { mood: 'cheer', motion: 'wiggle', burst: 'notes', ms: 1_600 },
    line: N_('Miau! (=^･ω･^=)'),
  },
};

function onEgg(word: EggWord): void {
  if (!getSettings().nyuGimmicks) return;
  const now = Date.now();
  if (!cooldowns.allow('egg', 8 * SECOND, now)) return;
  if (!cooldowns.allow(`egg:${word}`, 20 * SECOND, now)) return;
  const { reaction, line } = EGG_REACTIONS[word];
  companionReact(`egg:${word}`, 0, reaction);
  companionSay(t(line), 3 * SECOND);
  count('egg');
  findSecret(word);
}

function onKonami(): void {
  if (!getSettings().nyuGimmicks) return;
  if (!cooldowns.allow('konami', 10 * SECOND, Date.now())) return;
  dance();
  count('konami');
  findSecret('konami');
}

/** Party: the companion dances and, when motion allows, the party cameo plays. */
export function dance(): void {
  companionReact('dance', 0, { mood: 'cheer', motion: 'dance', burst: 'confetti', ms: 2_600 });
  if (motionOk() && !zenShowing()) playCameo('party', { hat: 'party' });
  companionSay(t('Party! ヽ(・∀・)ﾉ'), 3 * SECOND);
}

/** Someone petted her: hearts and a purr, or a dizzy face after one click too many. */
export function petCompanion(): void {
  if (!getSettings().nyuGimmicks) {
    companionReact('pet-plain', 1 * SECOND, { mood: 'uwu', motion: null, burst: null, ms: 900 });
    return;
  }
  if (petNyu() === 'dizzy') {
    companionReact('pet', 0, { mood: 'puzzled', motion: 'wobble', burst: 'dizzy', ms: 2_200 });
    companionSay(t('Mir ist schwindelig … (@_@)'), 2_500);
  } else {
    companionReact('pet', 0, { mood: 'uwu', motion: 'wiggle', burst: 'hearts', ms: 1_300 });
    if (cooldowns.allow('purr', 30 * SECOND, Date.now())) companionSay(t('Prrrr …'), 1_800);
  }
  count('pet');
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (konami.push(event.key)) onKonami();

  const target = event.target;
  const inEditor = target instanceof Element && target.closest('.cm-content') !== null;
  if (!inEditor) {
    eggs.reset();
    return;
  }
  // AltGr arrives as Ctrl+Alt on Windows and types a character; a plain Ctrl or
  // Cmd chord is a shortcut, not writing.
  const chord = (event.ctrlKey && !event.altKey) || event.metaKey;
  if (chord) return;
  const enter = event.key === 'Enter';
  const printable = [...event.key].length === 1;
  if (!printable && !enter) {
    // The caret moved or text was deleted: whatever is typed next is a new word.
    if (event.key !== 'Shift' && event.key !== 'CapsLock') eggs.reset();
    return;
  }

  const now = Date.now();
  lastKeyAt = now;
  lifeKey(now);
  scheduleCaretLook();
  // A held key types, and she types along, but it counts for nothing: the
  // first press is the only one a person actually made.
  if (event.repeat) return;
  typed(printable ? 1 : 0, enter ? 1 : 0, now);
  if (printable) {
    const word = eggs.push(event.key);
    if (word) onEgg(word);
  } else {
    eggs.reset();
  }
}

/* ── The pointer ───────────────────────────────────────── */

let lastPointer = 0;

function onPointerMove(event: PointerEvent): void {
  // A dozen looks a second is plenty for a pair of pupils, and the handler
  // must cost nothing on the other ninety frames.
  if (event.timeStamp - lastPointer < 90) return;
  lastPointer = event.timeStamp;
  if (!motionOk() || !getSettings().nyuCompanion) return;
  lookAt(event.clientX, event.clientY);
}

/* ── Events from the rest of the app ───────────────────── */

let lastRegex = '';

function onEvent(event: NyuEvent): void {
  const { kind, detail } = event;
  switch (kind) {
    case 'saved':
      count('save');
      companionReact('saved', 4 * SECOND, {
        mood: 'happy',
        motion: 'nod',
        burst: 'stars',
        ms: 1_200,
      });
      return;
    case 'saved-all':
      count('save');
      companionReact('saved', 4 * SECOND, {
        mood: 'cheer',
        motion: 'hop',
        burst: 'stars',
        ms: 1_400,
      });
      return;
    case 'macro-played':
      count('macro');
      companionReact('macro', 5 * SECOND, {
        mood: 'cheer',
        motion: 'hop',
        burst: 'stars',
        ms: 1_400,
      });
      return;
    case 'find-empty':
      companionReact('find-empty', 20 * SECOND, {
        mood: 'puzzled',
        motion: 'wobble',
        burst: null,
        ms: 1_800,
      });
      return;
    case 'regex-found': {
      // Only a new pattern counts: pressing Enter through the matches of one
      // is still one piece of regex magic.
      const pattern = detail.text ?? '';
      if (pattern && pattern !== lastRegex) {
        lastRegex = pattern;
        count('regex');
      }
      return;
    }
    case 'replace-done':
      if ((detail.count ?? 0) >= 20) {
        companionReact('replace', 10 * SECOND, {
          mood: 'sparkle',
          motion: 'hop',
          burst: 'stars',
          ms: 1_600,
        });
      }
      return;
    case 'session-restored':
      companionReact('restored', MINUTE, {
        mood: 'cheer',
        motion: 'wave',
        burst: 'confetti',
        ms: 2_000,
      });
      companionSay(t('Alles wieder da (๑˃ᴗ˂)ﻭ'), 4 * SECOND);
      return;
    case 'file-opened':
      count('fileOpened');
      companionReact('opened', 10 * SECOND, {
        mood: 'happy',
        motion: 'peek',
        burst: null,
        ms: 1_100,
      });
      return;
    case 'tabs-many':
      if (
        companionReact('tabs', 15 * MINUTE, {
          mood: 'puzzled',
          motion: 'wobble',
          burst: null,
          ms: 2_000,
        })
      ) {
        companionSay(t('So viele Tabs! Nyu jongliert mit {count}.', { count: detail.count ?? 0 }));
      }
      return;
    case 'pomodoro-started':
      companionReact('pomodoro-start', 0, { mood: 'happy', motion: 'nod', burst: null, ms: 1_000 });
      companionSay(t('Los geht’s! Nyu passt auf die Zeit auf.'), 3 * SECOND);
      return;
    case 'pomodoro-done':
      count('pomodoro');
      companionReact('pomodoro', 0, {
        mood: 'cheer',
        motion: 'dance',
        burst: 'confetti',
        ms: 2_400,
      });
      return;
    case 'note-trashed':
      companionReact('note', 3 * SECOND, { mood: 'uwu', motion: 'wave', burst: null, ms: 1_400 });
      return;
    case 'note-restored':
      companionReact('note', 3 * SECOND, {
        mood: 'happy',
        motion: 'hop',
        burst: 'stars',
        ms: 1_400,
      });
      return;
    case 'history-restored':
      companionReact('history', 5 * SECOND, {
        mood: 'sparkle',
        motion: 'hop',
        burst: 'stars',
        ms: 1_600,
      });
      return;
    case 'zen-entered':
      // She leaves the room with everything she brought.
      clearCameo();
      hush();
      return;
    case 'zen-left':
      companionReact('zen', 0, { mood: 'happy', motion: 'wave', burst: null, ms: 1_200 });
      // What was unlocked while the room was quiet, in one toast. A moment
      // later, so it does not land in the same frame the furniture returns in.
      if (!noticeTimer && (pendingAchievements.length > 0 || pendingLevel)) {
        noticeSince = Date.now();
        noticeTimer = window.setTimeout(flushNotices, NOTICE_GATHER_MS);
      }
      return;
    case 'bookmark-added':
      companionReact('bookmark', 3 * SECOND, {
        mood: 'happy',
        motion: 'nod',
        burst: 'stars',
        ms: 1_000,
      });
      return;
  }
}

/* ── Tabs ──────────────────────────────────────────────── */

/** Above this many tabs she notices; the achievement wants 30. */
export const MANY_TABS = 20;
let lastTabCount = 0;

function onDocumentsChanged(): void {
  const open = allDocs().length;
  const previous = lastTabCount;
  lastTabCount = open;
  if (open === previous) return;
  if (getSettings().nyuLevels) {
    const before = getProgress();
    const next = noteTabs(before, open);
    if (next !== before) commitGain(next, before);
  }
  if (open >= MANY_TABS && previous < MANY_TABS) {
    onEvent({ kind: 'tabs-many', detail: { count: open }, at: Date.now() });
  }
}

/* ── The Pomodoro's ending ─────────────────────────────── */

function onPomodoroFinished(phase: PomodoroPhase, next: PomodoroState): void {
  const settings = getSettings();
  playChime();
  if (phase === 'focus') {
    const minutes =
      next.phase === 'longBreak'
        ? settings.pomodoroLongBreakMinutes
        : settings.pomodoroBreakMinutes;
    toast(
      'success',
      playful()
        ? t('Pomodoro geschafft! Zeit für {minutes} Minuten Pause. (=^･ω･^=)', { minutes })
        : t('Pomodoro beendet. {minutes} Minuten Pause.', { minutes }),
    );
    if (settings.nyuGimmicks && motionOk() && !zenShowing() && !document.hidden) {
      playCameo('tomato', { hat: currentHat() });
    }
    return;
  }
  toast(
    'info',
    playful() ? t('Pause vorbei. Nyu ist bereit, wenn du es bist.') : t('Pause vorbei.'),
    { label: t('Nächster Pomodoro'), run: () => startFocus() },
  );
}

/* ── Cameos and tips on a slow clock ───────────────────── */

/** A random wait between `min` and `max` minutes. */
function minutes(min: number, max: number): number {
  return (min + Math.random() * (max - min)) * MINUTE;
}

const OCCASION_CAMEOS: Partial<Record<Occasion, CameoName>> = {
  newyear: 'fireworks',
  birthday: 'birthday',
  easter: 'easter',
  valentine: 'hearts',
  friday13: 'blackcat',
  advent: 'snow',
  halloween: 'bat',
  night: 'night',
};

function cameosAllowed(): boolean {
  const settings = getSettings();
  return settings.nyuGimmicks && motionOk();
}

/** What to play when the slow clock comes round: an occasion's scene now and then, otherwise a peek. */
function pickCameo(now: Date): { name: CameoName; edge?: 'bottom' | 'right' } {
  if (getSettings().nyuOccasions && Math.random() < 0.5) {
    for (const occasion of occasionsOn(now)) {
      const name = OCCASION_CAMEOS[occasion];
      if (name) return { name };
    }
  }
  return { name: 'peek', edge: Math.random() < 0.5 ? 'bottom' : 'right' };
}

let cameoTimer = 0;

function scheduleCameo(wait: number): void {
  window.clearTimeout(cameoTimer);
  cameoTimer = window.setTimeout(cameoTick, wait);
}

function cameoTick(): void {
  if (!cameosAllowed()) return scheduleCameo(minutes(20, 40));
  // Not now: try again in a couple of minutes rather than waiting a whole
  // round, so a long typing session does not quietly mean "never".
  if (!quietMoment()) return scheduleCameo(2 * MINUTE);
  const choice = pickCameo(new Date());
  playCameo(choice.name, {
    hat: currentHat(),
    ...(choice.edge ? { edge: choice.edge } : {}),
    along: 0.2 + Math.random() * 0.6,
  });
  scheduleCameo(minutes(20, 40));
}

/** Once a day per occasion, a little after start-up: the birthday cake, the bat in October. */
function greetOccasion(): void {
  const settings = getSettings();
  if (!cameosAllowed() || !settings.nyuOccasions || !quietMoment()) return;
  const now = new Date();
  const today = localDay(now);
  const progress = getProgress();
  for (const occasion of occasionsOn(now)) {
    const name = OCCASION_CAMEOS[occasion];
    if (!name || progress.greeted[occasion] === today) continue;
    if (playCameo(name, { hat: currentHat(now) })) {
      setProgress({ ...progress, greeted: { ...progress.greeted, [occasion]: today } });
    }
    return;
  }
}

type Tip = { text: string; command?: string };

/** Short and useful; the keys are filled in from the real bindings, so a tip never lies. */
const TIPS: readonly Tip[] = [
  { text: N_('Wusstest du? Mit {keys} öffnest du die Befehlspalette.'), command: 'app.palette' },
  { text: N_('Tipp: {keys} sucht in allen Dateien des Ordners.'), command: 'find.inFiles' },
  { text: N_('Tipp: {keys} teilt das Fenster nach rechts.'), command: 'view.splitRight' },
  {
    text: N_('Wusstest du? {keys} holt den zuletzt geschlossenen Tab zurück.'),
    command: 'file.reopenClosed',
  },
  {
    text: N_('Tipp: {keys} nimmt ein Makro auf. Nyu schaut zu.'),
    command: 'macro.toggleRecording',
  },
  { text: N_('Tipp: {keys} blendet die Seitenleiste aus.'), command: 'view.toggleSidebar' },
  { text: N_('Tipp: {keys} springt zu einer Zeile.'), command: 'find.gotoLine' },
  { text: N_('Wusstest du? Ein Klick auf die Kodierung unten öffnet die Datei anders.') },
  { text: N_('Wusstest du? In der Befehlspalette wartet ein Nyu-Pomodoro.') },
  { text: N_('Wusstest du? Ein Doppelklick auf Nyu zeigt ihre Erfolge.') },
];

let tipTimer = 0;
let tipIndex = Math.floor(Math.random() * TIPS.length);

function scheduleTip(wait: number): void {
  window.clearTimeout(tipTimer);
  tipTimer = window.setTimeout(tipTick, wait);
}

function tipTick(): void {
  const settings = getSettings();
  if (!settings.nyuTips || !settings.nyuCompanion || !playful())
    return scheduleTip(minutes(25, 45));
  const now = Date.now();
  // Between two thoughts: not mid-sentence, and not to an empty room either.
  const between = typedWithin(3 * MINUTE, now) && !typedWithin(20 * SECOND, now);
  if (!quietMoment(now) || !between || getLife().pose === 'sleeping' || !document.hasFocus()) {
    return scheduleTip(3 * MINUTE);
  }
  for (let tries = 0; tries < TIPS.length; tries += 1) {
    tipIndex = (tipIndex + 1) % TIPS.length;
    const tip = TIPS[tipIndex];
    if (!tip) continue;
    const keys = tip.command ? shortcutLabel(tip.command) : undefined;
    if (tip.command && !keys) continue;
    companionSay(t(tip.text, keys ? { keys } : undefined), 7 * SECOND);
    break;
  }
  scheduleTip(minutes(25, 45));
}

/* ── Start ─────────────────────────────────────────────── */

/** Installs every listener; returns the teardown. Called once from `App.tsx`. */
export function startNyu(): () => void {
  const stopLife = startLife();
  const stopEvents = onNyu(onEvent);
  lastTabCount = allDocs().length;
  const stopDocuments = subscribeDocuments(onDocumentsChanged);

  setPomodoroFinishHandler(onPomodoroFinished);

  const onVisibility = () => {
    if (document.hidden) flushProgress();
    else checkPomodoro();
  };

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('beforeunload', flushProgress);

  countDay();
  const greetTimer = window.setTimeout(greetOccasion, 6 * SECOND);
  scheduleCameo(minutes(20, 40));
  scheduleTip(minutes(12, 20));

  return () => {
    stopLife();
    stopEvents();
    stopDocuments();
    setPomodoroFinishHandler(null);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('beforeunload', flushProgress);
    window.clearTimeout(greetTimer);
    window.clearTimeout(cameoTimer);
    window.clearTimeout(tipTimer);
    window.clearTimeout(noticeTimer);
    noticeTimer = 0;
    if (lookFrame) cancelAnimationFrame(lookFrame);
    lookFrame = 0;
    flushProgress();
  };
}
