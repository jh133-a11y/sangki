import * as THREE from './vendor/three.module.min.js';
import { SUPPLY_PRODUCTS } from './soldier-supply.mjs?v=1';

export const OPENING_TIMING = { turn: 200, lid: 360, flash: 400, reveal: 780, finish: 1300 };

function crateModel(color) {
  const root = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color, metalness: .2, roughness: .25 });
  const band = new THREE.MeshStandardMaterial({ color: '#939c9b', metalness: .85, roughness: .25 });
  const inside = new THREE.MeshStandardMaterial({ color: '#101720', roughness: .9 });
  function box(parent, w, h, d, x, y, z, material) {
    const bevel = Math.min(w,h,d)*.2;
    const shape = new THREE.Shape();
    shape.moveTo(-w/2+bevel,-h/2+bevel);
    shape.lineTo(w/2-bevel,-h/2+bevel); shape.lineTo(w/2-bevel,h/2-bevel);
    shape.lineTo(-w/2+bevel,h/2-bevel); shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape,{depth:d-2*bevel,bevelEnabled:true,
      bevelThickness:bevel,bevelSize:bevel,bevelSegments:3,steps:1});
    geometry.translate(0,0,-d/2+bevel);
    const mesh = new THREE.Mesh(geometry,material);
    mesh.position.set(x,y,z); parent.add(mesh); return mesh;
  }
  box(root,1.7,.12,1.7,0,-.75,0,shell);
  for (const z of [-.8,.8]) box(root,1.7,1.3,.12,0,-.07,z,shell);
  for (const x of [-.8,.8]) box(root,.12,1.3,1.7,x,-.07,0,shell);
  box(root,1.44,.04,1.44,0,-.67,0,inside);
  for (const x of [-.55,.55]) {
    for (const z of [-.866,.866]) box(root,.025,1.28,.025,x,-.07,z,band);
  }
  for (const z of [-.866,.866]) box(root,1.73,.08,.025,0,.02,z,band);
  for (const x of [-.866,.866]) box(root,.025,.08,1.73,x,.02,0,band);
  const hinge = new THREE.Group(); hinge.position.set(0,.6,-.85); root.add(hinge);
  box(hinge,1.78,.28,1.78,0,.05,.85,shell);
  box(hinge,1.5,.02,1.5,0,-.1,.85,inside);
  for (const x of [-.55,.55]) box(hinge,.035,.025,1.78,x,.2,.85,band);
  for (const z of [.3,1.4]) box(hinge,1.78,.025,.035,0,.2,z,band);
  return { root, hinge };
}

export function createSupplyOpening(renderCard, reportError) {
  const dialog = document.createElement('dialog'); dialog.id = 'supply-opening-dialog';
  dialog.setAttribute('aria-labelledby','supply-opening-title');
  const title = document.createElement('h2'); title.id = 'supply-opening-title'; title.className='supply-accessible-status';
  const counter = document.createElement('span'); counter.className='supply-opening-counter';
  counter.setAttribute('aria-label','남은 보급함');
  const stage = document.createElement('div'); stage.className = 'supply-opening-stage';
  let canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden','true');
  const burst = document.createElement('div'); burst.className = 'supply-burst';
  const particles = document.createElement('div'); particles.className = 'supply-particles';
  for (let i=0;i<24;i++) {
    const spark = document.createElement('i'); spark.style.setProperty('--angle',`${i*137.5}deg`);
    spark.style.setProperty('--distance',`${90+i%6*22}px`);
    spark.style.setProperty('--delay',`${i%7*25}ms`); particles.append(spark);
  }
  const reward = document.createElement('div'); reward.className = 'supply-opening-reward';
  stage.append(canvas,burst,particles,reward);
  const status = document.createElement('p'); status.setAttribute('role','status'); status.className='supply-accessible-status';
  dialog.append(title,counter,stage,status);
  document.body.append(dialog);
  let renderer, scene, camera, crate, frame=0, current=0, rewards=[], resolveClose, special=false, graphicsAvailable=false;
  let context, timers=[];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function clear() {
    cancelAnimationFrame(frame);
    for (const timer of timers) clearTimeout(timer);
    timers=[];
  }
  function tone(frequency,duration,delay,volume) {
    if (!context || context.state !== 'running') return;
    timers.push(setTimeout(() => {
      if (!dialog.open) return;
      const osc=context.createOscillator(), gain=context.createGain();
      osc.type='triangle'; osc.frequency.setValueAtTime(frequency,context.currentTime);
      osc.frequency.exponentialRampToValueAtTime(frequency*.45,context.currentTime+duration);
      gain.gain.setValueAtTime(volume,context.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001,context.currentTime+duration);
      osc.connect(gain); gain.connect(context.destination); osc.start(); osc.stop(context.currentTime+duration);
    },delay));
  }
  function finish() {
    clear(); dialog.dataset.phase='revealed';
    reward.replaceChildren(renderCard(rewards[current].weapon,rewards[current]));
    status.textContent=`${current+1}/${rewards.length} · ${rewards[current].grade}급 무기 획득 · 인벤토리에 저장됨`;
    counter.textContent=`× ${rewards.length-current-1}`;
    if (special) return;
    timers.push(setTimeout(() => {
      if (!dialog.open) return;
      if (current+1<rewards.length) { current++; play(); } else dialog.close();
    },700));
  }
  function play() {
    clear();
    counter.textContent=`× ${rewards.length-current}`;
    status.textContent=`보급함 개봉 중 · ${current+1}/${rewards.length}`;
    reward.replaceChildren(renderCard(rewards[current].weapon,rewards[current]));
    dialog.dataset.phase='idle';
    void stage.offsetWidth;
    dialog.dataset.phase='opening';
    if (reduced.matches || !graphicsAvailable) {
      if (graphicsAvailable) {
        crate.root.rotation.y=Math.PI*.23; crate.hinge.rotation.x=-Math.PI*.6;
        renderer.render(scene,camera);
      }
      finish(); return;
    }
    tone(260,.12,0,.07); tone(420,.15,240,.07); tone(1100,.4,400,.08); tone(1600,.25,780,.04);
    const start=performance.now();
    const tick = now => {
      const elapsed=now-start;
      const turn=Math.min(elapsed/OPENING_TIMING.turn,1);
      const lid=Math.min(Math.max((elapsed-200)/160,0),1);
      crate.root.rotation.y=turn*Math.PI*.23;
      crate.hinge.rotation.x=-lid*Math.PI*.6;
      crate.root.position.y=Math.sin(Math.min(elapsed/400,1)*Math.PI)*.08;
      renderer.render(scene,camera);
      if (elapsed>=OPENING_TIMING.finish) { finish(); return; }
      frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
  }
  function dispose() {
    clear();
    if (scene) {
      const materials=new Set();
      scene.traverse(object => {
        object.geometry?.dispose();
        if (object.material) materials.add(object.material);
      });
      materials.forEach(material => material.dispose());
    }
    renderer?.dispose(); renderer?.forceContextLoss(); renderer=null; scene=null; crate=null; graphicsAvailable=false;
  }
  function advance() {
    if (!special || dialog.dataset.phase!=='revealed') return;
    if (current+1<rewards.length) { current++; play(); } else dialog.close();
  }
  dialog.addEventListener('click',advance);
  dialog.addEventListener('keydown',event => {
    if (event.key==='Enter' || event.key===' ') { event.preventDefault(); if (!event.repeat) advance(); }
  });
  dialog.addEventListener('close',() => { dispose(); resolveClose?.(); resolveClose=null; });
  return {
    async open(product,items) {
      const spec=SUPPLY_PRODUCTS.find(entry => entry.id===product);
      if (!spec || !items.length) throw new Error('개봉할 보급함 보상이 없습니다.');
      rewards=items; current=0; special=product==='special'; counter.hidden=!special;
      title.textContent=spec.name; dialog.tabIndex=-1; dialog.showModal(); dialog.focus();
      try {
        const Audio=window.AudioContext||window.webkitAudioContext;
        if (Audio) {
          context ||= new Audio();
          await context.resume();
        }
      } catch (error) { console.warn('보급함 효과음 시작 실패',error); reportError('효과음을 재생할 수 없습니다.'); }
      try {
        const previousCanvas = canvas;
        canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden','true');
        previousCanvas.replaceWith(canvas);
        canvas.addEventListener('webglcontextlost',event => {
          if (!dialog.open || event.target !== canvas) return;
          event.preventDefault();
          reportError('3D 그래픽 연결이 중단되어 획득 결과를 표시합니다.');
          graphicsAvailable=false; finish();
        });
        renderer=new THREE.WebGLRenderer({ canvas,alpha:true,antialias:true });
        renderer.setSize(420,360); renderer.setPixelRatio(Math.min(devicePixelRatio,2));
        scene=new THREE.Scene(); camera=new THREE.PerspectiveCamera(35,420/360,.1,50);
        camera.position.set(0,2.4,7.5); camera.lookAt(0,.35,0);
        scene.add(new THREE.HemisphereLight('#ffffff','#303745',3));
        const light=new THREE.DirectionalLight('#ffffff',4); light.position.set(-3,5,4); scene.add(light);
        crate=crateModel(spec.color); scene.add(crate.root);
        graphicsAvailable=true;
      } catch (error) {
        console.error('보급함 3D 연출 시작 실패',error); dispose();
        reportError(`3D 연출을 표시할 수 없습니다: ${error.message}. 획득 결과를 표시합니다.`);
      }
      return new Promise(resolve => { resolveClose=resolve; play(); });
    }
  };
}
