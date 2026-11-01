// Theme scenes: each one shows the thing being calculated (a stack, a container filling up, a line wrapping the
// globe, a line reaching the moon, growing bars, a train loop). Every scene entry in the episode is built once
// with its own camera, so several entries of the same kind can have different numbers.
import * as THREE from "../vendor/three.module.js";

const W = 1080, H = 1920, FOV = 42;
const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const mat = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...extra });
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

// Progress 0..1 of the scene's main animation. "grow": [t_start, t_end] in episode seconds.
function progress(sc, t) {
  const [a, b] = sc.grow || [sc.t0 + 0.6, sc.t0 + (sc.t1 - sc.t0) * 0.7];
  return smooth((t - a) / Math.max(0.1, b - a));
}
// Interpolate from -> to, optionally in log space (for things that grow by many orders of magnitude).
function lerpValue(from, to, k, log) {
  if (log && from > 0 && to > 0) return Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * k);
  return from + (to - from) * k;
}

function newCamera() { return new THREE.PerspectiveCamera(FOV, W / H, 0.1, 1000); }
const PX = Math.tan((FOV / 2) * Math.PI / 180) / (H / 2); // sprite scale per screen pixel (sizeAttenuation off)

// Screen-size text label (always readable, drawn on top).
export function label(text, { size = 46, color = "#ffffff", bg = "rgba(0,0,0,0.6)", sub = "" } = {}) {
  const c = document.createElement("canvas"), g = c.getContext("2d");
  const font = (s) => `900 ${s}px JP, sans-serif`;
  g.font = font(size); const w1 = g.measureText(text).width;
  g.font = font(size * 0.7); const w2 = sub ? g.measureText(sub).width : 0;
  const pad = size * 0.5, w = Math.ceil(Math.max(w1, w2) + pad * 2), h = Math.ceil(size * (sub ? 2.3 : 1.5));
  c.width = w; c.height = h;
  g.fillStyle = bg; const r = size * 0.35;
  g.beginPath(); g.roundRect(0, 0, w, h, r); g.fill();
  g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = color; g.font = font(size);
  g.fillText(text, w / 2, sub ? size * 0.8 : h / 2);
  if (sub) { g.fillStyle = "#ffffff"; g.font = font(size * 0.7); g.fillText(sub, w / 2, size * 1.68); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false }));
  sp.scale.set(w * PX, h * PX, 1); sp.renderOrder = 10; sp.center.set(0.5, 0.5);
  return sp;
}

function lights(s, night) {
  s.add(new THREE.HemisphereLight(0xffffff, night ? 0x202840 : 0x667788, night ? 1.0 : 1.5));
  const d = new THREE.DirectionalLight(0xfff4e0, night ? 1.2 : 2.0); d.position.set(-3, 5, 4); s.add(d);
  return d;
}

function globe(radius, seed = 11, detail = 3) {
  const geo = new THREE.IcosahedronGeometry(radius, detail), pos = geo.attributes.position, colors = [], r = rng(seed);
  for (let i = 0; i < pos.count; i += 3) {
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3 / radius, v = r();
    const c = Math.abs(y) > 0.86 ? [0.92, 0.95, 1] : v < 0.33 ? [0.27, 0.62, 0.36] : [0.16, 0.42, 0.78];
    for (let k = 0; k < 3; k++) colors.push(...c);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

function stars(s, spread = 400, z = -60) {
  const r = rng(3), g = new THREE.BufferGeometry(), p = [];
  for (let i = 0; i < 900; i++) p.push((r() - 0.5) * spread, (r() - 0.5) * spread * 1.6, z - r() * 100);
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  s.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5 })));
}

function stripeTexture(colorA, colorB) {
  const c = document.createElement("canvas"); c.width = 4; c.height = 16; const g = c.getContext("2d");
  g.fillStyle = colorA; g.fillRect(0, 0, 4, 16); g.fillStyle = colorB; g.fillRect(0, 13, 4, 3);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter; return t;
}

// ---------- tower: a stack of items growing next to real landmarks ----------
const ITEMS = {
  coin: { r: 0.01, thick: 0.0015, a: "#cfd4da", b: "#9aa1aa" },        // aluminium coin, 20 mm wide, 1.5 mm thick
  coin_gold: { r: 0.0118, thick: 0.0015, a: "#d9ad3c", b: "#a07a1c" },
  coin_copper: { r: 0.0118, thick: 0.0015, a: "#c47a42", b: "#8a4f25" },
  paper: { r: 0.12, thick: 0.0001, a: "#f6f6f2", b: "#d6d6d0", box: true },
  bill: { r: 0.08, thick: 0.0001, a: "#c9b98f", b: "#8f8466", box: true },
  book: { r: 0.12, thick: 0.03, a: "#d24c3c", b: "#f1ede2", box: true },
  box: { r: 0.25, thick: 0.4, a: "#c89a5c", b: "#8e6a3c", box: true },
  person: { r: 0.25, thick: 1.7, a: "#3a6fd8", b: "#f1c8a0", box: true },
  water: { r: 0.3, thick: 1, a: "#3aa0ff", b: "#3aa0ff" },
};

function refMesh(kind, m) {
  const g = new THREE.Group();
  if (kind === "person") {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.65, 0.3), mat(0x3a6fd8)); b.position.y = 0.95;
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.62, 0.28), mat(0x2b2f3d)); l.position.y = 0.31;
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), mat(0xf1c8a0)); h.position.y = 1.47;
    g.add(b, l, h); g.scale.setScalar(m / 1.7); g.userData.w = 0.5 * m / 1.7;
  } else if (kind === "house") {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1, 0.6, 0.9), mat(0xe9e2d3)); b.position.y = 0.3;
    const r = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.4, 4), mat(0x8a3b2e)); r.position.y = 0.8; r.rotation.y = Math.PI / 4;
    g.add(b, r); g.scale.setScalar(m); g.userData.w = m;
  } else if (kind === "building") {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1, 0.3), mat(0x7f8ea8)); b.position.y = 0.5;
    g.add(b); g.scale.setScalar(m); g.userData.w = 0.3 * m;
  } else if (kind === "tower") {           // generic lattice radio tower
    const red = mat(0xe0502e), white = mat(0xf2f2f2);
    for (let i = 0; i < 8; i++) {
      const y0 = i / 8, y1 = (i + 1) / 8, r0 = 0.16 * (1 - y0) ** 1.6 + 0.012, r1 = 0.16 * (1 - y1) ** 1.6 + 0.012;
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 1 / 8, 4, 1), i % 2 ? white : red);
      seg.position.y = (y0 + y1) / 2; g.add(seg);
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.025, 0.11), white); deck.position.y = 0.45; g.add(deck);
    g.scale.setScalar(m); g.userData.w = 0.32 * m;
  } else if (kind === "mountain") {
    const base = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1, 9), mat(0x5d6f86)); base.position.y = 0.5;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.3, 9), mat(0xf4f7fb)); cap.position.y = 0.855;
    g.add(base, cap); g.scale.setScalar(m); g.userData.w = 2.8 * m;
  } else if (kind === "cloud") {
    for (const [x, y, s] of [[0, 0, 1], [0.9, -0.1, 0.75], [-0.9, -0.1, 0.7], [0.3, 0.4, 0.7]]) {
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), mat(0xffffff)); c.position.set(x, y, 0); g.add(c);
    }
    g.userData.float = 0.06; g.userData.w = 0.12;
  } else if (kind === "plane") {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 2, 8), mat(0xf2f4f8)); f.rotation.z = Math.PI / 2;
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 2.2), mat(0xc7ccd6));
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.45, 0.04), mat(0xc7ccd6)); tl.position.set(-0.9, 0.25, 0);
    g.add(f, w, tl); g.userData.float = 0.05; g.userData.w = 0.1;
  } else if (kind === "satellite") {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), mat(0xd8d8d8));
    const p = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.05, 0.8), mat(0x2a4aa8));
    g.add(b, p); g.userData.float = 0.05; g.userData.w = 0.1;
  } else if (kind === "moon") {
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), mat(0xc9c9c4)));
    g.userData.float = 0.08; g.userData.w = 0.16;
  } else {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1, 0.3), mat(0x999999)); b.position.y = 0.5; g.add(b);
    g.scale.setScalar(m); g.userData.w = 0.3 * m;
  }
  return g;
}

function buildTower(sc) {
  const s = new THREE.Scene(), cam = newCamera(); lights(s, false);
  const it = ITEMS[sc.item] || ITEMS.coin;
  const colorA = sc.item_color || it.a;
  const tex = stripeTexture(colorA, it.b);
  const colGeo = it.box ? new THREE.BoxGeometry(2, 1, 2) : new THREE.CylinderGeometry(1, 1, 1, 24);
  colGeo.translate(0, 0.5, 0);
  const col = new THREE.Mesh(colGeo, new THREE.MeshLambertMaterial({ map: tex, emissive: new THREE.Color(colorA), emissiveIntensity: 0.15 }));
  s.add(col);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 48), mat(0x8fa482)); ground.rotation.x = -Math.PI / 2; s.add(ground);
  const planet = globe(6371000, 11, 4); planet.position.y = -6371000; planet.rotation.z = Math.PI / 2; planet.visible = false; s.add(planet);
  const refs = (sc.refs || []).map((rf, i) => {
    const mesh = refMesh(rf.kind, rf.m); s.add(mesh);
    const side = i % 2 ? 1 : -1;
    const lab = label(rf.label || `${rf.m.toLocaleString("ja-JP")} m`, { size: 40, sub: rf.sub || "" }); s.add(lab);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)]);
    const line = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: 0xffd23f, dashSize: 0.02, gapSize: 0.02 }));
    s.add(line);
    return { rf, mesh, lab, line, side };
  });
  const top = sc.top_label ? label("", { size: 52, color: "#ffd23f" }) : null;
  const sky = new THREE.Color(), day = new THREE.Color(0x9cc8ee), space = new THREE.Color(0x05070f);
  return {
    scene: s, camera: cam,
    render(t, renderer) {
      const k = progress(sc, t), h = Math.max(1e-6, lerpValue(sc.from_m ?? 0, sc.to_m, k, sc.curve === "log"));
      const F = Math.max(h, sc.min_view_m || it.thick * 20, 0.05);      // height of the frame we want to show
      const d = F * 1.55 / Math.tan((FOV / 2) * Math.PI / 180);
      const vr = Math.max(it.r, F * 0.012);                             // widen the column so it stays visible
      col.scale.set(vr, h, vr);
      tex.repeat.set(1, Math.min(h / it.thick, 80));
      const big = F > 3e5;
      ground.visible = !big; planet.visible = big;
      ground.scale.setScalar(F * 40);
      sky.copy(day).lerp(space, clamp01((Math.log10(F) - 4.3) / 1.2)); s.background = sky;
      for (const r of refs) {
        const m = r.rf.m, fl = r.mesh.userData.float;
        let w;
        if (fl) { const sz = Math.max(m * fl, F * 0.03); r.mesh.scale.setScalar(sz); r.mesh.position.set(r.side * (vr * 3 + sz * 1.6), m, 0); w = sz; }
        else { w = r.mesh.userData.w; r.mesh.position.set(r.side * (vr * 3 + w * 0.3), 0, -w * 0.45); }
        const x = r.mesh.position.x;
        r.line.position.set(0, m, r.mesh.position.z * 0.5); r.line.scale.set(x, 1, 1); r.line.computeLineDistances();
        r.line.material.dashSize = r.line.material.gapSize = Math.abs(x) / 30;
        r.lab.position.set(x, m + F * 0.05, r.mesh.position.z);
        const visible = m < F * 1.6 && m > F * 0.04;
        r.mesh.visible = fl ? visible : m < F * 1.25 && m > F * 0.01; r.lab.visible = visible; r.line.visible = visible;
      }
      if (top) { top.position.set(0, h + F * 0.06, 0); }
      const a = 0.35 + (t - sc.t0) * 0.04;
      cam.position.set(Math.sin(a) * d * 0.5, F * 0.55 + d * 0.08, Math.cos(a) * d);
      cam.near = d * 0.01; cam.far = big ? d * 10 + 2e7 : d * 60; cam.updateProjectionMatrix();
      cam.lookAt(0, F * 0.5, 0);
      renderer.render(s, cam);
    },
  };
}

// ---------- globe: a line wrapping the earth N times ----------
function buildGlobe(sc) {
  const s = new THREE.Scene(), cam = newCamera(); s.background = new THREE.Color(0x05070f);
  s.add(new THREE.AmbientLight(0x6070a0, 0.8)); const l = new THREE.DirectionalLight(0xffffff, 2.4); l.position.set(-5, 3, 5); s.add(l);
  stars(s); const g = new THREE.Group(); s.add(g);
  const earth = globe(10); g.add(earth);
  const w = sc.wrap || { from: 0, to: 1 };
  const maxL = Math.min(Math.max(w.to, w.from, 0.01), 40);
  const pts = [], N = Math.ceil(maxL * 120) + 2;
  for (let i = 0; i <= N; i++) {
    const f = i / N, ang = f * maxL * Math.PI * 2;
    const lat = (maxL > 1 ? -0.95 + 1.9 * f : 0) + Math.sin(ang * 0.5) * 0.02;
    const R = 10.25;
    pts.push(new THREE.Vector3(Math.cos(lat) * Math.cos(ang) * R, Math.sin(lat) * R, Math.cos(lat) * Math.sin(ang) * R));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.TubeGeometry(curve, N, maxL > 15 ? 0.07 : 0.13, 6, false);
  const tm = new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: new THREE.Color(w.color || 0xffd23f) }));
  g.add(tm);
  return {
    scene: s, camera: cam,
    render(t, renderer) {
      const k = progress(sc, t), L = lerpValue(w.from || 0, w.to, k, false);
      tube.setDrawRange(0, Math.floor(tube.index.count * clamp01(L / maxL) / 6) * 6);
      g.rotation.y = 0.4 + (t - sc.t0) * 0.12; g.rotation.x = 0.3;
      const z = 52 - smooth((t - sc.t0) / 4) * 6;
      cam.position.set(0, 0, z); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix();
      renderer.render(s, cam);
    },
  };
}

// ---------- space: a line from the earth reaching for the moon (strands = how many times it covers the distance) ----------
function buildSpace(sc) {
  const s = new THREE.Scene(), cam = newCamera(); s.background = new THREE.Color(0x05070f);
  s.add(new THREE.AmbientLight(0x6070a0, 0.8)); const l = new THREE.DirectionalLight(0xffffff, 2.4); l.position.set(-5, 3, 5); s.add(l);
  stars(s, 500, -120);
  const D = 60, ER = 4, MR = 1.1;
  const earth = globe(ER); s.add(earth);
  const moon = new THREE.Mesh(new THREE.IcosahedronGeometry(MR, 2), mat(0xc9c9c4)); moon.position.y = D; s.add(moon);
  const r = sc.reach || { from: 0, to: 1 };
  const strands = Math.min(Math.ceil(Math.max(r.to, r.from, 0.01)), 40);
  const lines = [];
  const lineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(r.color || 0xffd23f) });
  for (let i = 0; i < strands; i++) {
    const geo = new THREE.CylinderGeometry(0.12, 0.12, 1, 6); geo.translate(0, 0.5, 0);
    const m = new THREE.Mesh(geo, lineMat);
    const a = i * 2.399, rad = i === 0 ? 0 : 0.35 * Math.sqrt(i);
    m.position.set(Math.cos(a) * rad, ER - 0.2, Math.sin(a) * rad); s.add(m); lines.push(m);
  }
  const full = D - MR - ER + 0.2;
  const moonLab = label(sc.moon_label || "月", { size: 40 }); moonLab.position.set(0, D + MR + 3, 0); s.add(moonLab);
  const earthLab = label(sc.earth_label || "地球", { size: 40 }); earthLab.position.set(0, -ER - 3, 0); s.add(earthLab);
  return {
    scene: s, camera: cam,
    render(t, renderer) {
      const k = progress(sc, t), R = lerpValue(r.from || 0, r.to, k, false);
      lines.forEach((m, i) => { const f = clamp01(R - i); m.visible = f > 0.002; m.scale.set(1, Math.max(f * full, 0.001), 1); });
      const tip = ER + clamp01(R) * full;
      const kk = smooth((t - sc.t0) / Math.max(1, (sc.t1 - sc.t0) * 0.6));
      const look = Math.min(D / 2, Math.max(tip * 0.55, 6)), d = 30 + kk * 70;
      earth.rotation.y = 0.4 + (t - sc.t0) * 0.1;
      cam.position.set(d * 0.25, look + 4, d); cam.lookAt(0, look, 0); cam.updateProjectionMatrix();
      renderer.render(s, cam);
    },
  };
}

// ---------- fill: containers filling up (level 1 = one full container; 3.5 = three and a half) ----------
const CONTAINERS = {
  dome: { seg: 48, h: 0.65, prof: (y) => (y <= 0.3 ? 1 : Math.sqrt(Math.max(0, 1 - ((y - 0.3) / 0.35) ** 2))), sx: 1, gap: 2.8 },
  pool: { seg: 4, h: 0.16, prof: () => 1, sx: 2, gap: 2.6 },
  tub: { seg: 4, h: 0.55, prof: () => 1, sx: 1.6, gap: 2.4 },
  cup: { seg: 32, h: 1.3, prof: (y) => 0.38 + 0.12 * (y / 1.3), sx: 1, gap: 1.4 },
  box: { seg: 4, h: 1.4, prof: () => 1, sx: 1, gap: 2.0 },
  bottle: { seg: 24, h: 2.2, prof: (y) => (y < 1.4 ? 0.36 : y < 1.8 ? 0.36 - (y - 1.4) * 0.6 : 0.12), sx: 1, gap: 1.2 },
};
function lathe(c, top, steps = 24) {
  const pts = [new THREE.Vector2(0, 0)];
  for (let i = 0; i <= steps; i++) { const y = (top * i) / steps; pts.push(new THREE.Vector2(c.prof(y) * (c.seg === 4 ? Math.SQRT2 : 1), y)); }
  pts.push(new THREE.Vector2(0, top));
  const g = new THREE.LatheGeometry(pts, c.seg, c.seg === 4 ? Math.PI / 4 : 0);
  return g;
}
function buildFill(sc) {
  const s = new THREE.Scene(), cam = newCamera(); lights(s, sc.time_of_day === "night");
  s.background = new THREE.Color(sc.time_of_day === "night" ? 0x0d1426 : 0x9cc8ee);
  const c = CONTAINERS[sc.container] || CONTAINERS.dome;
  const lv = sc.level || { from: 0, to: 1 };
  const total = Math.min(Math.ceil(Math.max(lv.to, lv.from, 0.01)), 100);
  const side = Math.ceil(Math.sqrt(total));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat(sc.time_of_day === "night" ? 0x3a4458 : 0x8fa482));
  ground.rotation.x = -Math.PI / 2; s.add(ground);
  const shellMat = new THREE.MeshLambertMaterial({ color: 0xe8eef6, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  const fillMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(sc.color || 0x3aa0ff), transparent: true, opacity: 0.9, flatShading: true });
  const units = [];
  for (let i = 0; i < total; i++) {
    const g = new THREE.Group();
    const gx = (i % side) - (side - 1) / 2, gz = Math.floor(i / side) - (side - 1) / 2;
    g.position.set(gx * c.gap * c.sx, 0, gz * c.gap); g.scale.x = c.sx;
    const shellGeo = lathe(c, c.h);
    const shell = new THREE.Mesh(shellGeo, shellMat); shell.renderOrder = 2;
    g.add(shell, new THREE.LineSegments(new THREE.WireframeGeometry(lathe({ ...c }, c.h, 6)), edgeMat));
    const fill = new THREE.Mesh(new THREE.BufferGeometry(), fillMat); g.add(fill);
    g.userData = { fill, last: -1 }; s.add(g); units.push(g);
  }
  const extentFor = (n) => Math.max(1.6, Math.ceil(Math.sqrt(n)) * c.gap * c.sx * 0.6 + 1);
  return {
    scene: s, camera: cam,
    render(t, renderer) {
      const k = progress(sc, t), L = lerpValue(lv.from || 0, lv.to, k, false);
      units.forEach((u, i) => {
        const f = clamp01(L - i), q = Math.round(f * 200) / 200;
        u.visible = i < Math.max(1, Math.ceil(L + 0.001)) || i === 0;
        if (q !== u.userData.last) {
          u.userData.fill.geometry.dispose();
          u.userData.fill.geometry = q > 0 ? lathe({ ...c, prof: (y) => c.prof(y) * 0.97 }, Math.max(0.002, q * c.h)) : new THREE.BufferGeometry();
          u.userData.last = q;
        }
      });
      const ext = extentFor(Math.max(1, Math.ceil(L)));
      const a = 0.7 + (t - sc.t0) * 0.06, d = ext * 2.6 + c.h * 2;
      cam.position.set(Math.cos(a) * d, d * 0.62 + c.h, Math.sin(a) * d); cam.lookAt(0, c.h * 0.3, 0); cam.updateProjectionMatrix();
      renderer.render(s, cam);
    },
  };
}

// ---------- chart: bars appearing one by one (e.g. money doubling every day) ----------
function buildChart(sc) {
  const s = new THREE.Scene(), cam = newCamera(); lights(s, true); s.background = new THREE.Color(0x0d1426);
  const bars = sc.bars || [], n = bars.length, max = Math.max(...bars.map((b) => b.value), 1e-9);
  const hOf = (v) => (sc.log ? (Math.log10(Math.max(v, 1)) / Math.log10(Math.max(max, 10))) * 10 : (v / max) * 10);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(n * 1.4 + 40, 40), mat(0x1c2540)); floor.rotation.x = -Math.PI / 2; s.add(floor);
  const step = Math.max(1, Math.ceil(n / 8));
  const items = bars.map((b, i) => {
    const geo = new THREE.BoxGeometry(0.9, 1, 0.9); geo.translate(0, 0.5, 0);
    const m = new THREE.Mesh(geo, mat(new THREE.Color(b.color || sc.color || 0xffd23f), { emissive: new THREE.Color(b.color || sc.color || 0xffd23f), emissiveIntensity: 0.25 }));
    m.position.x = i * 1.3; s.add(m);
    const show = i % step === 0 || i === n - 1;
    const val = true ? label(b.display || `${b.value.toLocaleString("ja-JP")}${sc.suffix || ""}`, { size: 38, color: "#ffd23f" }) : null;
    const name = show && b.label ? label(b.label, { size: 30, bg: "rgba(0,0,0,0)" }) : null;
    if (val) s.add(val); if (name) { name.position.set(i * 1.3, -0.6, 0.8); s.add(name); }
    return { m, val, h: hOf(b.value) };
  });
  return {
    scene: s, camera: cam,
    render(t, renderer) {
      const k = progress(sc, t), pos = k * n;           // how many bars are out
      let cur = 0, hMax = 0.5; const newest = Math.min(n - 1, Math.floor(pos - 0.6));
      items.forEach((it, i) => {
        const f = smooth(pos - i), h = Math.max(0.001, it.h * f);
        it.m.visible = f > 0; it.m.scale.y = h;
        if (it.val) { it.val.visible = f > 0.6 && (i === newest || (!!sc.all_values && n <= 8)); it.val.position.set(i * 1.3, h + 0.7, 0); }
        if (f > 0) { cur = i; hMax = Math.max(hMax, h); }
      });
      const fit = sc.fit_all || n <= 8;
      const cx = fit ? (n - 1) * 0.65 : Math.max(cur * 1.3 - 3.5, 0) + 3.5 * Math.min(1, cur / 3);
      const span = fit ? n * 1.3 + 2 : 10;
      const d = Math.max(span / 0.432 * 1.1, hMax * 1.8 + 8);
      cam.position.set(cx + 2, hMax * 0.55 + d * 0.18, d); cam.lookAt(cx, hMax * 0.5, 0); cam.updateProjectionMatrix();
      renderer.render(s, cam);
    },
  };
}

// ---------- loop: a ring railway with stations, a running train and waiting people ----------
function buildLoop(sc) {
  const s = new THREE.Scene(), cam = newCamera(); const night = sc.time_of_day === "night"; lights(s, night);
  s.background = new THREE.Color(night ? 0x0d1426 : 0x9cc8ee);
  const R = 22, ns = Math.min(sc.stations || 12, 40), r = rng(5);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), mat(night ? 0x3a4458 : 0x8a9a86)); ground.rotation.x = -Math.PI / 2; s.add(ground);
  const track = new THREE.Mesh(new THREE.TorusGeometry(R, 0.35, 6, 120), mat(0x4a505c)); track.rotation.x = Math.PI / 2; track.position.y = 0.2; s.add(track);
  for (let i = 0; i < 40; i++) {             // low blocks inside/outside the loop
    const a = r() * Math.PI * 2, rad = r() < 0.5 ? R * (0.2 + r() * 0.6) : R * (1.2 + r() * 0.6);
    const h = 1 + r() * 6, b = new THREE.Mesh(new THREE.BoxGeometry(2 + r() * 2, h, 2 + r() * 2), mat(night ? 0x46536e : 0xc3c8d0));
    b.position.set(Math.cos(a) * rad, h / 2, Math.sin(a) * rad); s.add(b);
  }
  const crowd = clamp01(sc.crowd ?? 0.4), dotGeo = new THREE.BoxGeometry(0.28, 0.6, 0.28);
  const pplColors = [0xe8a23a, 0x3a6fd8, 0x2f8a5c, 0xd8d0c0, 0xc0392b, 0x34495e];
  for (let i = 0; i < ns; i++) {
    const a = (i / ns) * Math.PI * 2, pr = R + 1.3;
    const pf = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 4), mat(0xb0b6c0)); pf.position.set(Math.cos(a) * pr, 0.15, Math.sin(a) * pr); pf.rotation.y = -a; s.add(pf);
    const people = Math.round(crowd * 24);
    for (let j = 0; j < people; j++) {
      const p = new THREE.Mesh(dotGeo, mat(pplColors[j % pplColors.length]));
      const u = (r() - 0.5) * 3.6, v = (r() - 0.5) * 0.9;
      p.position.set(Math.cos(a) * (pr + v) - Math.sin(a) * u, 0.6, Math.sin(a) * (pr + v) + Math.cos(a) * u); s.add(p);
    }
  }
  const cars = Math.min(sc.cars || 11, 15), train = [];
  for (let i = 0; i < cars; i++) {
    const c = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 2.1), mat(0xdfe5ea)); body.position.y = 0.75;
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.18, 2.12), mat(new THREE.Color(sc.color || 0x7cc242))); band.position.y = 0.6;
    c.add(body, band); s.add(c); train.push(c);
  }
  return {
    scene: s, camera: cam,
    render(t, renderer) {
      const k = progress(sc, t), laps = sc.laps ?? 1;
      const head = k * laps * Math.PI * 2 + (t - sc.t0) * (sc.drift ?? 0.02);
      train.forEach((c, i) => { const a = head - i * (2.3 / R); c.position.set(Math.cos(a) * R, 0, Math.sin(a) * R); c.rotation.y = -a; });
      const a = 0.5 + (t - sc.t0) * 0.04, d = 58;
      cam.position.set(Math.cos(a) * d, 46, Math.sin(a) * d); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix();
      renderer.render(s, cam);
    },
  };
}

const BUILDERS = { tower: buildTower, globe: buildGlobe, space: buildSpace, fill: buildFill, chart: buildChart, loop: buildLoop };
export const isExtra = (name) => name in BUILDERS;
export function buildExtra(sc) { return BUILDERS[sc.scene](sc); }

