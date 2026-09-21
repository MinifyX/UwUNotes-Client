/**
 * Questions with buttons, as a promise.
 *
 * `window.confirm` blocks the whole page and cannot be styled or translated,
 * and a React dialog cannot be awaited from inside `lib/files.ts`, which is
 * where all the awkward questions come from ("this file changed on disk, now
 * what?"). So the request goes into a queue here, the shell renders whatever is
 * at the front of it, and {@link answerPrompt} resolves the promise the caller
 * is sitting on.
 *
 * Requests queue rather than stack: two dialogs on top of each other is how a
 * user ends up answering the wrong one. This module deliberately has no timeout
 * — a question that answers itself is not a question.
 */

import { useSyncExternalStore } from 'react';
import { t } from './i18n';

export type PromptChoice = {
  id: string;
  label: string;
  /** `primary` is the safe default, `danger` loses something, `quiet` backs out. */
  tone?: 'primary' | 'danger' | 'quiet';
};

export type PromptRequest = {
  id: number;
  title: string;
  body?: string;
  choices: PromptChoice[];
  /** A one-line text field above the buttons, for {@link askText}. */
  input?: { value: string; label: string };
};

let queue: readonly PromptRequest[] = [];
const resolvers = new Map<number, (choice: string) => void>();
const listeners = new Set<() => void>();
let counter = 0;

function announce() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function current(): PromptRequest | null {
  return queue[0] ?? null;
}

/** The question to show right now, or `null` when there is nothing to ask. */
export function usePrompt(): PromptRequest | null {
  return useSyncExternalStore(subscribe, current);
}

/** Resolves with the id of the chosen button. */
export function ask(
  title: string,
  body: string | undefined,
  choices: PromptChoice[],
): Promise<string> {
  // A question with no answers is a bug in the caller, not a dialog to render.
  if (choices.length === 0) return Promise.resolve('');
  counter += 1;
  const id = counter;
  return new Promise<string>((resolve) => {
    resolvers.set(id, resolve);
    queue = [...queue, { id, title, body, choices }];
    announce();
  });
}

/**
 * A question with a text field: a new file name, say.
 *
 * Resolves with what was typed when the user confirms, and `null` when they
 * back out. The value travels through {@link setPromptInput} while they type,
 * so the dialog component holds no state of its own.
 */
export async function askText(
  title: string,
  body: string | undefined,
  options: { value: string; label: string; confirm: string },
): Promise<string | null> {
  counter += 1;
  const id = counter;
  const answer = await new Promise<string>((resolve) => {
    resolvers.set(id, resolve);
    queue = [
      ...queue,
      {
        id,
        title,
        body,
        input: { value: options.value, label: options.label },
        choices: [
          { id: 'ok', label: options.confirm, tone: 'primary' },
          { id: 'cancel', label: t('Abbrechen'), tone: 'quiet' },
        ],
      },
    ];
    announce();
  });
  const value = typed.get(id) ?? options.value;
  typed.delete(id);
  return answer === 'ok' ? value : null;
}

/** What is in the text field of a request, as the user types it. */
const typed = new Map<number, string>();

export function setPromptInput(id: number, value: string): void {
  typed.set(id, value);
  queue = queue.map((request) =>
    request.id === id && request.input
      ? { ...request, input: { ...request.input, value } }
      : request,
  );
  announce();
}

export function answerPrompt(id: number, choice: string): void {
  const resolve = resolvers.get(id);
  resolvers.delete(id);
  const next = queue.filter((request) => request.id !== id);
  if (next.length !== queue.length) {
    queue = next;
    announce();
  }
  resolve?.(choice);
}

/**
 * Escape, or a click on the backdrop.
 *
 * The last choice is the one that backs out — every call site in the app puts
 * "Abbrechen" at the end — so dismissing picks it rather than inventing a
 * fourth outcome nobody handles.
 */
export function dismissPrompt(id: number): void {
  const request = queue.find((entry) => entry.id === id);
  const choice = request?.choices[request.choices.length - 1]?.id ?? '';
  answerPrompt(id, choice);
}
