/** Where focus lands when a dialog opens. */

import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { Modal } from './Modal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const open = (body: ReactNode) => {
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  act(() => root!.render(createElement(Modal, { title: 'T', onClose: () => {}, children: body })));
};

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('the first focus in a dialog', () => {
  it('skips the corner cross for the first field', () => {
    open(createElement('input', { 'aria-label': 'Name' }));
    expect(document.activeElement).toBe(document.querySelector('input'));
  });

  it('falls back to the cross when nothing else can take focus', () => {
    open(createElement('p', null, 'Nur Text'));
    expect(document.activeElement?.closest('[data-secondary]')).not.toBeNull();
  });
});
