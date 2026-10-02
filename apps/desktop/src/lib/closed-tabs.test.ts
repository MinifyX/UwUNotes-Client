/**
 * Ctrl+Shift+T brings tabs back in the order they were closed — files and
 * trashed notes mixed, because that is the order the user closed them in.
 */

import { describe, expect, it } from 'vitest';
import { createClosedStack } from './closed-tabs';

describe('the closed-tab stack', () => {
  it('pops in reverse close order across both kinds', () => {
    const stack = createClosedStack();
    stack.push({ kind: 'path', path: '/notes/a.txt' });
    stack.push({ kind: 'trash', id: 't1' });
    stack.push({ kind: 'path', path: '/notes/b.txt' });

    expect(stack.pop()).toEqual({ kind: 'path', path: '/notes/b.txt' });
    expect(stack.pop()).toEqual({ kind: 'trash', id: 't1' });
    expect(stack.pop()).toEqual({ kind: 'path', path: '/notes/a.txt' });
    expect(stack.pop()).toBeUndefined();
  });

  it('keeps one entry per file, at the top', () => {
    const stack = createClosedStack();
    stack.push({ kind: 'path', path: '/notes/a.txt' });
    stack.push({ kind: 'path', path: '/notes/b.txt' });
    stack.push({ kind: 'path', path: '/notes/a.txt' });

    expect(stack.size()).toBe(2);
    expect(stack.pop()).toEqual({ kind: 'path', path: '/notes/a.txt' });
  });

  it('forgets a trash entry that came back another way', () => {
    const stack = createClosedStack();
    stack.push({ kind: 'trash', id: 't1' });
    stack.push({ kind: 'trash', id: 't2' });
    stack.forgetTrash('t2');

    expect(stack.pop()).toEqual({ kind: 'trash', id: 't1' });
  });

  it('drops the oldest past its limit', () => {
    const stack = createClosedStack(2);
    stack.push({ kind: 'trash', id: 't1' });
    stack.push({ kind: 'trash', id: 't2' });
    stack.push({ kind: 'trash', id: 't3' });

    expect(stack.size()).toBe(2);
    stack.pop();
    expect(stack.pop()).toEqual({ kind: 'trash', id: 't2' });
  });
});
