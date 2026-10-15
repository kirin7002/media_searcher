import test from 'node:test';
import assert from 'node:assert/strict';
import { bindHeroSwipe } from '../frontend/hero-swipe.js';

function setup(count = 3) {
  const element = new EventTarget();
  let index = 0; const changes = [];
  bindHeroSwipe(element, { getIndex: () => index, getCount: () => count, onChange: value => { index = value; changes.push(value); } });
  let clock = 100;
  function send(type, options = {}) {
    const event = new Event(type, { cancelable: true });
    const { target, ...properties } = options;
    Object.assign(event, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 200, clientY: 150, ...properties });
    Object.defineProperty(event, 'timeStamp', { value: clock += 100 });
    if (target) Object.defineProperty(event, 'target', { value: target });
    element.dispatchEvent(event); return event;
  }
  const swipe = (x, y = 150) => { send('pointerdown'); send('pointerup', { clientX: x, clientY: y }); };
  return { send, swipe, changes };
}

test('swiping artwork cycles recommendations in both directions and wraps at each end', () => {
  const { swipe, changes } = setup();
  swipe(100); swipe(100); swipe(100); swipe(300);
  assert.deepEqual(changes, [1, 2, 0, 2]);
});

test('vertical scroll, small gestures, cancellation and multiple fingers never change recommendations', () => {
  const { swipe, send, changes } = setup();
  swipe(180); swipe(140, 260);
  send('pointerdown'); send('pointercancel'); send('pointerup', { clientX: 100 });
  send('pointerdown'); send('pointerdown', { pointerId: 2, isPrimary: false }); send('pointerup', { clientX: 100 });
  assert.deepEqual(changes, []);
});

test('buttons remain tappable and mouse movement does not trigger a touch swipe', () => {
  const { send, changes } = setup();
  send('pointerdown', { target: { closest: () => ({ tagName: 'BUTTON' }) } }); send('pointerup', { clientX: 100 });
  send('pointerdown', { pointerType: 'mouse' }); send('pointerup', { clientX: 100, pointerType: 'mouse' });
  const tap = send('click'); assert.equal(tap.defaultPrevented, false);
  assert.deepEqual(changes, []);
});

test('a completed swipe suppresses the synthetic click to prevent accidental actions', () => {
  const { swipe, send } = setup();
  swipe(100); assert.equal(send('click').defaultPrevented, true);
  for (let i = 0; i < 6; i++) send('pointermove');
  assert.equal(send('click').defaultPrevented, false);
});

test('keyboard arrows switch recommendations without hijacking button keys; one item never cycles', () => {
  const { send, changes } = setup();
  assert.equal(send('keydown', { key: 'ArrowRight' }).defaultPrevented, true);
  send('keydown', { key: 'ArrowLeft' });
  send('keydown', { key: 'ArrowRight', target: { closest: () => ({}) } });
  assert.deepEqual(changes, [1, 0]);
  const single = setup(1); single.swipe(100); single.send('keydown', { key: 'ArrowRight' }); assert.deepEqual(single.changes, []);
});
