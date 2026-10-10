import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('all crate results remain open until input, advance once, and resolve on final dismissal', async () => {
  class Element {
    constructor() {
      this.dataset={}; this.style={setProperty() {}}; this.listeners={}; this.open=false;
    }
    setAttribute() {}
    append() {}
    replaceWith() {}
    replaceChildren(...children) { this.children=children; }
    addEventListener(type,listener) { this.listeners[type]=listener; }
    showModal() { this.open=true; }
    focus() {}
    close() { this.open=false; this.listeners.close?.(); }
  }
  const saved = Object.fromEntries(['document','window','matchMedia','cancelAnimationFrame','setTimeout','console']
    .map(key=>[key,globalThis[key]]));
  let dialog, timers=0;
  try {
    globalThis.document={body:{append(element) {dialog=element;}},createElement:()=>new Element()};
    globalThis.window={};
    globalThis.matchMedia=()=>({matches:true});
    globalThis.cancelAnimationFrame=()=>{};
    globalThis.setTimeout=()=>{timers++; return 1;};
    globalThis.console={...console,error() {}};
    const source=readFileSync('soldier-supply-opening.mjs','utf8')
      .replace(/import \* as THREE .*;\r?\n/, 'const THREE={WebGLRenderer:class {constructor() {throw new Error("No graphics");}}};\n')
      .replace(/import \{ SUPPLY_PRODUCTS \} .*;\r?\n/, "const SUPPLY_PRODUCTS=['normal','advanced','special'].map(id=>({id,name:id}));\n");
    const {createSupplyOpening}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    for (const product of ['normal','advanced','special']) {
      const cards=[];
      const opening=createSupplyOpening((weapon)=>{cards.push(weapon); return weapon;},()=>{});
      let closed=false;
      const done=opening.open(product,[{weapon:'k2',grade:'D'},{weapon:'p90',grade:'S'}]).then(()=>{closed=true;});
      await Promise.resolve();
      assert.equal(dialog.open,true);
      assert.equal(dialog.dataset.phase,'revealed');
      assert.equal(timers,0);
      assert.equal(closed,false);
      dialog.dataset.phase='opening'; dialog.listeners.click();
      assert.equal(cards.at(-1),'k2');
      dialog.dataset.phase='revealed';
      dialog.listeners.click();
      assert.equal(dialog.open,true);
      assert.equal(cards.at(-1),'p90');
      dialog.listeners.keydown({key:'Enter',repeat:true,preventDefault() {}});
      assert.equal(dialog.open,true);
      dialog.listeners.keydown({key:'Enter',repeat:false,preventDefault() {}});
      await done;
      assert.equal(closed,true);
      assert.equal(dialog.open,false);
    }
  } finally {
    Object.assign(globalThis,saved);
  }
});
