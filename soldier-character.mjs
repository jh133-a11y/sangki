import * as THREE from './vendor/three.module.min.js';

const WIDTH = 149, HEIGHT = 427, SCALE = 2.1 / HEIGHT;

export async function loadCharacterTextures() {
  async function image(src) {
    const result = new Image(); result.src = src;
    try { await result.decode(); }
    catch (error) { throw new Error(`캐릭터 사진을 불러오지 못했습니다: ${src}`, {cause:error}); }
    return result;
  }
  const [body, portrait] = await Promise.all([
    image('soldier-home-character.png'), image('soldier-character-card.png')
  ]);
  const expanded = document.createElement('canvas'); expanded.width = WIDTH; expanded.height = HEIGHT;
  const source = expanded.getContext('2d'); source.drawImage(body,0,0);
  const pixels = source.getImageData(0,0,WIDTH,HEIGHT);
  // Extend edge colors into the transparent background for clean side UV sampling.
  for (let y=0;y<HEIGHT;y++) {
    const opaque=[];
    for(let x=0;x<WIDTH;x++)if(pixels.data[(y*WIDTH+x)*4+3]>128)opaque.push(x);
    if(!opaque.length)continue;
    for(let x=0;x<WIDTH;x++) {
      const offset=(y*WIDTH+x)*4;
      if(pixels.data[offset+3]>128)continue;
      let nearest=opaque[0];
      for(const candidate of opaque)if(Math.abs(candidate-x)<Math.abs(nearest-x))nearest=candidate;
      const from=(y*WIDTH+nearest)*4;
      for(let channel=0;channel<3;channel++)pixels.data[offset+channel]=pixels.data[from+channel];
      pixels.data[offset+3]=255;
    }
  }
  source.putImageData(pixels,0,0);
  const front = document.createElement('canvas'); front.width = WIDTH * 8; front.height = HEIGHT * 8;
  const ctx = front.getContext('2d'); ctx.scale(8, 8); ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(expanded, 0, 0);
  // The card is a three-quarter portrait. Mirror its near cheek around the nose
  // to estimate a frontal face without stretching the far cheek across the head.
  ctx.save();
  ctx.beginPath(); ctx.ellipse(69, 34.5, 15.2, 20.5, 0, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(portrait, 451, 331, 322, 619, 53.5, 15, 15.5, 40);
  ctx.translate(138, 0); ctx.scale(-1, 1);
  ctx.drawImage(portrait, 451, 331, 322, 619, 53.5, 15, 15.5, 40);
  ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.moveTo(51,18); ctx.lineTo(55,5); ctx.lineTo(68,1); ctx.lineTo(82,6); ctx.lineTo(86,20); ctx.closePath(); ctx.clip();
  ctx.drawImage(portrait, 480, 100, 330, 270, 51, 1, 35, 20);
  ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.moveTo(48,55);ctx.lineTo(82,55);ctx.lineTo(91,63);ctx.lineTo(77,83);ctx.lineTo(57,76);ctx.closePath();ctx.clip();
  ctx.globalAlpha=.42;
  ctx.drawImage(portrait,240,844,164,170,46,54,47,31);
  ctx.restore();

  const back = document.createElement('canvas'); back.width = front.width; back.height = front.height;
  const rear = back.getContext('2d'); rear.scale(8, 8); rear.imageSmoothingQuality = 'high';
  rear.drawImage(expanded, 0, 0);
  function patch(source, sx, sy, sw, sh, x, y, w, h) {
    rear.drawImage(source, sx, sy, sw, sh, x, y, w, h);
  }
  // Unseen surfaces use sampled fabric/hair instead of mirroring a face or front buckle.
  patch(portrait, 453, 230, 113, 188, 48, 0, 43, 53);
  rear.fillStyle = '#bd9679'; rear.fillRect(56, 48, 30, 18);
  patch(portrait, 240, 844, 164, 170, 42, 56, 57, 23);
  patch(body, 53, 93, 36, 38, 41, 78, 60, 108);
  patch(body, 43, 204, 22, 43, 31, 189, 89, 63);
  patch(body, 42, 227, 17, 33, 28, 260, 43, 102);
  patch(body, 95, 227, 16, 32, 80, 260, 45, 104);
  for (const y of [103, 121, 140, 158]) {
    rear.fillStyle = '#6f6b52'; rear.fillRect(42, y, 55, 3);
    rear.fillStyle = '#363829'; rear.fillRect(42, y + 3, 55, 1);
    rear.strokeStyle = '#9b9172'; rear.lineWidth = .3;
    for (let x = 46; x < 97; x += 9) { rear.beginPath(); rear.moveTo(x,y); rear.lineTo(x,y+3); rear.stroke(); }
  }
  patch(body, 45, 73, 8, 22, 43, 76, 8, 37);
  patch(body, 85, 76, 8, 22, 88, 76, 8, 37);
  rear.fillStyle = '#454337'; rear.fillRect(40, 180, 66, 6);
  for (const x of [48, 87]) {
    patch(body, 113, 209, 18, 30, x, 210, 18, 26);
    rear.strokeStyle = '#595641'; rear.lineWidth = .5; rear.strokeRect(x, 211, 18, 25);
  }
  function sharpen(canvas) {
    const context=canvas.getContext('2d'), image=context.getImageData(0,0,canvas.width,canvas.height);
    const original=new Uint8ClampedArray(image.data), stride=canvas.width*4;
    for(let y=1;y<canvas.height-1;y++)for(let x=1;x<canvas.width-1;x++){
      const i=y*stride+x*4;
      for(let c=0;c<3;c++){
        const blur=(original[i-4+c]+original[i+4+c]+original[i-stride+c]+original[i+stride+c])/4;
        image.data[i+c]=original[i+c]+.35*(original[i+c]-blur);
      }
    }
    context.putImageData(image,0,0);
  }
  sharpen(front);sharpen(back);
  const texture = canvas => {
    const result = new THREE.CanvasTexture(canvas); result.colorSpace = THREE.SRGBColorSpace;
    result.userData.persistent = true; return result;
  };
  return { front: texture(front), back: texture(back) };
}

// Cross sections follow the photo silhouette in pixel coordinates. Unlike a billboard,
// every section has front/back depth, side surfaces, normals and closed end caps.
export function createSoldierModel(combat = false, textures = {}) {
  const model = new THREE.Group(), steps = combat ? 24 : 48;
  const materials = [textures.front, textures.back].map(map => new THREE.MeshStandardMaterial({
    map: map || null, color: map ? '#fff' : '#756c54', roughness: .95,
    metalness: 0, side: THREE.FrontSide
  }));
  function section(rings, face = false) {
    const position = [], uv = [], indices = [], groups = [];
    for (let r = 0; r < rings.length; r++) {
      const [y, left, right, depth, centerZ = 0] = rings[r];
      const cx = (left + right) / 2, radius = (right - left) / 2;
      for (let i = 0; i <= steps; i++) {
        const angle = i / steps * Math.PI * 2, x = cx + Math.sin(angle) * radius;
        const nose = face && Math.cos(angle)>0 ? .018*Math.exp(-(((x-69)/4)**2)-(((y-32)/8)**2)) : 0;
        position.push((x - WIDTH / 2) * SCALE, (HEIGHT - y) * SCALE, centerZ + Math.cos(angle) * depth + nose);
        // A small inset avoids transparent background pixels along the photographed outline.
        const sampleX = cx + Math.sin(angle) * Math.max(0, radius - 1.2);
        uv.push(sampleX / WIDTH, 1 - y / HEIGHT);
        if (r < rings.length - 1 && i < steps) {
          const a = r * (steps + 1) + i, b = a + steps + 1, start = indices.length;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
          groups.push([start, 6, Math.cos((i + .5) / steps * Math.PI * 2) >= 0 ? 0 : 1]);
        }
      }
    }
    for (const [ringIndex, reverse] of [[0, false], [rings.length - 1, true]]) {
      const [y,left,right,,z=0] = rings[ringIndex], center = position.length / 3;
      position.push(((left+right)/2-WIDTH/2)*SCALE,(HEIGHT-y)*SCALE,z);
      uv.push((left+right)/2/WIDTH,1-y/HEIGHT);
      for (let i=0;i<steps;i++) {
        const a=ringIndex*(steps+1)+i, start=indices.length;
        indices.push(center,reverse?a+1:a,reverse?a:a+1);
        groups.push([start,3,Math.cos((i+.5)/steps*Math.PI*2)>=0?0:1]);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position,3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv,2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    for (const group of groups) geometry.addGroup(...group);
    const mesh = new THREE.Mesh(geometry, materials); model.add(mesh); return mesh;
  }
  section([[2,65,74,.012],[7,55,81,.055],[17,51,86,.078],[25,52,87,.079],[32,52,87,.079],[37,54,85,.072],[43,57,83,.062],[53,63,78,.036]],true);
  section([[49,62,78,.037],[63,57,83,.052],[76,53,90,.064]]);
  section([[62,54,86,.061],[71,43,98,.1],[86,38,103,.123],[108,35,105,.134],[139,34,104,.139],[165,33,107,.125],[187,31,113,.111],[204,35,113,.09]]);
  section([[67,34,44,.028],[77,27,43,.043],[98,23,40,.048],[122,20,36,.043],[151,16,34,.038],[161,16,32,.034],[185,9,25,.03],[203,5,21,.028],[220,3,18,.026]]);
  section([[68,100,111,.026],[83,103,123,.045],[111,110,131,.048],[144,117,139,.041],[157,122,142,.035],[179,129,145,.032],[203,132,148,.027],[218,131,144,.026]]);
  section([[186,32,71,.072],[214,29,70,.079],[244,28,67,.075],[274,29,62,.065],[298,30,62,.061],[331,29,61,.06],[360,29,58,.053],[381,28,56,.05]]);
  section([[187,76,115,.072],[214,80,120,.082],[241,84,124,.078],[274,84,124,.067],[298,85,123,.062],[330,86,123,.058],[363,86,123,.054],[386,90,122,.048]]);
  section([[363,30,58,.052],[381,26,57,.061],[397,19,56,.092,.025],[407,10,53,.08,.04],[413,7,49,.05,.055]]);
  section([[367,89,122,.052],[390,90,123,.058],[406,88,124,.089,.024],[421,84,123,.079,.048],[426,85,121,.038,.061]]);
  // Ear volume and equipment pouches are also textured from their source positions.
  section([[24,48,53,.018],[32,48,54,.022],[39,50,55,.015]]);
  section([[24,86,89,.018],[32,85,90,.022],[39,84,88,.015]]);
  section([[194,109,128,.054],[208,106,132,.068],[244,108,133,.065],[254,111,130,.045]]);
  section([[201,20,34,.047],[216,17,36,.063],[244,20,37,.057],[252,22,34,.03]]);
  if (combat) {
    const gun = new THREE.Mesh(new THREE.BoxGeometry(.065,.075,.45),new THREE.MeshStandardMaterial({color:'#292e2a',roughness:.8}));
    gun.position.set(.19,1.14,.28); model.add(gun);
  }
  // Two material draws per component rather than one draw per triangle.
  model.traverse(object => {
    if (!object.isMesh || !Array.isArray(object.material)) return;
    const old = object.geometry.index.array, batches = [[],[]];
    for (const group of object.geometry.groups) batches[group.materialIndex].push(...old.slice(group.start,group.start+group.count));
    object.geometry.setIndex([...batches[0],...batches[1]]);
    object.geometry.clearGroups();
    object.geometry.addGroup(0,batches[0].length,0); object.geometry.addGroup(batches[0].length,batches[1].length,1);
  });
  model.userData.character = 'black-water-photo';
  return model;
}

export function createHomeCharacter(canvas, status, textures) {
  const renderer = new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.setClearColor(0,0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(), model = createSoldierModel(false,textures);
  scene.add(model,new THREE.HemisphereLight('#fff5e7','#b0b7be',2.2));
  const key = new THREE.DirectionalLight('#fff',.7);key.position.set(-2,4,4);scene.add(key);
  const camera = new THREE.PerspectiveCamera(32,1,.05,20);
  camera.position.set(0,1.13,4.3);camera.lookAt(0,1.05,0);
  let yaw=0,drag=null,lost=false;
  const rotate=value=>{yaw=value%(Math.PI*2);model.rotation.y=yaw;canvas.dataset.rotation=String(yaw);};
  rotate(0);
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0||drag)return;
    drag={id:event.pointerId,x:event.clientX};canvas.setPointerCapture(event.pointerId);canvas.focus({preventScroll:true});event.preventDefault();
  });
  canvas.addEventListener('pointermove',event=>{
    if(drag?.id!==event.pointerId)return;
    rotate(yaw+(event.clientX-drag.x)*.012);drag.x=event.clientX;
  });
  const cancelDrag=()=>{if(drag&&canvas.hasPointerCapture(drag.id))canvas.releasePointerCapture(drag.id);drag=null;};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,event=>{if(drag?.id===event.pointerId)cancelDrag();});
  window.addEventListener('blur',cancelDrag);
  canvas.addEventListener('keydown',event=>{
    if(event.code==='ArrowLeft'||event.code==='ArrowRight'){rotate(yaw+(event.code==='ArrowLeft'?-.15:.15));event.preventDefault();}
    if(event.code==='Home'){rotate(0);event.preventDefault();}
  });
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;status.textContent='3D 화면 연결이 끊겼습니다. 새로고침하세요.';});
  canvas.addEventListener('webglcontextrestored',()=>{lost=false;status.textContent='드래그하여 360° 회전 · 좌우 방향키 · Home 정면';});
  function resize(){
    const {width,height}=canvas.getBoundingClientRect();if(!width||!height)return;
    renderer.setSize(width,height,false);camera.aspect=width/height;
    camera.position.z=Math.max(4.3,.45/(Math.tan(16*Math.PI/180)*camera.aspect));camera.updateProjectionMatrix();
  }
  const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
  canvas.dataset.modelReady='true';
  return {render:()=>{if(!lost)renderer.render(scene,camera);},cancelDrag};
}
