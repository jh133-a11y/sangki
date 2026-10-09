import * as THREE from './vendor/three.module.min.js';

export function createSoldierModel(combat = false) {
  const model = new THREE.Group();
  const material = color => new THREE.MeshStandardMaterial({ color, roughness: .85 });
  const skin = material('#c3a087'), shirt = material('#ccc9bf'), vest = material('#424737');
  const strap = material('#706c55'), dark = material('#292e2a'), scarf = material('#743c3e');
  const hair = [material('#897858'), material('#a18f6a'), material('#655b46')];
  const eyeWhite = material('#d9d3bd'), iris = material('#593e2a'), pupil = material('#161511');
  const ear = material('#a37c67');
  let seed = 21;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const cloth = document.createElement('canvas'); cloth.width = cloth.height = 512;
  const paint = cloth.getContext('2d'); paint.fillStyle = '#827a5d'; paint.fillRect(0,0,512,512);
  for (let i = 0; i < 300; i++) {
    paint.fillStyle = ['#484e3a','#aaa07e','#635e46','#333e30'][i%4];
    const x = random()*512, y = random()*512;
    paint.beginPath();
    for (let j = 0; j < 8; j++) {
      const a = j*Math.PI/4, r = 10+random()*30;
      if (!j) paint.moveTo(x+Math.cos(a)*r,y+Math.sin(a)*r);
      else paint.lineTo(x+Math.cos(a)*r,y+Math.sin(a)*r);
    }
    paint.closePath(); paint.fill();
  }
  const camoMap = new THREE.CanvasTexture(cloth); camoMap.colorSpace = THREE.SRGBColorSpace;
  const camo = new THREE.MeshStandardMaterial({ map: camoMap, roughness: 1 });
  const pattern = document.createElement('canvas'); pattern.width = pattern.height = 128;
  const weave = pattern.getContext('2d'); weave.fillStyle = '#703336'; weave.fillRect(0,0,128,128);
  for (let y = 0; y < 128; y += 16) for (let x = 0; x < 128; x += 16) {
    weave.fillStyle = '#321e22';
    weave.fillRect(x,y,9,7); weave.fillRect(x+5,y+5,7,9); weave.fillRect(x+10,y+10,6,5);
  }
  const scarfMap = new THREE.CanvasTexture(pattern); scarfMap.colorSpace = THREE.SRGBColorSpace;
  scarfMap.wrapS = scarfMap.wrapT = THREE.RepeatWrapping; scarfMap.repeat.set(3,2);
  scarf.map = scarfMap; scarf.color.set('#fff');
  function mesh(geometry, mat, x, y, z, scale = [1,1,1], parent = model) {
    const object = new THREE.Mesh(geometry, mat); object.position.set(x,y,z); object.scale.set(...scale); parent.add(object); return object;
  }
  const sphere = (mat,x,y,z,sx,sy,sz,parent) => mesh(new THREE.SphereGeometry(1,combat?16:32,combat?12:24),mat,x,y,z,[sx,sy,sz],parent);
  function loft(mat, rings, x=0, z=0, parent=model) {
    const vertices=[], uv=[], indices=[], steps=combat?20:40;
    for (let r=0; r<rings.length; r++) {
      const [y,rx,rz] = rings[r];
      for (let i=0; i<=steps; i++) {
        const a=i/steps*Math.PI*2; vertices.push(Math.sin(a)*rx,y,Math.cos(a)*rz); uv.push(i/steps,r/(rings.length-1));
        if (r<rings.length-1 && i<steps) {
          const k=r*(steps+1)+i, n=k+steps+1; indices.push(k,k+1,n,k+1,n+1,n);
        }
      }
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); geometry.setIndex(indices); geometry.computeVertexNormals();
    return mesh(geometry,mat,x,0,z,[1,1,1],parent);
  }
  function panel(mat,x,y,z,w,h,d,parent=model) {
    const shape=new THREE.Shape(), r=Math.min(w,h)*.13;
    shape.moveTo(-w/2+r,-h/2); shape.lineTo(w/2-r,-h/2); shape.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);
    shape.lineTo(w/2,h/2-r); shape.quadraticCurveTo(w/2,h/2,w/2-r,h/2);
    shape.lineTo(-w/2+r,h/2); shape.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);
    shape.lineTo(-w/2,-h/2+r); shape.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:d,bevelEnabled:true,bevelSize:.004,bevelThickness:.004,bevelSegments:2,steps:1,curveSegments:4});
    geometry.translate(0,0,-d/2); return mesh(geometry,mat,x,y,z,[1,1,1],parent);
  }
  function line(mat, points, radius=.003, parent=model) {
    return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),combat?10:20,radius,combat?4:6,false),mat,0,0,0,[1,1,1],parent);
  }
  loft(shirt,[[1.03,.17,.1],[1.2,.2,.12],[1.43,.235,.135],[1.56,.235,.115],[1.64,.064,.064]]);
  loft(vest,[[1.08,.19,.14],[1.23,.21,.155],[1.43,.222,.157],[1.55,.18,.12]]);
  for (const x of [-.17,.17]) {
    line(strap,[[x,1.44,.15],[x,1.62,0],[x,1.44,-.15]],.022);
    for (const z of [-.161,.167]) panel(strap,x,1.45,z,.045,.19,.014);
  }
  for (const y of [1.15,1.24,1.33,1.42]) {
    panel(strap,0,y,.164,.39,.026,.012); panel(strap,0,y,-.155,.37,.026,.012);
    for (const x of [-.14,-.07,0,.07,.14]) panel(dark,x,y,.176,.007,.03,.005);
  }
  panel(dark,0,1.33,.183,.011,.43,.009);
  for (const x of [-.11,.11]) { panel(vest,x,1.12,.19,.15,.13,.046); panel(strap,x,1.17,.22,.14,.023,.012); }
  sphere(camo,0,.95,0,.215,.16,.135);
  loft(dark,[[1,.215,.135],[1.04,.214,.136]]);
  panel(strap,0,1.02,.144,.063,.04,.015);
  for (const side of [-1,1]) {
    const x=side*.113;
    loft(camo,[[.5,.082,.09],[.57,.097,.104],[.72,.106,.116],[.86,.111,.121],[.96,.101,.109]],x);
    loft(camo,[[.2,.071,.077],[.31,.078,.09],[.43,.087,.104],[.54,.086,.092]],x,.008);
    panel(dark,x,.54,.104,.145,.185,.035);
    panel(strap,x,.53,-.1,.17,.026,.013);
    panel(vest,side*.235,.85,0,.093,.19,.126); panel(strap,side*.237,.93,0,.099,.024,.135);
    for (const y of [.3,.38,.65]) sphere(camo,x,y,.006,.09,.018,.103);
    loft(dark,[[.045,.09,.116],[.1,.088,.108],[.2,.077,.084],[.255,.072,.08]],x);
    sphere(dark,x,.07,.112,.096,.067,.158);
    panel(dark,x,.023,.064,.194,.033,.331);
    for (let i=0;i<6;i++) {
      const y=.085+i*.02;
      line(strap,[[x-.034,y,.156],[x+.034,y+.015,.148]]);
      line(strap,[[x+.034,y,.159],[x-.034,y+.015,.15]]);
    }
    const arm=new THREE.Group(); arm.position.set(side*.266,1.55,0); arm.rotation.z=side*.1;
    if (combat) arm.rotation.x = -.9;
    model.add(arm);
    loft(shirt,[[-.32,.071,.078],[-.26,.078,.084],[-.13,.087,.093],[-.025,.085,.079],[.015,.053,.05]],0,0,arm);
    for (const y of [-.265,-.288,-.31]) sphere(shirt,0,y,0,.078,.012,.084,arm);
    loft(skin,[[-.535,.043,.048],[-.47,.055,.062],[-.36,.058,.06],[-.31,.057,.057]],0,.005,arm);
    sphere(dark,0,-.585,.015,.052,.073,.036,arm);
    panel(dark,0,-.537,.01,.103,.034,.083,arm);
    sphere(dark,-side*.047,-.584,.043,.018,.043,.018,arm);
    for (let i=0;i<4;i++) {
      const fx=-.032+i*.021; sphere(dark,fx,-.641,.018,.01,.032,.018,arm); sphere(skin,fx,-.665,.021,.009,.013,.014,arm);
    }
  }
  sphere(skin,0,1.665,0,.064,.101,.066);
  for (let i=0;i<4;i++) {
    const ring=mesh(new THREE.TorusGeometry(.097+i*.012,.025,12,48),scarf,0,1.645-i*.028,.006,[1,1,1]);
    ring.rotation.x=Math.PI/2+.12;
  }
  sphere(scarf,0,1.554,.124,.114,.085,.036);
  panel(scarf,.028,1.534,.143,.114,.123,.012).rotation.z=-.15;
  loft(skin,[[1.715,.032,.04],[1.74,.059,.061],[1.785,.083,.077],[1.845,.108,.095],[1.915,.109,.095],[1.971,.094,.088],[2.008,.044,.035],[2.015,.001,.001]]);
  for (const side of [-1,1]) {
    sphere(skin,side*.112,1.854,0,.018,.036,.025);
    sphere(ear,side*.119,1.85,.017,.008,.021,.008);
    const x=side*.046;
    sphere(eyeWhite,x,1.866,.085,.025,.008,.013);
    sphere(iris,x,1.865,.097,.007,.007,.003);
    sphere(pupil,x,1.865,.1,.0035,.004,.002);
    line(skin,[[x-.025,1.866,.087],[x,1.88,.097],[x+.025,1.866,.087]],.004);
    line(hair[2],[[x-.026,1.894,.085],[x,1.904,.094],[x+.023,1.889,.089]],.006);
    line(skin,[[side*.016,1.886,.097],[side*.011,1.906,.092]],.002);
  }
  sphere(skin,0,1.843,.098,.014,.035,.018); sphere(skin,0,1.822,.116,.019,.012,.015);
  line(material('#886050'),[[-.031,1.778,.075],[0,1.779,.09],[.031,1.778,.075]],.003);
  line(material('#b18776'),[[-.027,1.772,.078],[0,1.769,.091],[.027,1.772,.078]],.004);
  const scalp=mesh(new THREE.SphereGeometry(1,40,24,0,Math.PI*2,0,Math.PI*.56),hair[0],0,1.929,-.011,[.114,.097,.105]);
  scalp.rotation.x=-.1;
  mesh(new THREE.SphereGeometry(1,32,20,Math.PI,Math.PI,0,Math.PI*.72),hair[2],0,1.913,-.016,[.114,.116,.103]);
  for (let i=0;i<(combat ? 35 : 100);i++) {
    const x=(random()-.5)*.19, z=(random()-.5)*.15;
    line(hair[i%3],[[x,1.982-Math.abs(x)*.2,z],[x+.012,2.023-Math.abs(x)*.15,z-.01],[x+.025,2.035-Math.abs(x)*.15,z-.04]],.004);
  }
  for (const x of [-.104,.104]) sphere(hair[2],x,1.917,-.017,.01,.046,.061);
  if (combat) {
    panel(dark,.2,1.2,.36,.072,.087,.48);
    panel(strap,.2,1.13,.22,.065,.17,.065);
    // Batch identical materials to keep multiplayer draw calls bounded on mobile.
    model.updateMatrixWorld(true);
    const batches = new Map();
    model.traverse(object => {
      if (!object.isMesh) return;
      const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      if (!batches.has(object.material)) batches.set(object.material, []);
      batches.get(object.material).push(geometry);
      object.geometry.dispose();
    });
    model.clear();
    for (const [mat, geometries] of batches) {
      const combined = new THREE.BufferGeometry();
      for (const [attribute, size] of [['position',3],['normal',3],['uv',2]]) {
        const length = geometries.reduce((sum, geometry) => sum + geometry.getAttribute(attribute).array.length, 0);
        const array = new Float32Array(length);
        let offset = 0;
        for (const geometry of geometries) {
          const values = geometry.getAttribute(attribute).array;
          array.set(values, offset); offset += values.length;
        }
        combined.setAttribute(attribute, new THREE.BufferAttribute(array, size));
      }
      model.add(new THREE.Mesh(combined, mat));
      for (const geometry of geometries) geometry.dispose();
    }
  }
  model.userData.character = 'black-water';
  return model;
}

export function createHomeCharacter(canvas, status) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(), model = createSoldierModel();
  scene.add(model, new THREE.HemisphereLight('#e4edf5', '#4e4336', 2));
  for (const [color, intensity, position] of [['#ffecd5', 2.6, [-2,4,4]], ['#b9d7f5', 2, [2,3,-3]]]) {
    const light = new THREE.DirectionalLight(color, intensity); light.position.set(...position); scene.add(light);
  }
  const camera = new THREE.PerspectiveCamera(32, 1, .05, 20);
  camera.position.set(0, 1.12, 3.9); camera.lookAt(0, 1.04, 0);
  let yaw=0, drag=null;
  function rotate(value) { yaw=value%(Math.PI*2); model.rotation.y=yaw; canvas.dataset.rotation=String(yaw); }
  rotate(0); canvas.dataset.modelReady='true';
  canvas.addEventListener('pointerdown',event=>{
    if (event.button!==0 || drag) return;
    drag={id:event.pointerId,x:event.clientX}; canvas.setPointerCapture(event.pointerId); canvas.focus({preventScroll:true}); event.preventDefault();
  });
  canvas.addEventListener('pointermove',event=>{
    if (drag?.id!==event.pointerId) return;
    rotate(yaw+(event.clientX-drag.x)*.012); drag.x=event.clientX;
  });
  const cancel=()=>{drag=null;};
  for (const type of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(type,event=>{if(drag?.id===event.pointerId)cancel();});
  window.addEventListener('blur',cancel);
  canvas.addEventListener('keydown',event=>{
    if (event.code==='ArrowLeft'||event.code==='ArrowRight') { rotate(yaw+(event.code==='ArrowLeft'?-.15:.15)); event.preventDefault(); }
    if (event.code==='Home') { rotate(0); event.preventDefault(); }
  });
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();status.textContent='3D 화면 연결이 끊겼습니다. 새로고침하세요.';});
  function resize() {
    const {width,height}=canvas.getBoundingClientRect(); if(!width||!height)return;
    renderer.setSize(width,height,false); camera.aspect=width/height;
    camera.position.z=Math.max(3.9,1.1/(Math.tan(16*Math.PI/180)*camera.aspect)); camera.updateProjectionMatrix();
  }
  const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
  return {render:()=>renderer.render(scene,camera),cancelDrag:cancel};
}
