"use strict";
// Minimal DOM fixture for existing structure/value tests; not a screenshot engine.
function createDocument(html) {
  const doc = { visibilityState: "visible", readyState: "complete", listeners: {},
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] ?? []).filter(item => item !== fn); } };
  class Element {
    constructor(tag = "div") {
      this.tagName = tag.toLowerCase(); this.attributes = {}; this.children = []; this.parentNode = null;
      this.ownerDocument = doc; this.dataset = {}; this.listeners = {}; this.text = "";
      this.style = { setProperty(k,v) { this[k] = v; }, removeProperty(k) { delete this[k]; } };
      this.classList = { add: (...values) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...values])].join(" "); },
        remove: (...values) => { this.className = this.className.split(/\s+/).filter(c => !values.includes(c)).join(" "); },
        contains: value => this.className.split(/\s+/).includes(value),
        toggle: (value, on) => { if (on) this.classList.add(value); else this.classList.remove(value); } };
    }
    get id() { return this.attributes.id ?? ""; } set id(value) { this.attributes.id = value; }
    get className() { return this.attributes.class ?? ""; } set className(value) { this.attributes.class = value; }
    get hidden() { return "hidden" in this.attributes; } set hidden(on) { if (on) this.attributes.hidden = ""; else delete this.attributes.hidden; }
    get disabled() { return "disabled" in this.attributes; } set disabled(on) { if (on) this.attributes.disabled = ""; else delete this.attributes.disabled; }
    get isConnected() { return this === doc.body || Boolean(this.parentNode?.isConnected); }
    setAttribute(key, value) {
      this.attributes[key] = String(value);
      if (key.startsWith("data-")) this.dataset[key.slice(5).replace(/-([a-z])/g, (_,c) => c.toUpperCase())] = String(value);
    }
    getAttribute(key) { return this.attributes[key] ?? null; }
    hasAttribute(key) { return key in this.attributes; }
    append(...elements) { for (const element of elements) { element.remove(); element.parentNode = this; this.children.push(element); } }
    prepend(...elements) { for (const element of elements.reverse()) { element.remove(); element.parentNode = this; this.children.unshift(element); } }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; }
    replaceChildren(...elements) { for (const c of [...this.children]) c.remove(); this.text = ""; this.append(...elements); }
    get textContent() { return this.text + this.children.map(c => c.textContent).join(""); }
    set textContent(value) { this.replaceChildren(); this.text = String(value); }
    set innerHTML(value) { this.replaceChildren(); parse(value, this); }
    cloneNode(deep) {
      const clone = new Element(this.tagName); for (const [k,v] of Object.entries(this.attributes)) clone.setAttribute(k,v);
      clone.text = this.text; if (deep) clone.append(...this.children.map(c => c.cloneNode(true))); return clone;
    }
    querySelectorAll(selector) {
      const match = element => {
        if (selector === "*") return true;
        if (selector === "button:not(:disabled)") return element.tagName === "button" && !element.disabled;
        if (selector.startsWith("#")) return element.id === selector.slice(1);
        if (selector.startsWith(".")) return element.classList.contains(selector.slice(1));
        return element.tagName === selector;
      };
      const descendants = element => element.children.flatMap(c => [c, ...descendants(c)]);
      return descendants(this).filter(match);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    click() { if (!this.disabled) for (const fn of this.listeners.click ?? []) fn({ target: this, stopPropagation() {} }); }
    focus() { doc.activeElement = this; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 390, height: 844 }; }
  }
  function parse(markup, root) {
    const stack = [root];
    const voids = new Set(["img","br","meta","link","input","hr","source"]);
    for (const token of markup.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) ?? []) {
      if (token.startsWith("<!")) continue;
      if (token.startsWith("</")) { if (stack.length > 1) stack.pop(); continue; }
      if (!token.startsWith("<")) { stack.at(-1).text += token; continue; }
      const tag = token.match(/^<([\w-]+)/)?.[1]; if (!tag) continue;
      const element = new Element(tag);
      const attrs = token.slice(tag.length + 1, -1);
      for (const m of attrs.matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) element.setAttribute(m[1], m[2] ?? m[3] ?? m[4] ?? "");
      stack.at(-1).append(element); if (!voids.has(tag)) stack.push(element);
    }
  }
  doc.body = new Element("body");
  doc.createElement = tag => new Element(tag);
  doc.querySelector = selector => doc.body.querySelector(selector);
  doc.querySelectorAll = selector => doc.body.querySelectorAll(selector);
  doc.activeElement = doc.body;
  // Script bodies are irrelevant to markup and would confuse this tiny parser.
  parse(html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, ""), doc.body);
  return doc;
}
module.exports = { createDocument };
