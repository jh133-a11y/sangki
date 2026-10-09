import test from 'node:test';
import assert from 'node:assert/strict';
import { setupFullscreen } from './soldier-fullscreen.mjs';

function fixture(kind = 'standard', reject = false) {
  const events={}, attributes={};
  const button={setAttribute(key,value){attributes[key]=value;},addEventListener(name,fn){events[name]=fn;}};
  const status={textContent:''}, changes={};
  const doc={documentElement:{},addEventListener(name,fn){changes[name]=fn;}};
  const enter=async function() {
    assert.equal(this,doc.documentElement);
    if (reject) throw new Error('Denied');
    doc.fullscreenElement=doc.documentElement;
    changes.fullscreenchange();
  };
  const exit=async function() {
    assert.equal(this,doc);
    doc.fullscreenElement=null; changes.fullscreenchange();
  };
  if (kind === 'standard') { doc.documentElement.requestFullscreen=enter; doc.exitFullscreen=exit; }
  if (kind === 'webkit') { doc.documentElement.webkitRequestFullscreen=enter; doc.webkitExitFullscreen=exit; }
  setupFullscreen(button,status,doc);
  return {button,status,doc,events,attributes,changes};
}
test('standard and Safari fullscreen toggle state and reflect external exits',async () => {
  for (const kind of ['standard','webkit']) {
    const f=fixture(kind);
    assert.equal(f.button.disabled,false);
    await f.events.click();
    assert.equal(f.attributes['aria-pressed'],'true');
    assert.equal(f.attributes['aria-label'],'전체화면 종료');
    await f.events.click();
    assert.equal(f.attributes['aria-pressed'],'false');
    await f.events.click();
    f.doc.fullscreenElement=null;f.changes.fullscreenchange();
    assert.equal(f.attributes['aria-label'],'전체화면');
  }
});
test('unsupported browsers disable fullscreen with an explicit explanation',async () => {
  const f=fixture('unsupported');
  assert.equal(f.button.disabled,true);
  assert.match(f.button.title,/지원하지/);
  await f.events.click();
  assert.equal(f.doc.fullscreenElement,undefined);
});
test('fullscreen denial is reported and the button remains usable',async () => {
  const f=fixture('standard',true);
  const previous=console.error; console.error=()=>{};
  try { await f.events.click(); } finally { console.error=previous; }
  assert.match(f.status.textContent,/전체화면 전환 실패: Denied/);
  assert.equal(f.button.disabled,false);
  assert.equal(f.attributes['aria-pressed'],'false');
});
