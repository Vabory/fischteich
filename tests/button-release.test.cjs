"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class EventHub {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    if (force) this.add(value);
    else this.remove(value);
  }
}

function createButton(rect) {
  const button = {
    classList: new FakeClassList(),
    disabled: false,
    closest(selector) { return selector === "button" ? this : null; },
    contains(target) { return target === this; },
    getBoundingClientRect() { return rect; },
  };
  return button;
}

function pointerEvent(target, overrides = {}) {
  return {
    target,
    pointerId: 1,
    isPrimary: true,
    button: 0,
    clientX: 25,
    clientY: 25,
    ...overrides,
  };
}

function clickEvent(target, detail = 1) {
  return {
    target,
    detail,
    defaultPrevented: false,
    immediatePropagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.immediatePropagationStopped = true; },
  };
}

const documentTarget = new EventHub();
documentTarget.visibilityState = "visible";
documentTarget.pointTarget = null;
documentTarget.elementFromPoint = () => documentTarget.pointTarget;
const windowTarget = new EventHub();
windowTarget.document = documentTarget;
windowTarget.window = windowTarget;
windowTarget.setTimeout = () => 1;

const source = fs.readFileSync(path.join(__dirname, "..", "button-release.js"), "utf8");
vm.runInNewContext(source, { window: windowTarget, Date, Math, Map, WeakSet, Object });

const pressedClass = windowTarget.FischteichButtonRelease.pressedClass;
const first = createButton({ left: 0, right: 100, top: 0, bottom: 50 });
const second = createButton({ left: 0, right: 100, top: 60, bottom: 110 });

documentTarget.pointTarget = first;
documentTarget.emit("pointerdown", pointerEvent(first));
assert.equal(first.classList.contains(pressedClass), true, "pointerdown shows pressed immediately");
documentTarget.emit("pointerup", pointerEvent(first));
assert.equal(first.classList.contains(pressedClass), false, "valid release clears pressed");
const validClick = clickEvent(first);
documentTarget.emit("click", validClick);
assert.equal(validClick.defaultPrevented, false, "valid release keeps the one native click");

documentTarget.emit("pointerdown", pointerEvent(first));
documentTarget.pointTarget = null;
documentTarget.emit("pointermove", pointerEvent(first, { clientY: 55 }));
assert.equal(first.classList.contains(pressedClass), false, "leaving removes pressed");
documentTarget.emit("pointerup", pointerEvent(first, { clientY: 55 }));
const outsideClick = clickEvent(first);
documentTarget.emit("click", outsideClick);
assert.equal(outsideClick.defaultPrevented, true, "release outside suppresses a synthetic click");

documentTarget.pointTarget = first;
documentTarget.emit("pointerdown", pointerEvent(first));
documentTarget.pointTarget = second;
documentTarget.emit("pointermove", pointerEvent(second, { clientY: 75 }));
documentTarget.emit("pointerup", pointerEvent(second, { clientY: 75 }));
const crossedClick = clickEvent(second);
documentTarget.emit("click", crossedClick);
assert.equal(crossedClick.defaultPrevented, true, "dragging onto another button cannot activate it");

documentTarget.pointTarget = first;
documentTarget.emit("pointerdown", pointerEvent(first));
documentTarget.emit("pointermove", pointerEvent(first, { clientX: 30, clientY: 28 }));
assert.equal(first.classList.contains(pressedClass), true, "small movement inside stays pressed");
documentTarget.emit("pointercancel", pointerEvent(first));
assert.equal(first.classList.contains(pressedClass), false, "pointercancel clears pressed");
const canceledClick = clickEvent(first);
documentTarget.emit("click", canceledClick);
assert.equal(canceledClick.defaultPrevented, true, "pointercancel cannot fire an action");

documentTarget.pointTarget = first;
documentTarget.emit("pointerdown", pointerEvent(first));
documentTarget.emit("pointermove", pointerEvent(first, { clientY: 40 }));
documentTarget.emit("pointerup", pointerEvent(first, { clientY: 40 }));
const scrolledClick = clickEvent(first);
documentTarget.emit("click", scrolledClick);
assert.equal(scrolledClick.defaultPrevented, true, "movement beyond the tap threshold is canceled");

const keyboardClick = clickEvent(first, 0);
documentTarget.emit("click", keyboardClick);
assert.equal(keyboardClick.defaultPrevented, false, "keyboard and accessibility clicks remain native");

console.log("button release tests: ok");
