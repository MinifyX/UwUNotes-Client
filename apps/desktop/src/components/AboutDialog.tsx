/**
 * Who this is, which version, and where the source lives.
 *
 * Also the one screen that has to keep working when something else does not:
 * the platform and the config directory come from Rust, and a person filing a
 * bug report needs to be able to read them out. So everything the page already
 * knows is on screen immediately and the answer from `appInfo()` fills in
 * beside it, rather than the box waiting on IPC before it shows anything.
 *
 * Links never navigate this window — a Tauri window that follows a link is a
 * Tauri window with a browser stuck in it. `openExternal()` hands the URL to
 * the system browser.
 */

import { useEffect, useState } from 'react';
import { appInfo, openExternal, type AppInfo } from '../lib/api';
import { closeDialog, useUiState } from '../lib/commands';
import { t } from '../lib/i18n';
import { APP_VERSION } from '../lib/settings';
import { toast } from '../lib/toast';
import { Nyu } from './nyu/Nyu';
import { Modal } from './Modal';

const REPOSITORY = 'https://github.com/MinifyX/UwUNotes-Client';
const LICENCE_URL = 'https://www.gnu.org/licenses/gpl-3.0.html';

/** The suite, in the order the three were written. */
const SIBLINGS = [
  { name: 'UwUMail', url: 'https://github.com/MinifyX/UwUMail-Client' },
  { name: 'UwUSSH', url: 'https://github.com/MinifyX/UwUSSH-Client' },
];

function open(url: string) {
  void openExternal(url).catch(() => {
    toast('error', t('Der Link ließ sich nicht öffnen.'));
  });
}

export function AboutDialog() {
  const { dialog } = useUiState();
  if (dialog !== 'about') return null;
  return <AboutBody />;
}

function AboutBody() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let alive = true;
    void appInfo()
      .then((answer) => {
        if (alive) setInfo(answer);
      })
      // No message: a missing platform string is a cosmetic gap in an about
      // box, not something to interrupt anyone over.
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const summary = [
    `UwUNotes ${APP_VERSION}`,
    info ? `${info.platform}` : null,
    info ? info.configDir : null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <Modal title={t('Über UwUNotes')} onClose={closeDialog}>
      <div className="about">
        <div className="about-mark">
          <Nyu size={112} mood="uwu" title={t('Nyu, die Notizblock-Katze')} />
        </div>

        <h3 className="about-name">UwUNotes</h3>
        <p className="about-tagline">
          {t('Ein Texteditor, der sagt, was er mit deiner Datei macht.')}
        </p>

        <dl className="about-facts">
          <div className="about-fact">
            <dt>{t('Version')}</dt>
            <dd>{APP_VERSION}</dd>
          </div>
          <div className="about-fact">
            <dt>{t('Plattform')}</dt>
            <dd>{info ? info.platform : '…'}</dd>
          </div>
          <div className="about-fact">
            <dt>{t('Einstellungen liegen in')}</dt>
            <dd className="about-path">{info ? info.configDir : '…'}</dd>
          </div>
          <div className="about-fact">
            <dt>{t('Lizenz')}</dt>
            <dd>
              <button type="button" className="about-inline-link" onClick={() => open(LICENCE_URL)}>
                GPL-3.0-only
              </button>
            </dd>
          </div>
        </dl>

        <ul className="about-links">
          <AboutLink label={t('Quellcode und Fehlerberichte')} url={REPOSITORY} />
          {SIBLINGS.map((sibling) => (
            <AboutLink key={sibling.name} label={sibling.name} url={sibling.url} />
          ))}
        </ul>

        <footer className="about-footer">
          <p className="about-note">
            {t('Teil der UwU Suite. Dieselbe Katze, dieselben Farben, andere Aufgabe.')}
          </p>
          <button
            type="button"
            className="about-copy"
            onClick={() => {
              void navigator.clipboard
                .writeText(summary)
                .then(() => toast('success', t('Versionsangaben kopiert.')))
                .catch(() => toast('error', t('Kopieren hat nicht geklappt.')));
            }}
          >
            {t('Versionsangaben kopieren')}
          </button>
        </footer>
      </div>
    </Modal>
  );
}

function AboutLink({ label, url }: { label: string; url: string }) {
  return (
    <li className="about-link">
      {/* A button and not an anchor: nothing in this window ever navigates, and
          an <a href> that quietly could is one misplaced click from a browser
          inside the editor. */}
      <button type="button" className="about-link-button" onClick={() => open(url)}>
        <span className="about-link-label">{label}</span>
        <span className="about-link-url">{url}</span>
      </button>
    </li>
  );
}
