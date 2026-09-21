/**
 * Tools → Hash: MD5, SHA-1 and the SHA-2 family, for text or for files.
 *
 * Two sources, like Notepad++: text — the selection, the whole document or
 * whatever is typed or pasted into the box — and files, hashed byte for byte
 * as they are on disk so the result can be held against a download page's
 * checksum. Everything is computed in Rust (`uwunotes-fs::hash`), so a large
 * file streams rather than travelling through the page.
 *
 * A "compare with" field takes the published checksum and says whether it
 * matches, because comparing sixty-four hex digits by eye is how people miss
 * the one that differs.
 */

import { useEffect, useRef, useState } from 'react';
import { hashFile, hashText, pickFiles, asApiError, type HashAlgorithm } from '../lib/api';
import { closeDialog } from '../lib/commands';
import { docText } from '../lib/documents';
import { describeApiError } from '../lib/files';
import { HASH_ALGORITHMS, algorithmName, hashRequest, selectedText } from '../lib/hash-tool';
import { t, useLanguage } from '../lib/i18n';
import { toast } from '../lib/toast';
import { activeDocId } from '../lib/workspace';
import { Modal } from './Modal';

type FileResult = { path: string; digest: string | null; error: string | null };

export function HashDialog() {
  useLanguage();
  const request = useRef(hashRequest()).current;
  const [algorithm, setAlgorithm] = useState<HashAlgorithm>(request.algorithm);
  const [source, setSource] = useState<'text' | 'files'>(request.source);
  const [text, setText] = useState(() => selectedText());
  const [textDigest, setTextDigest] = useState('');
  const [files, setFiles] = useState<FileResult[]>([]);
  const [expected, setExpected] = useState('');

  // The text digest follows the typing; a short pause keeps a pasted
  // megabyte from being hashed once per keystroke.
  useEffect(() => {
    if (source !== 'text') return;
    let gone = false;
    const timer = setTimeout(() => {
      void hashText(text, algorithm)
        .then((digest) => {
          if (!gone) setTextDigest(digest);
        })
        .catch(() => undefined);
    }, 120);
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [text, algorithm, source]);

  // A new algorithm re-hashes the files already picked.
  const filePaths = files.map((file) => file.path).join('\n');
  useEffect(() => {
    if (!filePaths) return;
    let gone = false;
    const paths = filePaths.split('\n');
    void Promise.all(
      paths.map(async (path): Promise<FileResult> => {
        try {
          return { path, digest: await hashFile(path, algorithm), error: null };
        } catch (error) {
          return { path, digest: null, error: describeApiError(asApiError(error), path) };
        }
      }),
    ).then((results) => {
      if (!gone) setFiles(results);
    });
    return () => {
      gone = true;
    };
  }, [filePaths, algorithm]);

  const pick = async () => {
    const paths = await pickFiles().catch(() => []);
    if (paths.length > 0) setFiles(paths.map((path) => ({ path, digest: null, error: null })));
  };

  const copy = (digest: string) => {
    void navigator.clipboard.writeText(digest).then(
      () => toast('success', t('In die Zwischenablage kopiert.')),
      () => toast('error', t('Die Zwischenablage hat abgelehnt.')),
    );
  };

  const wanted = expected.trim().toLowerCase();
  const matches = (digest: string | null) =>
    wanted && digest ? (digest === wanted ? 'match' : 'differ') : null;
  const weak = HASH_ALGORITHMS.find((entry) => entry.id === algorithm)?.weak;

  return (
    <Modal title={t('Prüfsumme erzeugen')} onClose={closeDialog} wide>
      <div className="hashtool">
        <div className="hashtool-algorithms" role="radiogroup" aria-label={t('Verfahren')}>
          {HASH_ALGORITHMS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={algorithm === entry.id}
              className="hashtool-algorithm"
              onClick={() => setAlgorithm(entry.id)}
            >
              {entry.name}
            </button>
          ))}
        </div>
        {weak ? (
          <p className="hashtool-note">
            {t(
              '{algorithm} gilt als gebrochen: gut zum Vergleichen mit alten Prüfsummen, nicht als Schutz.',
              {
                algorithm: algorithmName(algorithm),
              },
            )}
          </p>
        ) : null}

        <div className="hashtool-sources" role="tablist" aria-label={t('Quelle')}>
          <button
            type="button"
            role="tab"
            aria-selected={source === 'text'}
            className="hashtool-source"
            onClick={() => setSource('text')}
          >
            {t('Text')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={source === 'files'}
            className="hashtool-source"
            onClick={() => setSource('files')}
          >
            {t('Dateien')}
          </button>
        </div>

        {source === 'text' ? (
          <>
            <div className="hashtool-fill">
              <button type="button" onClick={() => setText(selectedText())}>
                {t('Auswahl übernehmen')}
              </button>
              <button
                type="button"
                disabled={activeDocId() === null}
                onClick={() => {
                  const id = activeDocId();
                  if (id) setText(docText(id));
                }}
              >
                {t('Ganzes Dokument')}
              </button>
            </div>
            <textarea
              className="hashtool-text"
              value={text}
              spellCheck={false}
              aria-label={t('Text, dessen Prüfsumme erzeugt wird')}
              placeholder={t('Text hier eingeben oder einfügen')}
              data-autofocus
              onChange={(event) => setText(event.target.value)}
            />
            <Digest
              label={algorithmName(algorithm)}
              digest={textDigest}
              state={matches(textDigest)}
              onCopy={copy}
            />
          </>
        ) : (
          <>
            <button
              type="button"
              className="hashtool-pick"
              data-autofocus
              onClick={() => void pick()}
            >
              {t('Dateien auswählen…')}
            </button>
            {files.length === 0 ? (
              <p className="hashtool-empty">{t('Noch keine Dateien ausgewählt.')}</p>
            ) : (
              <ul className="hashtool-files">
                {files.map((file) => (
                  <li key={file.path}>
                    <span className="hashtool-file-path" title={file.path}>
                      {file.path}
                    </span>
                    {file.error ? (
                      <span className="hashtool-error">{file.error}</span>
                    ) : (
                      <Digest
                        label={algorithmName(algorithm)}
                        digest={file.digest ?? ''}
                        state={matches(file.digest)}
                        onCopy={copy}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <label className="hashtool-expected">
          <span>{t('Vergleichen mit')}</span>
          <input
            type="text"
            value={expected}
            spellCheck={false}
            autoComplete="off"
            placeholder={t('Veröffentlichte Prüfsumme einfügen')}
            onChange={(event) => setExpected(event.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}

function Digest({
  label,
  digest,
  state,
  onCopy,
}: {
  label: string;
  digest: string;
  state: 'match' | 'differ' | null;
  onCopy: (digest: string) => void;
}) {
  return (
    <div className="hashtool-digest" data-state={state ?? undefined}>
      <span className="hashtool-digest-label">{label}</span>
      <code className="hashtool-digest-value">{digest || '…'}</code>
      {state === 'match' ? <span className="hashtool-verdict">{t('stimmt überein')}</span> : null}
      {state === 'differ' ? <span className="hashtool-verdict">{t('weicht ab')}</span> : null}
      <button type="button" disabled={!digest} onClick={() => onCopy(digest)}>
        {t('Kopieren')}
      </button>
    </div>
  );
}
