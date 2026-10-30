// Deterministic low-poly simulation renderer. The page exposes window.load(spec) and window.renderAt(t).
import * as THREE from "../vendor/three.module.js";

const W = 1080, H = 1920;
let spec, renderer, cityScene, earthScene, camera, people = [], peopleTargets = [], earth, earthArrow, earthPeople;

function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
const ease = (x) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);
const $ = (id) => document.getElementById(id);

function windowTexture(r, cols, rows, lit) {
  const c = document.createElement("canvas"); c.width = cols * 16; c.height = rows * 16;
  const g = c.getContext("2d"); g.fillStyle = "#2a3550"; g.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const v = r(); g.fillStyle = v < lit * 0.55 ? "#f2c46d" : v < lit ? "#8ec3ef" : "#1b2338";
    g.fillRect(x * 16 + 3, y * 16 + 3, 10, 10);
  }
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t;
}

function buildCity(night, crowd) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(night ? 0x0d1426 : 0x9cc8ee);
  s.fog = new THREE.Fog(s.background, 60, 140);
  s.add(new THREE.HemisphereLight(night ? 0x8fa6d8 : 0xffffff, night ? 0x1a2030 : 0x6b7a8f, night ? 1.1 : 1.6));
  const sun = new THREE.DirectionalLight(night ? 0xb8c8ff : 0xfff2dd, night ? 1.0 : 2.2);
  sun.position.set(-30, 50, 20); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50 }); s.add(sun);
  const r = rng(7);
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), mat(night ? 0x5a6378 : 0x9aa3b0));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; s.add(ground);
  for (const [w, d] of [[200, 16], [16, 200]]) {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(night ? 0x262c3a : 0x4a505c));
    road.rotation.x = -Math.PI / 2; road.position.y = 0.02; road.receiveShadow = true; s.add(road);
  }
  const white = mat(0xe8ecf3);
  const stripe = (x, z, rot) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 4), white);
    m.position.set(x, 0.05, z); m.rotation.y = rot; m.receiveShadow = true; s.add(m); };
  for (let i = -6; i <= 6; i++) { stripe(i * 1.2, 10, 0); stripe(i * 1.2, -10, 0); stripe(10, i * 1.2, Math.PI / 2); stripe(-10, i * 1.2, Math.PI / 2); }
  for (let i = -8; i <= 8; i++) { stripe(i * 0.9, i * 0.9, Math.PI / 4); stripe(i * 0.9, -i * 0.9, -Math.PI / 4); }
  for (const qx of [-1, 1]) for (const qz of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const w = 8 + r() * 6, d = 8 + r() * 6, h = 14 + r() * 34;
      const x = qx * (17 + k % 2 * 15 + w / 2), z = qz * (17 + Math.floor(k / 2) * 15 + d / 2);
      const tex = windowTexture(r, Math.round(w), Math.round(h / 1.6), night ? 0.55 : 0.15);
      const side = new THREE.MeshLambertMaterial({ map: tex, emissive: night ? 0xffffff : 0x000000, emissiveMap: night ? tex : null,
        emissiveIntensity: night ? 0.55 : 0, flatShading: true });
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, mat(night ? 0x3a4560 : 0xb7c0cc), mat(0x222), side, side]);
      b.position.set(x, h / 2, z); b.castShadow = true; b.receiveShadow = true; s.add(b);
    }
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 2.4, 6), mat(0x5a3b2a)); trunk.position.y = 1.2;
    const top = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 0), mat(night ? 0x2f6a45 : 0x3f8f58)); top.position.y = 4;
    trunk.castShadow = top.castShadow = true; tree.add(trunk, top); tree.position.set(qx * 11.5, 0, qz * 11.5); s.add(tree);
  }
  const shirt = [0xe8a23a, 0x3a6fd8, 0x2f8a5c, 0xd8d0c0, 0x8e44ad, 0xc0392b, 0x34495e, 0xf1c40f, 0x16a085, 0xecf0f1];
  const skin = [0xf1c8a0, 0xe0ac80, 0xc68a5f];
  people = []; peopleTargets = [];
  for (let i = 0; i < crowd; i++) {
    const p = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.55), mat(shirt[Math.floor(r() * shirt.length)]));
    body.position.y = 1.55;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), mat(skin[Math.floor(r() * skin.length)]));
    head.position.y = 2.45;
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.2, 0.66), mat(r() < 0.8 ? 0x1c1c22 : 0xb98a4a)); hair.position.y = 2.82;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.5), mat(0x2b2f3d)); legs.position.y = 0.5;
    const phone = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.38, 0.06), new THREE.MeshBasicMaterial({ color: 0x9fd8ff }));
    phone.position.set(0.25, 1.75, 0.34);
    for (const m of [body, head, hair, legs]) m.castShadow = true;
    p.add(body, head, hair, legs, phone);
    const ang = r() * Math.PI * 2, rad = Math.sqrt(r()) * 13;
    const x0 = Math.cos(ang) * rad, z0 = Math.sin(ang) * rad;
    const dir = r() * Math.PI * 2, speed = 0.6 + r() * 0.8;
    p.userData = { x0, z0, dir, speed, phase: r() * 10, jitter: r() };
    s.add(p); people.push(p);
  }
  return s;
}

function buildEarth() {
  const s = new THREE.Scene(); s.background = new THREE.Color(0x05070f);
  s.add(new THREE.AmbientLight(0x6070a0, 0.8));
  const l = new THREE.DirectionalLight(0xffffff, 2.4); l.position.set(-5, 3, 5); s.add(l);
  const geo = new THREE.IcosahedronGeometry(10, 3);
  const pos = geo.attributes.position, colors = [];
  const r = rng(11);
  for (let i = 0; i < pos.count; i += 3) {
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3, v = r();
    const c = Math.abs(y) > 8.6 ? [0.92, 0.95, 1] : v < 0.33 ? [0.27, 0.62, 0.36] : [0.16, 0.42, 0.78];
    for (let k = 0; k < 3; k++) colors.push(...c);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  earth = new THREE.Mesh(geo.toNonIndexed ? geo : geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  s.add(earth);
  const r2 = rng(3), sg = new THREE.BufferGeometry(), sp = [];
  for (let i = 0; i < 900; i++) sp.push((r2() - 0.5) * 400, (r2() - 0.5) * 400, -60 - r2() * 100);
  sg.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
  s.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5 })));
  const r3 = rng(21), pg = new THREE.BufferGeometry(), pp = [], dirs = [];
  for (let i = 0; i < 1400; i++) {
    const u = r3() * 2 - 1, th = r3() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
    const d = new THREE.Vector3(rr * Math.cos(th), u, rr * Math.sin(th)); dirs.push(d);
    pp.push(d.x * 10.15, d.y * 10.15, d.z * 10.15);
  }
  pg.setAttribute("position", new THREE.Float32BufferAttribute(pp, 3));
  earthPeople = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffd23f, size: 0.28 }));
  earthPeople.userData.dirs = dirs; earthPeople.visible = false; earth.add(earthPeople);
  earthArrow = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 18, 0), 6, 0xffd23f, 2.2, 1.6);
  earthArrow.visible = false; s.add(earthArrow);
  return s;
}

function between(list, t) { return (list || []).find((x) => t >= x.t0 && t < x.t1); }

function personY(p, t) {
  for (const a of spec.actions || []) {
    if (a.type === "jump") {
      const T = 0.9, k = (t - a.t - p.userData.jitter * (a.spread || 0)) / T;
      if (k >= 0 && k <= 1) return 4 * (a.height || 1.6) * k * (1 - k);
    }
  }
  return 0;
}

function placePeople(t) {
  for (const p of people) {
    const u = p.userData;
    const stopAt = spec.stop_walking_at ?? 1e9;
    const tw = Math.min(t, stopAt);
    let x = u.x0 + Math.cos(u.dir) * u.speed * tw, z = u.z0 + Math.sin(u.dir) * u.speed * tw;
    const lim = 15; x = ((x + lim) % (2 * lim) + 2 * lim) % (2 * lim) - lim; z = ((z + lim) % (2 * lim) + 2 * lim) % (2 * lim) - lim;
    const walking = t < stopAt;
    p.position.set(x, personY(p, t) + (walking ? Math.abs(Math.sin((t + u.phase) * 6)) * 0.08 : 0), z);
    p.rotation.y = walking ? -u.dir + Math.PI / 2 : p.rotation.y * 0.9 + (Math.atan2(-z, -x) * -1 + Math.PI / 2) * 0.1;
  }
}

function shake(t) {
  const s = between((spec.actions || []).filter((a) => a.type === "shake").map((a) => ({ ...a, t0: a.t, t1: a.t + a.dur })), t);
  if (!s) return [0, 0];
  const k = 1 - (t - s.t0) / (s.t1 - s.t0);
  return [Math.sin(t * 90) * s.amp * k, Math.cos(t * 77) * s.amp * k];
}

function cityCamera(t, mode) {
  const a = 0.6 + t * 0.03;
  let dist = 30, h = 46, look = new THREE.Vector3(0, 0, 0);
  if (mode === "low") { dist = 22; h = 16; }
  if (mode === "high") { dist = 36; h = 70; }
  const [sx, sy] = shake(t);
  camera.position.set(Math.cos(a) * dist + sx, h + sy, Math.sin(a) * dist);
  camera.lookAt(look);
}

function setUI(t) {
  const show = (id, on) => $(id).classList.toggle("hide", !on);
  const inTitle = spec.title_window && t >= spec.title_window[0] && t < spec.title_window[1];
  show("title", inTitle); show("setting", inTitle);
  if (inTitle) { $("title").innerHTML = spec.title_html; $("setting").textContent = spec.setting; }
  const cds = spec.countdowns || (spec.countdown ? [spec.countdown] : []);
  const cd = cds.find((c) => t >= c.show_from && t < c.zero_at + 1.5);
  const cdOn = !!cd;
  show("cd", cdOn);
  if (cdOn) {
    const left = Math.max(0, cd.zero_at - t), m = Math.floor(left / 60), s = left - m * 60;
    $("cd").querySelector(".label").textContent = cd.label;
    $("cd").querySelector(".time").textContent = `${m}:${s.toFixed(3).padStart(6, "0")}`;
  }
  const cap = between(spec.captions, t); show("cap", !!cap);
  if (cap) { const sp = $("cap").firstElementChild; sp.innerHTML = cap.html; sp.className = cap.sfx === "twist" ? "twist" : ""; }
  const big = between(spec.big, t);
  const ctr = between(spec.counters, t);
  show("big", !!(big || ctr));
  if (big) $("big").innerHTML = big.html;
  else if (ctr) {
    const k = ease((t - ctr.t0) / Math.max(0.1, (ctr.run || (ctr.t1 - ctr.t0) * 0.7)));
    const v = ctr.from + (ctr.to - ctr.from) * k;
    const txt = v.toLocaleString("ja-JP", { minimumFractionDigits: ctr.decimals || 0, maximumFractionDigits: ctr.decimals || 0 });
    $("big").innerHTML = `${ctr.prefix || ""}${txt}${ctr.suffix || ""}<small>${ctr.label || ""}</small>`;
  }
  const end = spec.end && t >= spec.end.t0; show("end", end);
  if (end) $("end").innerHTML = spec.end.html;
  const box = $("bubbles"); box.innerHTML = "";
  const sceneNow = between(spec.scenes, t);
  if (sceneNow && sceneNow.scene === "city") {
    for (const b of spec.bubbles || []) {
      if (t < b.t0 || t >= b.t1) continue;
      const p = people[b.person % people.length];
      const v = new THREE.Vector3(p.position.x, p.position.y + 3.4, p.position.z).project(camera);
      if (v.z > 1) continue;
      const top = (-v.y * 0.5 + 0.5) * H;
      if (top < 980 || top > 1380) continue;
      const el = document.createElement("div"); el.className = "bubble"; el.textContent = b.text;
      el.style.left = `${Math.min(W - 230, Math.max(230, (v.x * 0.5 + 0.5) * W))}px`; el.style.top = `${(-v.y * 0.5 + 0.5) * H}px`;
      box.appendChild(el);
    }
  }
}

window.load = (s) => {
  spec = s;
  renderer = new THREE.WebGLRenderer({ canvas: $("gl"), antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false); renderer.shadowMap.enabled = true; renderer.outputColorSpace = THREE.SRGBColorSpace;
  camera = new THREE.PerspectiveCamera(42, W / H, 0.5, 600);
  cityScene = buildCity(spec.time_of_day !== "day", spec.crowd || 120);
  earthScene = buildEarth();
  return document.fonts.ready.then(() => "ok");
};

window.renderAt = (t) => {
  const sc = between(spec.scenes, t) || spec.scenes[spec.scenes.length - 1];
  if (sc.scene === "earth") {
    const k = (t - sc.t0);
    earth.rotation.y = 0.4 + k * 0.08; earth.rotation.x = 0.35;
    const push = between(spec.earth_push, t);
    earth.position.y = push ? -0.25 * Math.sin(Math.min(1, (t - push.t0) / 1.2) * Math.PI) : 0;
    earthArrow.visible = !!push;
    earthPeople.visible = !!sc.people;
    if (sc.people) {
      const ej = (spec.actions || []).find((a) => a.type === "earth_jump");
      const k2 = ej ? (t - ej.t) / 0.9 : -1;
      const lift = k2 >= 0 && k2 <= 1 ? 4 * 0.55 * k2 * (1 - k2) : 0;
      const arr = earthPeople.geometry.attributes.position.array, dirs = earthPeople.userData.dirs;
      for (let i = 0; i < dirs.length; i++) { const R = 10.15 + lift * (0.6 + 0.4 * ((i * 37) % 10) / 10);
        arr[i * 3] = dirs[i].x * R; arr[i * 3 + 1] = dirs[i].y * R; arr[i * 3 + 2] = dirs[i].z * R; }
      earthPeople.geometry.attributes.position.needsUpdate = true;
    }
    const z = 78 - ease(k / 4) * 10;
    camera.position.set(0, 4, z); camera.lookAt(0, 4.5, 0);
    renderer.render(earthScene, camera);
  } else {
    placePeople(t); cityCamera(t, sc.camera);
    renderer.render(cityScene, camera);
  }
  setUI(t);
  return true;
};
