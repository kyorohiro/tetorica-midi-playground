import test from 'node:test';
import assert from 'node:assert/strict';
import {installPerformanceShortcuts} from '../ui/performance-shortcuts.js';

function keyEvent(properties) {
  return Object.assign(new Event('keydown', {cancelable: true}), properties);
}

test('Cmd/Ctrl Enter prevents both native newline and subsequent editor handlers', () => {
  for (const modifier of ['metaKey', 'ctrlKey']) {
    const target = new EventTarget();
    let runs = 0;
    let editorKeys = 0;
    installPerformanceShortcuts({target, onRun: () => runs++, onStop() {}});
    target.addEventListener('keydown', () => editorKeys++);

    const event = keyEvent({key: 'Enter', [modifier]: true});
    assert.equal(target.dispatchEvent(event), false);
    assert.equal(event.defaultPrevented, true);
    assert.equal(runs, 1);
    assert.equal(editorKeys, 0);

    const repeat = keyEvent({key: 'Enter', [modifier]: true, repeat: true});
    target.dispatchEvent(repeat);
    assert.equal(repeat.defaultPrevented, true);
    assert.equal(runs, 1);
    assert.equal(editorKeys, 0);
  }
});

test('ordinary Enter, open dialogs and composition continue to the editor', () => {
  const target = new EventTarget();
  let dialogOpen = false;
  let runs = 0;
  let editorKeys = 0;
  installPerformanceShortcuts({target, hasOpenDialog: () => dialogOpen, onRun: () => runs++, onStop() {}});
  target.addEventListener('keydown', () => editorKeys++);

  const events = [
    keyEvent({key: 'Enter'}),
    keyEvent({key: 'Enter', metaKey: true, isComposing: true}),
    keyEvent({key: 'Enter', ctrlKey: true, keyCode: 229}),
  ];
  for (const event of events) assert.equal(target.dispatchEvent(event), true);
  dialogOpen = true;
  assert.equal(target.dispatchEvent(keyEvent({key: 'Enter', metaKey: true})), true);
  assert.equal(editorKeys, 4);
  assert.equal(runs, 0);
});

test('Shift Escape stops once, also with a dialog open, and disposal removes shortcuts', () => {
  const target = new EventTarget();
  let stops = 0;
  let runs = 0;
  let editorKeys = 0;
  const shortcuts = installPerformanceShortcuts({
    target, hasOpenDialog: () => true, onRun: () => runs++, onStop: () => stops++,
  });
  target.addEventListener('keydown', () => editorKeys++);

  assert.equal(target.dispatchEvent(keyEvent({key: 'Escape', shiftKey: true})), false);
  assert.equal(target.dispatchEvent(keyEvent({key: 'Escape', shiftKey: true, repeat: true})), false);
  assert.equal(stops, 1);
  assert.equal(editorKeys, 0);

  shortcuts.dispose();
  shortcuts.dispose();
  assert.equal(target.dispatchEvent(keyEvent({key: 'Escape', shiftKey: true})), true);
  assert.equal(target.dispatchEvent(keyEvent({key: 'Enter', ctrlKey: true})), true);
  assert.equal(stops, 1);
  assert.equal(runs, 0);
  assert.equal(editorKeys, 2);
});
