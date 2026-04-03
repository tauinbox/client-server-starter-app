import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyboardShortcutsService } from './keyboard-shortcuts.service';

function fireKey(
  doc: Document,
  options: {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
  },
  target?: EventTarget
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    ...options,
    bubbles: true,
    cancelable: true
  });
  if (target) {
    Object.defineProperty(event, 'target', { value: target, enumerable: true });
    (target as EventTarget).dispatchEvent(event);
  } else {
    doc.dispatchEvent(event);
  }
  return event;
}

describe('KeyboardShortcutsService', () => {
  let service: KeyboardShortcutsService;
  let doc: Document;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(KeyboardShortcutsService);
    doc = TestBed.inject(DOCUMENT);
  });

  it('register adds to shortcuts signal', () => {
    const cleanup = service.register('ctrl+s', 'Save', 'Forms', vi.fn());
    expect(service.shortcuts()).toHaveLength(1);
    expect(service.shortcuts()[0]).toEqual({
      key: 'ctrl+s',
      label: 'Save',
      group: 'Forms'
    });
    cleanup();
  });

  it('cleanup removes from shortcuts signal', () => {
    const cleanup = service.register('ctrl+s', 'Save', 'Forms', vi.fn());
    cleanup();
    expect(service.shortcuts()).toHaveLength(0);
  });

  it('stack: last registered handler fires, first does not', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const cleanup1 = service.register('ctrl+s', 'Save', 'Forms', handler1);
    const cleanup2 = service.register('ctrl+s', 'Save', 'Forms', handler2);

    fireKey(doc, { key: 's', ctrlKey: true });

    expect(handler2).toHaveBeenCalledOnce();
    expect(handler1).not.toHaveBeenCalled();
    cleanup1();
    cleanup2();
  });

  it('after unregistering top, lower handler fires', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const cleanup1 = service.register('ctrl+s', 'Save', 'Forms', handler1);
    const cleanup2 = service.register('ctrl+s', 'Save', 'Forms', handler2);
    cleanup2();

    fireKey(doc, { key: 's', ctrlKey: true });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).not.toHaveBeenCalled();
    cleanup1();
  });

  it('fires ? handler when ? key pressed', () => {
    const handler = vi.fn();
    const cleanup = service.register('?', 'Help', 'Global', handler);

    fireKey(doc, { key: '?', shiftKey: true });

    expect(handler).toHaveBeenCalledOnce();
    cleanup();
  });

  it('ctrl+s fires inside input element', () => {
    const handler = vi.fn();
    const cleanup = service.register('ctrl+s', 'Save', 'Forms', handler);

    const input = doc.createElement('input');
    doc.body.appendChild(input);
    fireKey(doc, { key: 's', ctrlKey: true }, input);
    doc.body.removeChild(input);

    expect(handler).toHaveBeenCalledOnce();
    cleanup();
  });

  it('? does NOT fire inside input element', () => {
    const handler = vi.fn();
    const cleanup = service.register('?', 'Help', 'Global', handler);

    const input = doc.createElement('input');
    doc.body.appendChild(input);
    fireKey(doc, { key: '?', shiftKey: true }, input);
    doc.body.removeChild(input);

    expect(handler).not.toHaveBeenCalled();
    cleanup();
  });

  it('? does NOT fire inside textarea element', () => {
    const handler = vi.fn();
    const cleanup = service.register('?', 'Help', 'Global', handler);

    const textarea = doc.createElement('textarea');
    doc.body.appendChild(textarea);
    fireKey(doc, { key: '?', shiftKey: true }, textarea);
    doc.body.removeChild(textarea);

    expect(handler).not.toHaveBeenCalled();
    cleanup();
  });

  it('calls preventDefault when handler is registered', () => {
    const cleanup = service.register('ctrl+s', 'Save', 'Forms', vi.fn());
    const event = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    doc.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalledOnce();
    cleanup();
  });

  it('does NOT call preventDefault when no handler is registered', () => {
    const event = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    doc.dispatchEvent(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it('normalises cmd+s correctly', () => {
    const handler = vi.fn();
    const cleanup = service.register('cmd+s', 'Save', 'Forms', handler);

    fireKey(doc, { key: 's', metaKey: true });

    expect(handler).toHaveBeenCalledOnce();
    cleanup();
  });

  it('shortcuts signal shows only top-of-stack entry per key', () => {
    const cleanup1 = service.register('ctrl+s', 'Save 1', 'Forms', vi.fn());
    const cleanup2 = service.register('ctrl+s', 'Save 2', 'Forms', vi.fn());

    const shortcuts = service.shortcuts();
    expect(shortcuts).toHaveLength(1);
    expect(shortcuts[0].label).toBe('Save 2');
    cleanup1();
    cleanup2();
  });
});
