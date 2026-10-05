import assert from 'node:assert/strict';
import test from 'node:test';
import { FlightControls } from '../src/input';
import { persistControlSettings } from '../src/control-settings';
import { FixedStepper, FlightSession } from '../src/game-state';
import { KeyboardSettings } from '../src/keyboard-settings';

class ElementStub extends EventTarget {
  readonly style = {
    left: '', top: '',
    setProperty() {},
    removeProperty() {},
  };
  readonly classList = {
    values: new Set<string>(),
    add: (name: string) => this.classList.values.add(name),
    remove: (name: string) => this.classList.values.delete(name),
    contains: (name: string) => this.classList.values.has(name),
  };
  readonly attributes = new Map<string, string>();
  app: ElementStub | null = null;
  child: ElementStub | null = null;
  isContentEditable = false;
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  closest(selector: string) { return selector === '#app' ? this.app : null; }
  querySelector() { return this.child; }
  getBoundingClientRect() { return { left: 0, top: 0 }; }
  setPointerCapture() {}
  hasPointerCapture() { return false; }
  releasePointerCapture() {}
  append() {}
}

function eventWith(type: string, values: Record<string, unknown> = {}): Event {
  return Object.assign(new Event(type, { cancelable: true }), values);
}

function inputFixture() {
  const original = ['window', 'document', 'HTMLElement', 'localStorage'].map(name =>
    [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const win = Object.assign(new EventTarget(), { visualViewport: new EventTarget() });
  const joystick = new ElementStub();
  const app = new ElementStub(); app.child = joystick;
  const surface = new ElementStub(); surface.app = app;
  const doc = Object.assign(new EventTarget(), {
    hidden: false,
    getElementById: () => app,
    createElement: () => joystick,
  });
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: ElementStub });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  const buttons = {
    fire: new ElementStub(), loop: new ElementStub(),
    accelerate: new ElementStub(), brake: new ElementStub(),
  };
  const keyboard = new KeyboardSettings();
  const controls = new FlightControls(surface as unknown as HTMLElement, buttons as unknown as ConstructorParameters<typeof FlightControls>[1], () => true, keyboard);
  const pointer = (type: string, pointerId: number, x = 100, y = 100, isPrimary = true) => eventWith(type, {
    pointerId, pointerType: 'touch', clientX: x, clientY: y,
    button: 0, buttons: 1, isPrimary,
  });
  const key = (type: string, code: string) => eventWith(type, {
    code, key: code === 'ArrowRight' ? 'ArrowRight' : code,
    repeat: false, isComposing: false, ctrlKey: false, altKey: false, metaKey: false,
  });
  return {
    win, surface, joystick, buttons, keyboard, controls, pointer, key,
    restore() {
      controls.dispose();
      for (const [name, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

test('pointercancel releases its own steering and button owners while preserving another active pointer', () => {
  const fixture = inputFixture();
  try {
    fixture.surface.dispatchEvent(fixture.pointer('pointerdown', 11));
    fixture.win.dispatchEvent(fixture.pointer('pointermove', 11, 140, 100));
    fixture.buttons.fire.dispatchEvent(fixture.pointer('pointerdown', 22, 100, 100, false));
    fixture.buttons.accelerate.dispatchEvent(fixture.pointer('pointerdown', 33, 100, 100, false));
    assert.equal(fixture.joystick.classList.contains('visible'), true);
    assert.equal(fixture.buttons.fire.getAttribute('aria-pressed'), 'true');

    fixture.win.dispatchEvent(fixture.pointer('pointercancel', 22));
    assert.equal(fixture.buttons.fire.getAttribute('aria-pressed'), 'false');
    assert.equal(fixture.buttons.accelerate.getAttribute('aria-pressed'), 'true');
    assert.equal(fixture.controls.peek().steerPointer, 11);
    assert.ok(fixture.controls.sample().turn > 0);

    fixture.win.dispatchEvent(fixture.pointer('pointercancel', 11));
    assert.equal(fixture.joystick.classList.contains('visible'), false);
    assert.equal(fixture.controls.peek().steerPointer, null);
    assert.equal(fixture.controls.sample().turn, 0);
    assert.equal(fixture.buttons.accelerate.getAttribute('aria-pressed'), 'true');
  } finally { fixture.restore(); }
});

test('resize and blur clear held pointer and keyboard state so stale input cannot resume flight', () => {
  const fixture = inputFixture();
  try {
    for (const resetEvent of ['resize', 'blur']) {
      fixture.surface.dispatchEvent(fixture.pointer('pointerdown', resetEvent === 'resize' ? 41 : 51));
      fixture.win.dispatchEvent(fixture.pointer('pointermove', resetEvent === 'resize' ? 41 : 51, 140, 100));
      fixture.buttons.fire.dispatchEvent(fixture.pointer('pointerdown', resetEvent === 'resize' ? 42 : 52, 100, 100, false));
      fixture.win.dispatchEvent(fixture.key('keydown', 'ArrowRight'));
      assert.equal(fixture.buttons.fire.getAttribute('aria-pressed'), 'true');
      assert.ok(fixture.controls.sample().turn > 0);

      fixture.win.dispatchEvent(new Event(resetEvent));
      assert.equal(fixture.joystick.classList.contains('visible'), false);
      assert.equal(fixture.controls.peek().steerPointer, null);
      assert.equal(fixture.buttons.fire.getAttribute('aria-pressed'), 'false');
      assert.equal(fixture.controls.sample().turn, 0);
      assert.equal(fixture.controls.sample().fire, false);
    }
  } finally { fixture.restore(); }
});

test('settings writes roll back earlier keys after a later write fails', () => {
  const values = new Map([
    ['gekichin-controls-v2', 'old layout'],
    ['gekichin-keyboard-v1', 'old keys'],
  ]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem(key: string, value: string) {
      if (key === 'gekichin-keyboard-v1' && value === 'new keys') throw new Error('simulated quota limit');
      values.set(key, value);
    },
    removeItem: (key: string) => { values.delete(key); },
  };

  assert.equal(persistControlSettings([
    { key: 'gekichin-controls-v2', value: 'new layout' },
    { key: 'gekichin-keyboard-v1', value: 'new keys' },
  ], storage), false);
  assert.equal(values.get('gekichin-controls-v2'), 'old layout');
  assert.equal(values.get('gekichin-keyboard-v1'), 'old keys');
});

test('future settings versions block the whole save without touching any stored value', () => {
  const future = JSON.stringify({ version: 2, bindings: { future: 'format' } });
  const values = new Map([
    ['gekichin-controls-v2', 'old layout'],
    ['gekichin-keyboard-v1', future],
  ]);
  let writes = 0;
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem(key: string, value: string) { writes += 1; values.set(key, value); },
    removeItem(key: string) { writes += 1; values.delete(key); },
  };

  assert.equal(persistControlSettings([
    { key: 'gekichin-controls-v2', value: 'new layout' },
    { key: 'gekichin-keyboard-v1', value: 'old-format replacement' },
  ], storage), false);
  assert.equal(writes, 0);
  assert.equal(values.get('gekichin-controls-v2'), 'old layout');
  assert.equal(values.get('gekichin-keyboard-v1'), future);
});

test('a wall-clock gap of two seconds discards accumulated time and needs a later fresh frame', () => {
  const stepper = new FixedStepper();
  const flight = new FlightSession();
  let steps = 0;
  let gaps = 0;
  const step = () => { steps += 1; flight.step({ turn: 0, climb: 0, fire: false, loop: false }); };
  const gap = () => { gaps += 1; flight.pause('gap'); };

  assert.equal(flight.prepare('easy'), 1);
  assert.equal(flight.begin(1), true);
  stepper.frame(0, true, step, gap);
  assert.equal(stepper.frame(1000 / 60, true, step, gap), 1);
  assert.equal(flight.tick, 1);
  assert.equal(stepper.frame(2200, true, step, gap), 0);
  assert.equal(gaps, 1);
  assert.equal(steps, 1);
  assert.equal(flight.phase, 'paused');
  assert.equal(flight.pauseReason, 'gap');

  assert.equal(stepper.frame(2216, false, step, gap), 0);
  assert.equal(steps, 1);
  assert.equal(flight.resume(), true);
  assert.equal(stepper.frame(2232, true, step, gap), 0, 'the first resumed frame only establishes a new baseline');
  assert.equal(stepper.frame(2248, true, step, gap), 1);
  assert.equal(steps, 2);
  assert.equal(flight.tick, 2);
});
