import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_VIEWS, ROTATION_VIEWS, rotationPair, surfaceDepth, alignedX, posePoint } from './soldier-home-viewer.mjs';

test('reference images remain distinct and unchanged', () => {
  assert.equal(CHARACTER_VIEWS.length, 3);
  assert.equal(new Set(CHARACTER_VIEWS.map(view => view.src)).size, 3);
  assert.equal(CHARACTER_VIEWS[2].src, 'soldier-angle-back.png');
});

test('photo relief follows separate silhouette spans, with no depth in transparent gaps', () => {
  const spans = [[.1,.4],[.6,.9]];
  assert.equal(surfaceDepth(.5,spans,.38),0);
  assert.ok(surfaceDepth(.1,spans,.38)<1e-8);
  assert.ok(surfaceDepth(.25,spans,.38)>0);
  assert.ok(Math.abs(surfaceDepth(.25,spans,.38)-surfaceDepth(.75,spans,.38))<1e-10);
  assert.ok(surfaceDepth(.25,spans,.38)<.04);
  for(let x=0;x<=1;x+=.001) assert.ok(Number.isFinite(surfaceDepth(x,spans,.38)));
});

test('four supplied views wrap continuously and show exact original textures at their angles', () => {
  for (let i=0;i<ROTATION_VIEWS.length;i++) {
    const pair=rotationPair(ROTATION_VIEWS[i].angle);
    assert.equal(pair.from,i);
    assert.ok(pair.blend<1e-10);
    assert.ok(Math.abs(pair.yaw)<1e-10);
  }
  assert.deepEqual(rotationPair(0),rotationPair(Math.PI*2));
  for(let angle=-Math.PI*4;angle<Math.PI*4;angle+=.01){
    const pair=rotationPair(angle);
    assert.ok(pair.blend>=0 && pair.blend<=1);
    assert.ok(Number.isFinite(pair.yaw));
    const next=rotationPair(angle+.001);
    assert.ok(Math.abs(pair.yaw-next.yaw)<.01);
  }
});

test('angle interpolation aligns silhouette edges rather than drawing two displaced bodies', () => {
  assert.ok(Math.abs(alignedX(.2,[[.2,.8]],[[.4,.6]])-.4)<1e-10);
  assert.ok(Math.abs(alignedX(.8,[[.2,.8]],[[.4,.6]])-.6)<1e-10);
  assert.equal(alignedX(.5,[[.2,.8]],[[.4,.6]]),.5);
  assert.equal(alignedX(.5,[],[]),.5);
});

test('breathing and stretching deform continuously while the feet remain anchored', () => {
  assert.deepEqual(posePoint(.3,.9,1), {x:.3,y:.9,stretching:false});
  assert.notEqual(posePoint(.5,.25,1).y,posePoint(.5,.25,2).y);
  assert.equal(posePoint(.5,.2,33).stretching,true);
  for(let time=0;time<80;time+=.02){
    const a=posePoint(.7,.2,time),b=posePoint(.7,.2,time+.02);
    assert.ok(Math.abs(a.x-b.x)<.001 && Math.abs(a.y-b.y)<.001);
  }
});
