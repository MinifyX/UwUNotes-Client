/**
 * The one place a question from `lib/prompt.ts` becomes a dialog.
 *
 * `lib/files.ts` asks things it cannot answer itself — this file changed on
 * disk, this buffer has unsaved changes, this "text" file is full of NUL bytes
 * — from deep inside an `await`. It puts the question in a queue and sits on a
 * promise; this component renders whatever is at the front of that queue and
 * resolves it.
 *
 * Questions queue rather than stack, so exactly one is ever on screen. That is
 * the store's decision, not this component's: {@link usePrompt} hands over the
 * first one or nothing at all.
 *
 * Escape does not invent a fourth outcome. It picks the last choice, which every
 * call site in the app writes as the one that backs out.
 */

import { answerPrompt, dismissPrompt, usePrompt, type PromptChoice } from '../lib/prompt';
import { useLanguage } from '../lib/i18n';
import { Modal } from './Modal';

/**
 * Which button Enter lands on when the dialog opens.
 *
 * The first choice that does not destroy anything. A dialog whose only options
 * are destructive gets no default at all — the user has to aim, which is the
 * point of asking.
 */
function safeChoice(choices: PromptChoice[]): PromptChoice | undefined {
  return choices.find((choice) => choice.tone !== 'danger');
}

export function PromptHost() {
  useLanguage();
  const request = usePrompt();
  if (!request) return null;

  const safe = safeChoice(request.choices);

  return (
    <Modal
      title={request.title}
      onClose={() => dismissPrompt(request.id)}
      footer={
        <div className="prompt-choices">
          {request.choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              className="prompt-choice"
              data-tone={choice.tone ?? 'primary'}
              data-autofocus={choice.id === safe?.id ? true : undefined}
              onClick={() => answerPrompt(request.id, choice.id)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      }
    >
      {request.body ? <p className="prompt-body">{request.body}</p> : null}
    </Modal>
  );
}
