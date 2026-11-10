// Deterministic low-poly simulation renderer. The page exposes window.load(spec) and window.renderAt(t).
// Scenes: city | station | fuji | beach | map | earth. Lighting: day | sunset | night.
import * as THREE from "../vendor/three.module.js";

const W = 1080, H = 1920;
let spec, renderer, camera, scenes = {}, japan = null;
const $ = (id) => document.getElementById(id);
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const ease = (x) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);
const lerp = (a, b, k) => a + (b - a) * k;
const M = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
const between = (list, t) => (list || []).find((x) => t >= x.t0 && t < x.t1);

const PALETTES = {
  day:    { sky: 0x9cc8ee, hemi: [0xffffff, 0x6b7a8f, 1.6], sun: [0xfff2dd, 2.2], ground: 0x9aa3b0, road: 0x4a505c, lit: 0.12, glow: 0 },
  sunset: { sky: 0xf2a173, hemi: [0xffd6b0, 0x5a4a5a, 1.3], sun: [0xffb070, 2.0], ground: 0x9a8f96, road: 0x4a4550, lit: 0.35, glow: 0.35 },
  night:  { sky: 0x0d1426, hemi: [0x8fa6d8, 0x1a2030, 1.1], sun: [0xb8c8ff, 1.0], ground: 0x5a6378, road: 0x262c3a, lit: 0.55, glow: 0.55 },
};

function baseScene(pal, fogNear = 60, fogFar = 160) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(pal.sky);
  s.fog = new THREE.Fog(s.background, fogNear, fogFar);
  s.add(new THREE.HemisphereLight(pal.hemi[0], pal.hemi[1], pal.hemi[2]));
  const sun = new THREE.DirectionalLight(pal.sun[0], pal.sun[1]);
  sun.position.set(-30, 50, 20); sun.castShadow = true; sun.shadow.mapSize.set(1536, 1536);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 200 });
  s.add(sun);
  s.userData.people = [];
  return s;
}

function windowTexture(r, cols, rows, lit) {
  const c = document.createElement("canvas"); c.width = cols * 16; c.height = rows * 16;
  const g = c.getContext("2d"); g.fillStyle = "#2a3550"; g.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const v = r(); g.fillStyle = v < lit * 0.55 ? "#f2c46d" : v < lit ? "#8ec3ef" : "#1b2338";
    g.fillRect(x * 16 + 3, y * 16 + 3, 10, 10);
  }
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t;
}

function building(s, r, pal, x, z, w, d, h) {
  const tex = windowTexture(r, Math.max(2, Math.round(w)), Math.max(2, Math.round(h / 1.6)), pal.lit);
  const side = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: pal.glow, flatShading: true });
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, M(0x9aa6b8), M(0x222222), side, side]);
  b.position.set(x, h / 2, z); b.castShadow = true; b.receiveShadow = true; s.add(b); return b;
}

const SHIRTS = [0xe8a23a, 0x3a6fd8, 0x2f8a5c, 0xd8d0c0, 0x8e44ad, 0xc0392b, 0x34495e, 0xf1c40f, 0x16a085, 0xecf0f1];
const SKIN = [0xf1c8a0, 0xe0ac80, 0xc68a5f];
function person(r) {
  const p = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.55), M(SHIRTS[Math.floor(r() * SHIRTS.length)])); body.position.y = 1.55;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), M(SKIN[Math.floor(r() * SKIN.length)])); head.position.y = 2.45;
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.2, 0.66), M(r() < 0.8 ? 0x1c1c22 : 0xb98a4a)); hair.position.y = 2.82;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.5), M(0x2b2f3d)); legs.position.y = 0.5;
  for (const m of [body, head, hair, legs]) m.castShadow = true;
  p.add(body, head, hair, legs);
  return p;
}
// people walk inside a rectangle [x0,x1]x[z0,z1] at height y
function addCrowd(s, r, n, box, y = 0) {
  for (let i = 0; i < n; i++) {
    const p = person(r);
    p.userData = { x0: lerp(box[0], box[1], r()), z0: lerp(box[2], box[3], r()), dir: r() * Math.PI * 2,
                   speed: 0.5 + r() * 0.8, phase: r() * 10, jitter: r(), box, y };
    s.add(p); s.userData.people.push(p);
  }
}

function buildCity(pal, crowd, r) {
  const s = baseScene(pal);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), M(pal.ground)); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; s.add(ground);
  for (const [w, d] of [[200, 16], [16, 200]]) { const road = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M(pal.road)); road.rotation.x = -Math.PI / 2; road.position.y = 0.02; road.receiveShadow = true; s.add(road); }
  const white = M(0xe8ecf3);
  const stripe = (x, z, rot) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 4), white); m.position.set(x, 0.05, z); m.rotation.y = rot; s.add(m); };
  for (let i = -6; i <= 6; i++) { stripe(i * 1.2, 10, 0); stripe(i * 1.2, -10, 0); stripe(10, i * 1.2, Math.PI / 2); stripe(-10, i * 1.2, Math.PI / 2); }
  for (let i = -8; i <= 8; i++) { stripe(i * 0.9, i * 0.9, Math.PI / 4); stripe(i * 0.9, -i * 0.9, -Math.PI / 4); }
  for (const qx of [-1, 1]) for (const qz of [-1, 1]) {
    for (let k = 0; k < 4; k++) { const w = 8 + r() * 6, d = 8 + r() * 6, h = 14 + r() * 34;
      building(s, r, pal, qx * (17 + k % 2 * 15 + w / 2), qz * (17 + Math.floor(k / 2) * 15 + d / 2), w, d, h); }
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 2.4, 6), M(0x5a3b2a)); trunk.position.set(qx * 11.5, 1.2, qz * 11.5);
    const top = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 0), M(0x3f8f58)); top.position.set(qx * 11.5, 4, qz * 11.5); top.castShadow = true; s.add(trunk, top);
  }
  addCrowd(s, r, crowd, [-15, 15, -15, 15]);
  s.userData.cam = (t, mode) => {
    const a = 0.6 + t * 0.03; let dist = 30, h = 46;
    if (mode === "low") { dist = 22; h = 16; } if (mode === "high") { dist = 36; h = 70; }
    return [new THREE.Vector3(Math.cos(a) * dist, h, Math.sin(a) * dist), new THREE.Vector3(0, 0, 0)];
  };
  return s;
}

function buildStation(pal, crowd, r) {
  const s = baseScene(pal, 50, 200);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), M(pal.ground)); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; s.add(ground);
  const plat = new THREE.Mesh(new THREE.BoxGeometry(90, 1.2, 9), M(0xb9bec8)); plat.position.set(0, 0.6, 0); plat.receiveShadow = true; s.add(plat);
  const tactile = new THREE.Mesh(new THREE.BoxGeometry(90, 0.05, 0.7), M(0xf2c230)); tactile.position.set(0, 1.23, 3.6); s.add(tactile);
  for (const z of [7.2, 8.8]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(200, 0.25, 0.2), M(0x8a8f99)); rail.position.set(0, 0.25, z); s.add(rail); }
  for (let x = -100; x <= 100; x += 1.6) { const sl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 3.2), M(0x5b4a3a)); sl.position.set(x, 0.08, 8); s.add(sl); }
  for (let x = -40; x <= 40; x += 10) { const col = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 0.5), M(0x707784)); col.position.set(x, 3.7, -2); col.castShadow = true; s.add(col); }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(90, 0.4, 8), M(0x6a7280)); roof.position.set(0, 6.3, 0.5); roof.castShadow = true; s.add(roof);
  for (let i = 0; i < 10; i++) building(s, r, pal, -60 + i * 13 + r() * 4, -22 - r() * 10, 8 + r() * 5, 8, 10 + r() * 28);
  // generic commuter train (no real operator livery)
  const train = new THREE.Group();
  for (let c = 0; c < 6; c++) {
    const car = new THREE.Mesh(new THREE.BoxGeometry(19.5, 3.6, 3), M(0xe9edf2)); car.position.set(c * 20, 2.6, 0); car.castShadow = true;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(19.6, 0.4, 3.05), M(0x2a8f6a)); stripe.position.set(c * 20, 1.9, 0);
    const win = new THREE.Mesh(new THREE.BoxGeometry(17, 1.1, 3.06), new THREE.MeshBasicMaterial({ color: pal.glow > 0.3 ? 0xffe6a8 : 0x5e7a96 })); win.position.set(c * 20, 3.1, 0);
    train.add(car, stripe, win);
  }
  train.position.z = 8; s.add(train); s.userData.train = train;
  addCrowd(s, r, crowd, [-40, 40, -3.5, 3.2], 1.2);
  s.userData.cam = (t, mode) => {
    if (mode === "end") return [new THREE.Vector3(-55, 9, 4), new THREE.Vector3(0, 2, 2)];
    if (mode === "high") return [new THREE.Vector3(10, 45, 40), new THREE.Vector3(0, 0, 2)];
    const x = -18 + t * 0.6; return [new THREE.Vector3(x - 6, 20, 52), new THREE.Vector3(x + 6, 2, 1)];
  };
  return s;
}

function buildFuji(pal, crowd, r) {
  const s = baseScene(pal, 260, 900);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), M(0x6f9a5a)); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; s.add(ground);
  const lake = new THREE.Mesh(new THREE.CircleGeometry(40, 18), M(0x3f7fb8)); lake.rotation.x = -Math.PI / 2; lake.position.set(10, 0.05, 40); s.add(lake);
  const mtn = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(6, 70, 38, 14, 3), M(0x56647a)); body.position.y = 19; body.castShadow = true;
  const snow = new THREE.Mesh(new THREE.CylinderGeometry(6, 21, 12, 14), M(0xf4f7fb));
  mtn.add(body, snow); mtn.position.set(0, 0, -60); s.add(mtn); s.userData.mountain = mtn;
  // snow cap covering the top fraction f of the cone (body radius goes 70 -> 6 over 38 units)
  s.userData.setSnow = (f) => { if (Math.abs((s.userData.snowF ?? -1) - f) < 0.004) return; s.userData.snowF = f;
    const h = 38 * f, rb = 70 - 64 * (38 - h) / 38 + 0.35; snow.geometry.dispose();
    snow.geometry = new THREE.CylinderGeometry(6.2, rb, h, 14); snow.position.y = 38 - h / 2 + 0.05; };
  s.userData.setSnow(0.3);
  // jet-stream style wind streaks (absolute world height, not scaled with the mountain)
  const wind = new THREE.Group(), wmat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
  for (let i = 0; i < 70; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(18 + r() * 30, 0.5, 0.5), wmat);
    m.userData.base = [r() * 700, r(), -220 + r() * 300, 0.6 + r() * 0.8]; wind.add(m); }
  wind.visible = false; s.add(wind); s.userData.wind = wind;
  // falling snow
  const N = 900, pos = new Float32Array(N * 3), seeds = [];
  for (let i = 0; i < N; i++) seeds.push([(r() - 0.5) * 220, r() * 130, -60 + (r() - 0.5) * 160, 4 + r() * 5]);
  const flakes = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3)),
    new THREE.PointsMaterial({ color: 0xffffff, size: 5, sizeAttenuation: false }));
  flakes.userData.seeds = seeds; flakes.visible = false; flakes.frustumCulled = false; s.add(flakes); s.userData.flakes = flakes;
  for (let i = 0; i < 90; i++) { const x = (r() - 0.5) * 220, z = 10 + r() * 90; if (Math.hypot(x - 10, z - 40) < 42) continue;
    const tr = new THREE.Mesh(new THREE.ConeGeometry(1.6, 4.5, 6), M(0x2f6a45)); tr.position.set(x, 2.2, z); tr.castShadow = true; s.add(tr); }
  for (let i = 0; i < 14; i++) { const hx = -50 + i * 7 + r() * 3, hz = 70 + r() * 8;
    const h = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4), M(0xe8dcc8)); h.position.set(hx, 1.5, hz);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.3, 2, 4), M(0x8a3b30)); roof.position.set(hx, 4, hz); roof.rotation.y = Math.PI / 4; s.add(h, roof); }
  addCrowd(s, r, crowd, [-20, 20, 84, 96]);
  s.userData.cam = (t, mode) => {
    if (mode === "far") { const a = 0.12 + t * 0.004; return [new THREE.Vector3(Math.sin(a) * 470, 70, -60 + Math.cos(a) * 470), new THREE.Vector3(0, 66, -60)]; }
    if (mode === "high") return [new THREE.Vector3(140, 130, 250), new THREE.Vector3(0, 52, -60)];
    if (mode === "low") return [new THREE.Vector3(-8, 9, 118), new THREE.Vector3(0, 55, -60)];
    const a = -0.15 + t * 0.006; return [new THREE.Vector3(Math.sin(a) * 250, 32, -60 + Math.cos(a) * 300), new THREE.Vector3(0, 56, -60)];
  };
  return s;
}

function buildBeach(pal, crowd, r) {
  const s = baseScene(pal, 80, 300);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(300, 120), M(0xe6d3a3)); sand.rotation.x = -Math.PI / 2; sand.position.z = -40; sand.receiveShadow = true; s.add(sand);
  const seaG = new THREE.PlaneGeometry(300, 200, 60, 40); seaG.rotateX(-Math.PI / 2);
  const sea = new THREE.Mesh(seaG, new THREE.MeshLambertMaterial({ color: 0x2f86c4, flatShading: true, transparent: true, opacity: 0.95 }));
  sea.position.set(0, 0.3, 100); s.add(sea); s.userData.sea = sea; s.userData.seaBase = seaG.attributes.position.array.slice();
  for (let i = 0; i < 10; i++) { const x = -40 + i * 9 + r() * 4, z = -6 - r() * 14;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4, 5), M(0xdddddd)); pole.position.set(x, 2, z);
    const top = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.1, 8), M([0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71][i % 4])); top.position.set(x, 4.3, z); top.castShadow = true; s.add(pole, top); }
  for (let i = 0; i < 8; i++) building(s, r, pal, -70 + i * 20, -80, 12, 10, 8 + r() * 20);
  addCrowd(s, r, crowd, [-45, 45, -25, -2]);
  s.userData.cam = (t, mode) => {
    if (mode === "high") return [new THREE.Vector3(0, 70, -70), new THREE.Vector3(0, 0, 20)];
    return [new THREE.Vector3(-30 + t * 0.4, 14, -48), new THREE.Vector3(0, 2, 20)];
  };
  return s;
}

function buildMap(pal) {
  const s = baseScene({ ...pal, sky: 0x0b1f3a }, 200, 600);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), M(0x17406e)); sea.rotation.x = -Math.PI / 2; s.add(sea);
  const proj = (lon, lat) => [(lon - 137.5) * 9, -(lat - 37.5) * 11];
  if (japan) for (const ring of japan.rings) {
    const shape = new THREE.Shape(ring.map(([lo, la]) => new THREE.Vector2(...proj(lo, la))));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: false }); g.rotateX(Math.PI / 2); g.translate(0, 2.2, 0);
    const m = new THREE.Mesh(g, M(0x5fae6b)); m.castShadow = true; m.receiveShadow = true; s.add(m);
  }
  s.userData.proj = proj; s.userData.pins = new THREE.Group(); s.add(s.userData.pins);
  s.userData.cam = (t, mode) => {
    if (mode === "low") return [new THREE.Vector3(-30, 60, 150), new THREE.Vector3(10, 0, 10)];
    return [new THREE.Vector3(0, 230 - t * 0.6, 90), new THREE.Vector3(0, 0, 0)];
  };
  return s;
}

function buildEarth() {
  const s = new THREE.Scene(); s.background = new THREE.Color(0x05070f);
  s.add(new THREE.AmbientLight(0x6070a0, 0.8));
  const l = new THREE.DirectionalLight(0xffffff, 2.4); l.position.set(-5, 3, 5); s.add(l);
  const geo = new THREE.IcosahedronGeometry(10, 3), pos = geo.attributes.position, colors = [], r = rng(11);
  for (let i = 0; i < pos.count; i += 3) { const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3, v = r();
    const c = Math.abs(y) > 8.6 ? [0.92, 0.95, 1] : v < 0.33 ? [0.27, 0.62, 0.36] : [0.16, 0.42, 0.78]; for (let k = 0; k < 3; k++) colors.push(...c); }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const earth = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })); s.add(earth);
  const r2 = rng(3), sg = new THREE.BufferGeometry(), sp = [];
  for (let i = 0; i < 900; i++) sp.push((r2() - 0.5) * 400, (r2() - 0.5) * 400, -60 - r2() * 100);
  sg.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3)); s.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5 })));
  const r3 = rng(21), pg = new THREE.BufferGeometry(), pp = [], dirs = [];
  for (let i = 0; i < 1400; i++) { const u = r3() * 2 - 1, th = r3() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
    const d = new THREE.Vector3(rr * Math.cos(th), u, rr * Math.sin(th)); dirs.push(d); pp.push(d.x * 10.15, d.y * 10.15, d.z * 10.15); }
  pg.setAttribute("position", new THREE.Float32BufferAttribute(pp, 3));
  const dots = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffd23f, size: 0.28 })); dots.userData.dirs = dirs; dots.visible = false; earth.add(dots);
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 18, 0), 6, 0xffd23f, 2.2, 1.6); arrow.visible = false; s.add(arrow);
  Object.assign(s.userData, { earth, dots, arrow, people: [] });
  return s;
}

// ---------- animation helpers ----------
function personY(p, t) {
  for (const a of spec.actions || []) if (a.type === "jump") {
    const k = (t - a.t - p.userData.jitter * (a.spread || 0)) / 0.9;
    if (k >= 0 && k <= 1) return 4 * (a.height || 1.6) * k * (1 - k);
  }
  return 0;
}
function placePeople(s, t) {
  const stopAt = spec.stop_walking_at ?? 1e9;
  for (const p of s.userData.people) {
    const u = p.userData, [x0, x1, z0, z1] = u.box, tw = Math.min(t, stopAt);
    const wx = x1 - x0, wz = z1 - z0;
    let x = u.x0 + Math.cos(u.dir) * u.speed * tw, z = u.z0 + Math.sin(u.dir) * u.speed * tw;
    x = x0 + (((x - x0) % wx) + wx) % wx; z = z0 + (((z - z0) % wz) + wz) % wz;
    const walking = t < stopAt;
    p.position.set(x, u.y + personY(p, t) + (walking ? Math.abs(Math.sin((t + u.phase) * 6)) * 0.08 : 0), z);
    if (walking) p.rotation.y = -u.dir + Math.PI / 2;
  }
}
function shake(t) {
  for (const a of spec.actions || []) if (a.type === "shake" && t >= a.t && t < a.t + a.dur) {
    const k = 1 - (t - a.t) / a.dur; return [Math.sin(t * 90) * a.amp * k, Math.cos(t * 77) * a.amp * k];
  }
  return [0, 0];
}
function animate(s, name, t) {
  if (name === "station" && s.userData.train) {
    const tr = spec.train || {}; const arrive = tr.arrive ?? 2, depart = tr.depart ?? 1e9;
    let x = t < arrive ? lerp(160, -50, ease((t - (arrive - 6)) / 6)) : -50;
    if (t > depart) x = -50 - Math.pow(t - depart, 2) * 3;
    s.userData.train.position.x = t < arrive - 6 ? 160 : x;
  }
  if (name === "fuji" && s.userData.mountain) {
    let k = 1; for (const a of (spec.actions || []).filter((x) => x.type === "scale_mountain").sort((p, q) => p.t - q.t)) if (t >= a.t) k = lerp(a.from ?? 1, a.to, ease((t - a.t) / (a.dur || 3)));
    s.userData.mountain.scale.set(1, Math.max(0.05, k), 1);
    let f = 0.3; for (const a of (spec.actions || []).filter((x) => x.type === "snowline").sort((p, q) => p.t - q.t)) if (t >= a.t) f = lerp(a.from ?? 0.3, a.to, ease((t - a.t) / (a.dur || 3)));
    s.userData.setSnow(Math.min(0.97, Math.max(0.05, f)));
    const w = between(spec.wind, t), wg = s.userData.wind; wg.visible = !!w;
    if (w) { const k2 = ease((t - w.t0) / 1.5); wg.children.forEach((m, i) => { const [bx, by, bz, sp] = m.userData.base;
      m.visible = i / wg.children.length < k2; m.position.set(((bx + t * 90 * sp) % 700) - 350, w.y0 + by * (w.y1 - w.y0), bz); }); }
    const wx = between(spec.weather, t), fl = s.userData.flakes; fl.visible = !!wx;
    if (wx) { const arr = fl.geometry.attributes.position.array, sd = fl.userData.seeds;
      for (let i = 0; i < sd.length; i++) { const [x, y, z, v] = sd[i]; arr[i * 3] = x + Math.sin(t * 0.8 + i) * 3; arr[i * 3 + 1] = 45 + ((y - t * v) % 130 + 130) % 130; arr[i * 3 + 2] = z; }
      fl.geometry.attributes.position.needsUpdate = true; }
  }
  if (name === "beach" && s.userData.sea) {
    let level = 0.3; for (const a of (spec.actions || []).filter((x) => x.type === "sea_level").sort((p, q) => p.t - q.t)) if (t >= a.t) level = lerp(a.from ?? 0.3, a.to, ease((t - a.t) / (a.dur || 3)));
    s.userData.sea.position.y = level;
    const arr = s.userData.sea.geometry.attributes.position.array, base = s.userData.seaBase;
    for (let i = 0; i < arr.length; i += 3) arr[i + 1] = base[i + 1] + Math.sin(base[i] * 0.15 + t * 2) * 0.35 + Math.cos(base[i + 2] * 0.2 + t * 1.6) * 0.25;
    s.userData.sea.geometry.attributes.position.needsUpdate = true;
  }
  if (name === "map") {
    const g = s.userData.pins; while (g.children.length) g.remove(g.children[0]);
    for (const m of spec.map_markers || []) { if (t < m.t0) continue;
      const [x, z] = s.userData.proj(m.lon, m.lat), k = ease((t - m.t0) / 0.6), h = (m.height || 12) * k;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(m.radius || 2.2, m.radius || 2.2, h, 10), M(m.color ? parseInt(m.color.slice(1), 16) : 0xff4d5e));
      col.position.set(x, 2.2 + h / 2, z); g.add(col); }
  }
}

// ---------- overlays ----------
function setUI(t, s, name) {
  const show = (id, on) => $(id).classList.toggle("hide", !on);
  const inTitle = spec.title_window && t >= spec.title_window[0] && t < spec.title_window[1];
  show("title", inTitle); show("setting", inTitle);
  if (inTitle) { $("title").innerHTML = spec.title_html; $("setting").textContent = spec.setting; }
  const cds = spec.countdowns || (spec.countdown ? [spec.countdown] : []);
  const cd = cds.find((c) => t >= c.show_from && t < c.zero_at + 1.5); show("cd", !!cd);
  if (cd) { const left = Math.max(0, cd.zero_at - t), m = Math.floor(left / 60), sec = left - m * 60;
    $("cd").querySelector(".label").textContent = cd.label; $("cd").querySelector(".time").textContent = `${m}:${sec.toFixed(3).padStart(6, "0")}`; }
  const cap = between(spec.captions, t); show("cap", !!cap);
  if (cap) { const sp = $("cap").firstElementChild; sp.innerHTML = cap.html; sp.className = cap.sfx === "twist" ? "twist" : ""; }
  const big = between(spec.big, t), ctr = between(spec.counters, t); show("big", !!(big || ctr));
  if (big) $("big").innerHTML = big.html;
  else if (ctr) { const k = ease((t - ctr.t0) / Math.max(0.1, ctr.run || (ctr.t1 - ctr.t0) * 0.7)), v = ctr.from + (ctr.to - ctr.from) * k;
    const loc = spec.lang === "en" ? "en-US" : "ja-JP";
    $("big").innerHTML = `${ctr.prefix || ""}${v.toLocaleString(loc, { minimumFractionDigits: ctr.decimals || 0, maximumFractionDigits: ctr.decimals || 0 })}${ctr.suffix || ""}<small>${ctr.label || ""}</small>`; }
  const fx = between(spec.effects, t); show("fx", !!fx);
  if (fx) { const tot = fx.total || (spec.effects || []).length, dots = Array.from({ length: tot }, (_, i) => `<i class="${i < fx.n ? "on" : ""}"></i>`).join("");
    const k = ease((t - fx.t0) / 0.45);
    $("fx").style.opacity = k; $("fx").style.transform = `translateY(${(1 - k) * 40}px)`;
    $("fx").innerHTML = `<div class="tag">EFFECT ${fx.n} · ${fx.tag}</div><div class="head">${fx.head}</div>${fx.sub ? `<div class="sub">${fx.sub}</div>` : ""}<div class="dots">${dots}</div>`; }
  const g = between(spec.gauges, t); show("gauge", !!g);
  if (g) { const k = ease((t - g.t0 - (g.delay || 0)) / (g.run || 2.5)), v = g.from + (g.to - g.from) * k, lo = g.min ?? -50, hi = g.max ?? 20;
    const pct = Math.max(2, Math.min(100, (v - lo) / (hi - lo) * 100));
    $("gauge").innerHTML = `<div class="gl">${g.label || ""}</div><div class="tube"><div class="fill" style="height:${pct}%;background:${v < 0 ? "#3aa0ff" : "#ff4d5e"}"></div><div class="zero" style="bottom:${(0 - lo) / (hi - lo) * 100}%"></div></div><div class="gv">${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(g.decimals ?? 1)}${g.unit || "°C"}</div>`; }
  const mk = $("marks"); mk.innerHTML = "";
  if (name === "fuji") for (const m of spec.marks || []) { if (t < m.t0 || t >= m.t1) continue;
    const v = new THREE.Vector3(0, m.y, -60).project(camera), top = (-v.y * 0.5 + 0.5) * H; if (top < 120 || top > H - 120) continue;
    const el = document.createElement("div"); el.className = "mark"; el.style.top = `${top}px`; el.innerHTML = `<span>${m.text}</span>`; mk.appendChild(el); }
  const end = spec.end && t >= spec.end.t0; show("end", end); if (end) $("end").innerHTML = spec.end.html;
  const box = $("bubbles"); box.innerHTML = "";
  const ppl = s.userData.people || [];
  if (ppl.length) for (const b of spec.bubbles || []) {
    if (t < b.t0 || t >= b.t1) continue;
    const p = ppl[b.person % ppl.length], v = new THREE.Vector3(p.position.x, p.position.y + 3.4, p.position.z).project(camera);
    const top = (-v.y * 0.5 + 0.5) * H; if (v.z > 1 || top < 980 || top > 1380) continue;
    const el = document.createElement("div"); el.className = "bubble"; el.textContent = b.text;
    el.style.left = `${Math.min(W - 230, Math.max(230, (v.x * 0.5 + 0.5) * W))}px`; el.style.top = `${top}px`; box.appendChild(el);
  }
  const labels = $("labels"); labels.innerHTML = "";
  if (name === "map") for (const m of spec.map_markers || []) { if (t < m.t0 || !m.label) continue;
    const [x, z] = s.userData.proj(m.lon, m.lat), v = new THREE.Vector3(x, 2.4 + (m.height || 12) + 3, z).project(camera);
    const el = document.createElement("div"); el.className = "maplabel"; el.textContent = m.label;
    el.style.left = `${(v.x * 0.5 + 0.5) * W}px`; el.style.top = `${(-v.y * 0.5 + 0.5) * H}px`; labels.appendChild(el); }
}

window.load = async (s) => {
  spec = s;
  document.documentElement.lang = spec.lang === "en" ? "en" : "ja";
  if (spec.lang === "en") document.body.classList.add("en");
  $("badge").textContent = spec.lang === "en" ? "AI SIMULATION · NOT A REAL EVENT" : "AIシミュレーション｜実際の出来事ではありません";
  renderer = new THREE.WebGLRenderer({ canvas: $("gl"), antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false); renderer.shadowMap.enabled = true; renderer.outputColorSpace = THREE.SRGBColorSpace;
  camera = new THREE.PerspectiveCamera(42, W / H, 0.5, 900);
  const needed = new Set((spec.scenes || []).map((x) => x.scene));
  if (needed.has("map")) japan = await (await fetch("../vendor/japan.json")).json();
  const pal = PALETTES[spec.time_of_day] || PALETTES.night, crowd = spec.crowd || 120, seed = spec.seed || 7;
  const builders = { city: buildCity, station: buildStation, fuji: buildFuji, beach: buildBeach, map: buildMap };
  for (const n of needed) scenes[n] = n === "earth" ? buildEarth() : builders[n](pal, crowd, rng(seed + n.length));
  await document.fonts.ready; return "ok";
};

window.renderAt = (t) => {
  const sc = between(spec.scenes, t) || spec.scenes[spec.scenes.length - 1];
  const s = scenes[sc.scene];
  if (sc.scene === "earth") {
    const u = s.userData, k = t - sc.t0; u.earth.rotation.y = 0.4 + k * 0.08; u.earth.rotation.x = 0.35;
    const push = between(spec.earth_push, t); u.earth.position.y = push ? -0.25 * Math.sin(Math.min(1, (t - push.t0) / 1.2) * Math.PI) : 0;
    u.arrow.visible = !!push; u.dots.visible = !!sc.people;
    if (sc.people) { const ej = (spec.actions || []).find((a) => a.type === "earth_jump"), k2 = ej ? (t - ej.t) / 0.9 : -1;
      const lift = k2 >= 0 && k2 <= 1 ? 4 * 0.55 * k2 * (1 - k2) : 0, arr = u.dots.geometry.attributes.position.array, dirs = u.dots.userData.dirs;
      for (let i = 0; i < dirs.length; i++) { const R = 10.15 + lift * (0.6 + 0.4 * ((i * 37) % 10) / 10); arr[i * 3] = dirs[i].x * R; arr[i * 3 + 1] = dirs[i].y * R; arr[i * 3 + 2] = dirs[i].z * R; }
      u.dots.geometry.attributes.position.needsUpdate = true; }
    camera.position.set(0, 4, 78 - ease(k / 4) * 10); camera.lookAt(0, 4.5, 0);
  } else {
    placePeople(s, t); animate(s, sc.scene, t);
    if (!s.userData.sky0) s.userData.sky0 = s.background.clone();
    let col = s.userData.sky0.clone();
    for (const a of (spec.sky || []).slice().sort((p, q) => p.t - q.t)) if (t >= a.t) col = col.clone().lerp(new THREE.Color(a.to), ease((t - a.t) / (a.dur || 3)));
    s.background.copy(col); s.fog.color.copy(col);
    const [pos, look] = s.userData.cam(t - sc.t0, sc.camera); const [sx, sy] = shake(t);
    camera.position.set(pos.x + sx, pos.y + sy, pos.z); camera.lookAt(look);
  }
  renderer.render(s, camera); setUI(t, s, sc.scene); return true;
};
