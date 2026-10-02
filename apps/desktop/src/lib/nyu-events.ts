/**
 * The one way the rest of the app tells Nyu that something happened.
 *
 * A file saved, a macro played, a search that found nothing: the places where
 * these happen call `emitNyu()` and move on. They do not know whether Nyu is
 * visible, whether levels are switched on, or whether anything is listening at
 * all — `lib/nyu.ts` subscribes once at start-up and decides what each event is
 * worth (a reaction from the companion, some XP, an achievement). That keeps the
 * call sites to one line each and keeps the mascot out of `lib/files.ts`.
 *
 * Synchronous and fire-and-forget. A listener that throws is caught here, so a
 * bug in a sparkle can never fail the save that triggered it.
 *
 * The rule from KONZEPT §7 applies to the call sites: emit only for things that
 * went *well* or are harmless. A failed save, a conflict, a lossy decode — no
 * event. Nyu has nothing to add to a warning.
 */

/** Every kind of event Nyu understands. Kinds without a caller yet are wired by other features. */
export const NYU_EVENT_KINDS = [
  /** A file went to disk because the user asked (not autosave). */
  'saved',
  /** "Save all" wrote more than one file. `count` is how many. */
  'saved-all',
  /** A macro finished playing. `count` is the number of repetitions. */
  'macro-played',
  /** Find in the current file found nothing. */
  'find-empty',
  /** A regular-expression search found something. `text` is the pattern. */
  'regex-found',
  /** "Replace all" changed something. `count` is the number of replacements. */
  'replace-done',
  /** The last session came back with documents in it. `count` is how many. */
  'session-restored',
  /** A file was read from disk into a new tab. */
  'file-opened',
  /** Many tabs are open at once. `count` is how many. Emitted by `lib/nyu.ts` itself. */
  'tabs-many',
  /** A focus round of the Nyu-Pomodoro ended. */
  'pomodoro-done',
  /** A Nyu-Pomodoro round started. */
  'pomodoro-started',
  // ── From the notebook, Zeitreise, zen mode and bookmarks. ──
  /** A note went into the note trash. */
  'note-trashed',
  /** A note came back out of the trash. */
  'note-restored',
  /** An older version came back from the local history ("Zeitreise"). */
  'history-restored',
  /** Zen mode was switched on. */
  'zen-entered',
  /** Zen mode was switched off. */
  'zen-left',
  /** A bookmark was set on a line. */
  'bookmark-added',
] as const;

export type NyuEventKind = (typeof NYU_EVENT_KINDS)[number];

/** Optional details. Everything is optional, so a call site passes only what it has. */
export type NyuEventDetail = {
  count?: number;
  text?: string;
};

export type NyuEvent = { kind: NyuEventKind; detail: NyuEventDetail; at: number };

type Listener = (event: NyuEvent) => void;

const listeners = new Set<Listener>();

/** Tells Nyu that something happened. Never throws, never waits. */
export function emitNyu(kind: NyuEventKind, detail: NyuEventDetail = {}): void {
  const event: NyuEvent = { kind, detail, at: Date.now() };
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch (error) {
      // Decoration must not break the action it decorates. Logged rather than
      // swallowed silently, so the bug is still findable.
      console.error('Nyu listener failed', error);
    }
  }
}

/** Subscribes to every event; returns the unsubscribe. */
export function onNyu(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
