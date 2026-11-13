// "Cinematic voxel" look: blocky pixel-textured people + realistic-ish lighting, rain, fog, bloom and grading.
import * as THREE from "../vendor/three.module.js";
import { EffectComposer } from "../vendor/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "../vendor/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "../vendor/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "../vendor/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "../vendor/jsm/postprocessing/OutputPass.js";

export const S = (c, rough = 0.85, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0, ...extra });
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const hex = (n) => "#" + n.toString(16).padStart(6, "0");
function shade(h, k) { const c = new THREE.Color(h); c.multiplyScalar(k); return "#" + c.getHexString(); }

// ---------- pixel textures ----------
function tex(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace; return t;
}
// fill with a base colour + per-pixel noise (the classic voxel look)
function noisy(g, w, h, base, r, amt = 0.12, x0 = 0, y0 = 0) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { g.fillStyle = shade(base, 1 - amt / 2 + r() * amt); g.fillRect(x0 + x, y0 + y, 1, 1); }
}

const SKINS = [0xf2c9a1, 0xe3b18a, 0xd09a72, 0xb27a54, 0x8d5a3b];
const HAIRS = [0x1d1a1a, 0x2b211c, 0x3d2a1e, 0x6b4a2e, 0x9a6b3c, 0x1a1a2a, 0x7a7a7a];
const TOPS = [0xc4552f, 0x2f5fa8, 0x3b7a4e, 0xe6d6b8, 0x6a3f8a, 0xa8322e, 0x2c3e50, 0xd9a43a, 0x1f8a83, 0xe8e8e8, 0x8a8f99, 0x50382a];
const BOTTOMS = [0x24324d, 0x2b2b2e, 0x4a3b2c, 0x3d4a5c, 0x1e2a3a, 0x6b6f75];
const EYES = [0x2a1d14, 0x22303f, 0x3a2a1a];

// One original blocky character. Front faces +z. Height ~3.5 units.
export function voxelPerson(r, opts = {}) {
  const px = 0.11, skin = pick(r, SKINS), hair = pick(r, HAIRS), top = opts.top ?? pick(r, TOPS), bottom = pick(r, BOTTOMS);
  const eye = pick(r, EYES), style = Math.floor(r() * 4), jacket = r() < 0.4, shoe = r() < 0.5 ? 0xe9e9e9 : 0x2a2a2a;
  const mats = (faces) => faces.map((t) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }));
  // head (8x8x8)
  const hf = (side) => tex(8, 8, (g) => {
    noisy(g, 8, 8, hex(skin), r, 0.08);
    const long = style === 1, cap = style === 3;
    if (side === "top") { noisy(g, 8, 8, cap ? hex(top) : hex(hair), r); return; }
    if (side === "back") { noisy(g, 8, long ? 8 : 6, cap ? hex(top) : hex(hair), r); if (cap) noisy(g, 8, 4, hex(hair), r, 0.1, 0, 3); return; }
    if (side === "bottom") return;
    if (side === "front") {
      noisy(g, 8, cap ? 2 : 2, cap ? hex(top) : hex(hair), r);
      if (style === 2) noisy(g, 3, 1, hex(hair), r, 0.1, 0, 2);            // side fringe
      if (long) { noisy(g, 1, 6, hex(hair), r, 0.1, 0, 2); noisy(g, 1, 6, hex(hair), r, 0.1, 7, 2); }
      g.fillStyle = "#f4f4f4"; g.fillRect(1, 4, 2, 1); g.fillRect(5, 4, 2, 1);
      g.fillStyle = hex(eye); g.fillRect(2, 4, 1, 1); g.fillRect(5, 4, 1, 1);
      g.fillStyle = shade(hex(skin), 0.72); g.fillRect(3, 6, 2, 1);            // mouth
      g.fillStyle = shade(hex(skin), 0.88); g.fillRect(3, 5, 2, 1);            // nose shadow
      return;
    }
    noisy(g, 8, long ? 7 : 3, cap ? hex(top) : hex(hair), r); if (!long) noisy(g, 2, 3, hex(hair), r, 0.1, side === "left" ? 6 : 0, 3);
  });
  const head = new THREE.Mesh(new THREE.BoxGeometry(8 * px, 8 * px, 8 * px),
    mats([hf("left"), hf("right"), hf("top"), hf("bottom"), hf("front"), hf("back")]));
  // torso (8x12x4)
  const tf = (front) => tex(8, 12, (g) => {
    noisy(g, 8, 12, hex(top), r, 0.1);
    if (front && jacket) { g.fillStyle = shade(hex(top), 0.55); g.fillRect(3, 0, 2, 12); g.fillStyle = "#e8e4dc"; g.fillRect(3, 0, 2, 3); }
    if (front && !jacket) { g.fillStyle = shade(hex(top), 0.8); g.fillRect(2, 0, 4, 1); }
    noisy(g, 8, 1, shade(hex(top), 0.7), r, 0.05, 0, 11);
  });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(8 * px, 12 * px, 4 * px), mats([tf(), tf(), tf(), tf(), tf(true), tf()]));
  const limb = (cTop, cEnd, endRows) => { const t = tex(4, 12, (g) => { noisy(g, 4, 12, hex(cTop), r, 0.1); noisy(g, 4, endRows, hex(cEnd), r, 0.08, 0, 12 - endRows); });
    return new THREE.Mesh(new THREE.BoxGeometry(4 * px, 12 * px, 4 * px), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 })); };
  const p = new THREE.Group(), y0 = 12 * px;
  const mkPivot = (mesh, x, y) => { const g = new THREE.Group(); mesh.position.y = -6 * px; g.add(mesh); g.position.set(x, y, 0); return g; };
  const legL = mkPivot(limb(bottom, shoe, 2), -2 * px, y0), legR = mkPivot(limb(bottom, shoe, 2), 2 * px, y0);
  const armL = mkPivot(limb(top, skin, 3), -6 * px, y0 + 12 * px), armR = mkPivot(limb(top, skin, 3), 6 * px, y0 + 12 * px);
  torso.position.y = y0 + 6 * px; head.position.y = y0 + 16 * px;
  p.add(legL, legR, armL, armR, torso, head);
  p.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  p.userData.limbs = { legL, legR, armL, armR };
  if (opts.umbrella) {
    const ug = new THREE.Group(), col = pick(r, [0x1b2a4a, 0x8a1f2b, 0x2a2a2a, 0xd8d8e0, 0x24584a, 0x3a5fb0]);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.7, 8, 1, true), S(col, 0.45, { side: THREE.DoubleSide, flatShading: true }));
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.9, 4), S(0x222222));
    canopy.position.y = 0.95; stick.position.y = 0; ug.add(canopy, stick); ug.position.set(opts.umbrellaX ?? 6 * px, y0 + 12 * px + 0.55, 0.1);
    canopy.castShadow = true; p.add(ug); p.userData.umbrella = true;
  }
  return p;
}

export function animateLimbs(p, t, walking, speed = 1) {
  const L = p.userData.limbs; if (!L) return;
  const a = walking ? Math.sin(t * 7 * speed) * 0.65 : 0;
  L.legL.rotation.x = a; L.legR.rotation.x = -a;
  L.armL.rotation.x = -a * 0.8; L.armR.rotation.x = p.userData.umbrella ? -0.9 : a * 0.8;
}

// ---------- rain ----------
export function makeRain(r, box = [-30, 30, -60, 40], top = 40, n = 4000) {
  const pos = new Float32Array(n * 6), seeds = [];
  for (let i = 0; i < n; i++) seeds.push([box[0] + r() * (box[1] - box[0]), box[2] + r() * (box[3] - box[2]), r() * top, 26 + r() * 10]);
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xa9b8cf, transparent: true, opacity: 0.38, fog: true }));
  lines.frustumCulled = false;
  // splash rings on the ground
  const ringG = new THREE.RingGeometry(0.05, 0.08, 10); ringG.rotateX(-Math.PI / 2);
  const rings = new THREE.InstancedMesh(ringG, new THREE.MeshBasicMaterial({ color: 0xcfd8e6, transparent: true, opacity: 0.35, depthWrite: false }), 500);
  const rs = []; for (let i = 0; i < 500; i++) rs.push([box[0] + r() * (box[1] - box[0]), box[2] + r() * (box[3] - box[2]), r()]);
  rings.frustumCulled = false;
  const grp = new THREE.Group(); grp.add(lines, rings);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  grp.userData.update = (t, wind = 0.25) => {
    for (let i = 0; i < n; i++) { const [x, z, y0, sp] = seeds[i], y = ((y0 - t * sp) % top + top) % top, o = i * 6, len = 0.9;
      pos[o] = x + wind * y; pos[o + 1] = y; pos[o + 2] = z; pos[o + 3] = x + wind * (y + len); pos[o + 4] = y + len; pos[o + 5] = z; }
    g.attributes.position.needsUpdate = true;
    for (let i = 0; i < rs.length; i++) { const [x, z, ph] = rs[i], k = (t * 1.7 + ph) % 1, s = 0.3 + k * 1.6;
      v.set(x + Math.floor(t * 1.7 + ph) * 0.37 % 3, 0.04, z); sc.set(s, 1, s); m4.compose(v, q, sc); rings.setMatrixAt(i, m4); }
    rings.instanceMatrix.needsUpdate = true; rings.material.opacity = 0.16;
  };
  return grp;
}

// ---------- signs / props ----------
const SIGN_WORDS = ["ラーメン", "居酒屋", "薬", "喫茶", "そば", "焼鳥", "クリーニング", "BAR", "定食", "珈琲", "古本", "餃子"];
export function signTex(word, bg, fg) {
  return tex(256, 64, (g) => { g.fillStyle = bg; g.fillRect(0, 0, 256, 64); g.fillStyle = fg;
    g.font = '900 40px "JP", sans-serif'; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(word, 128, 34); });
}
function vertSign(word, bg, fg) {
  const t = tex(64, 256, (g) => { g.fillStyle = bg; g.fillRect(0, 0, 64, 256); g.fillStyle = fg; g.font = '900 44px "JP", sans-serif';
    g.textAlign = "center"; g.textBaseline = "middle"; [...word].slice(0, 4).forEach((ch, i, a) => g.fillText(ch, 32, 128 + (i - (a.length - 1) / 2) * 48)); });
  t.magFilter = THREE.LinearFilter; return t;
}
function facadeTex(r, cols, rows, litK) {
  return tex(cols * 16, rows * 16, (g, w, h) => {
    noisy(g, w, h, pick(r, ["#6d6a66", "#7a746a", "#5d6066", "#8a8478", "#4f5358", "#9a9286"]), r, 0.1);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const v = r(); g.fillStyle = v < litK * 0.6 ? pick(r, ["#ffcf7a", "#ffd99a", "#ffe3b0"]) : v < litK ? "#9fc8e8" : "#151a22";
      g.fillRect(x * 16 + 3, y * 16 + 4, 10, 9); g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(x * 16 + 3, y * 16 + 13, 10, 1);
    }
  });
}
export function vendingMachine(r) {
  const g = new THREE.Group(), body = S(pick(r, [0xe8e8ea, 0xc8282e, 0x2a5fb0, 0xf2f2f2]), 0.5);
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.8, 3.6, 1.4), body); box.position.y = 1.8; box.castShadow = true;
  const front = tex(32, 64, (gg) => { gg.fillStyle = "#f6f9ff"; gg.fillRect(0, 0, 32, 64);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) { gg.fillStyle = hex(pick(r, [0xd23a3a, 0x3a7ad2, 0x3aa86a, 0xf2c23a, 0x8a5a3a, 0xeaeaea, 0x1a1a1a])); gg.fillRect(2 + x * 5, 3 + y * 8, 3, 5); }
    gg.fillStyle = "#1a1d24"; gg.fillRect(2, 40, 28, 10); gg.fillStyle = "#3a3f4a"; gg.fillRect(4, 54, 24, 6); });
  front.magFilter = THREE.NearestFilter;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3.2), new THREE.MeshStandardMaterial({ map: front, emissive: 0xffffff, emissiveMap: front, emissiveIntensity: 1.6, roughness: 0.3 }));
  face.position.set(0, 1.9, 0.71); g.add(box, face); return g;
}
function lamp(s, x, z, side, lights) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6.5, 6), S(0x5a5e66, 0.6)); pole.position.set(x, 3.25, z);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.12), S(0x5a5e66, 0.6)); arm.position.set(x - side * 0.6, 6.4, z);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.4), new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffe2a8, emissiveIntensity: 5 }));
  head.position.set(x - side * 1.2, 6.3, z); s.add(pole, arm, head);
  if (lights) { const L = new THREE.PointLight(0xffc98a, 38, 22, 1.6); L.position.set(x - side * 1.2, 6.0, z); s.add(L);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.6, 6, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.022, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    cone.position.set(x - side * 1.2, 3.1, z); s.add(cone); }
}
function utilityPole(s, x, z) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 10, 8), S(0x8d8a82, 0.9)); pole.position.set(x, 5, z); pole.castShadow = true;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.12), S(0x4a4a4a)); bar.position.set(x, 9.2, z);
  const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.0, 8), S(0x6c7076, 0.6)); tr.position.set(x + 0.45, 7.6, z);
  s.add(pole, bar, tr);
}
function wires(s, xs, zs, heights) {
  const mat = new THREE.LineBasicMaterial({ color: 0x15171c });
  for (const x of xs) for (const h of heights) {
    for (let i = 0; i < zs.length - 1; i++) { const pts = []; for (let k = 0; k <= 10; k++) { const u = k / 10;
      pts.push(new THREE.Vector3(x, h - Math.sin(u * Math.PI) * 0.55, zs[i] + (zs[i + 1] - zs[i]) * u)); }
      s.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat)); }
  }
}

// ---------- the alley: narrow Japanese street at night in the rain ----------
export function buildStreet(spec, r, people) {
  const s = new THREE.Scene(), night = (spec.time_of_day || "night") !== "day";
  const fogC = night ? 0x1a2130 : 0x9aa8b8;
  s.background = new THREE.Color(night ? 0x141a26 : 0xa9b6c6); s.fog = new THREE.FogExp2(fogC, night ? 0.022 : 0.012);
  s.add(new THREE.HemisphereLight(night ? 0x6f86b8 : 0xdfe8f5, night ? 0x1a1c22 : 0x5a5850, night ? 0.55 : 1.4));
  const moon = new THREE.DirectionalLight(night ? 0x8fa6d8 : 0xfff0dc, night ? 0.6 : 1.8); moon.position.set(-14, 30, 18);
  moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048); Object.assign(moon.shadow.camera, { left: -30, right: 30, top: 40, bottom: -40, far: 120 });
  moon.shadow.bias = -0.0005; s.add(moon, moon.target); moon.target.position.set(0, 0, -10);
  const L = 140, wet = spec.wet ?? night;
  const road = new THREE.Mesh(new THREE.PlaneGeometry(9, L), new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: wet ? 0.18 : 0.85, metalness: wet ? 0.35 : 0 }));
  road.rotation.x = -Math.PI / 2; road.position.z = -L / 2 + 30; road.receiveShadow = true; s.add(road);
  for (const sx of [-1, 1]) { const curb = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, L), S(0xd8d8d0, 0.5)); curb.position.set(sx * 3.9, 0.04, -L / 2 + 30); s.add(curb); }
  for (let z = 26; z > -100; z -= 6) { const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 3), S(0xd9d9cf, 0.5)); dash.rotation.x = -Math.PI / 2; dash.position.set(0, 0.012, z); s.add(dash); }
  // puddles (mirror-ish patches)
  for (let i = 0; i < 18; i++) { const pd = new THREE.Mesh(new THREE.CircleGeometry(0.6 + r() * 1.4, 14), new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.05, metalness: 0.7, transparent: true, opacity: 0.7 }));
    pd.rotation.x = -Math.PI / 2; pd.scale.set(1, 0.5 + r() * 0.5, 1); pd.position.set((r() - 0.5) * 7, 0.015, 24 - r() * 110); if (wet) s.add(pd); }
  const lightsAt = new Set(); let li = 0;
  for (const side of [-1, 1]) {
    let z = 34;
    while (z > -110) {
      const w = 5 + r() * 5, d = 7 + r() * 4, h = 6 + r() * 12, x = side * (4.6 + d / 2);
      const f = facadeTex(r, Math.max(2, Math.round(w / 1.4)), Math.max(2, Math.round(h / 2.2)), night ? 0.45 : 0.05);
      const mat = new THREE.MeshStandardMaterial({ map: f, emissive: 0xffffff, emissiveMap: f, emissiveIntensity: night ? 0.55 : 0, roughness: 0.9 });
      const roofM = S(0x3a3d44), b = new THREE.Mesh(new THREE.BoxGeometry(d, h, w), [mat, mat, roofM, roofM, mat, mat]);
      b.position.set(x, h / 2, z - w / 2); b.castShadow = true; b.receiveShadow = true; s.add(b);
      // ground-floor shop: lit window + awning + sign
      const front = x - side * d / 2 - side * 0.02;
      if (r() < 0.75) {
        const word = pick(r, SIGN_WORDS), warm = r() < 0.6;
        const shop = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, 2.2), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: warm ? 0xffc27a : 0xdfeeff, emissiveIntensity: night ? 0.85 : 0.4 }));
        shop.position.set(front, 1.3, z - w / 2); shop.rotation.y = -side * Math.PI / 2; s.add(shop);
        const aw = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, w * 0.85), S(pick(r, [0x7a1f22, 0x1f4a3a, 0x2a3a5a, 0x5a4a2a]), 0.7)); aw.position.set(front - side * 0.6, 2.75, z - w / 2); aw.rotation.z = side * 0.25; aw.castShadow = true; s.add(aw);
        const st = r() < 0.5 ? signTex(word, pick(r, ["#f4efe4", "#1d1d1d", "#8a1a1a", "#203a5a"]), pick(r, ["#c41d1d", "#ffffff", "#ffd23f"])) : vertSign(word, pick(r, ["#f4efe4", "#c41d1d", "#1d1d1d"]), pick(r, ["#1d1d1d", "#ffffff", "#ffd23f"]));
        const vert = st.image.height > st.image.width;
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(vert ? 0.8 : 2.6, vert ? 3.2 : 0.65), new THREE.MeshStandardMaterial({ map: st, emissive: 0xffffff, emissiveMap: st, emissiveIntensity: night ? 1.4 : 0.2, side: THREE.DoubleSide }));
        if (vert) { sign.position.set(front - side * 0.7, 4.6, z - 0.6); sign.rotation.y = 0; } else { sign.position.set(front - side * 0.03, 3.2, z - w / 2); sign.rotation.y = -side * Math.PI / 2; }
        s.add(sign);
        if (night && li < 5 && r() < 0.5) { const P = new THREE.PointLight(warm ? 0xffb066 : 0xcfe2ff, 14, 9, 1.8); P.position.set(front - side * 1.2, 1.6, z - w / 2); s.add(P); li++; }
      }
      if (r() < 0.22) { const vm = vendingMachine(r); vm.position.set(front - side * 0.75, 0, z - w - 0.3 + 1.2); vm.rotation.y = -side * Math.PI / 2; s.add(vm);
        if (night && li < 7) { const P = new THREE.PointLight(0xe6f0ff, 10, 7, 1.8); P.position.set(front - side * 2, 2, z - w + 1); s.add(P); li++; } }
      z -= w + 0.15;
    }
  }
  const zs = []; for (let z = 30; z > -110; z -= 16) { zs.push(z); utilityPole(s, -4.3, z); if (night) lamp(s, 4.3, z - 8, 1, z > -50); }
  wires(s, [-4.2, -3.6, -4.8], zs, [9.15, 8.6]); wires(s, [-4.2], zs, [7.9]);
  // a few cross wires to the other side
  const m2 = new THREE.LineBasicMaterial({ color: 0x15171c });
  for (const z of zs) s.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-4.2, 8.6, z), new THREE.Vector3(0, 7.9, z - 1), new THREE.Vector3(4.6, 7.2, z - 2)]), m2));
  if (spec.rain ?? night) { const rain = makeRain(r, [-14, 14, -70, 30], 30, 5000); s.add(rain); s.userData.rain = rain; }
  s.userData.people = [];
  people(s, [-3.2, 3.2, -70, 4]);
  // heroes: walk away from the camera down the middle of the street (the "follow" shot)
  const heroes = [];
  for (let i = 0; i < (spec.heroes ?? 2); i++) { const h = voxelPerson(r, { umbrella: i === 0 && (spec.rain ?? night), umbrellaX: 0.5 }); h.position.set(-0.45 + i * 0.95, 0, 6); h.rotation.y = Math.PI; s.add(h); heroes.push(h); }
  s.userData.heroes = heroes;
  s.userData.animHeroes = (t) => { const z = 6 - t * (spec.hero_speed ?? 0.9);
    heroes.forEach((h, i) => { h.position.z = z + i * 0.15; h.position.y = Math.abs(Math.sin(t * 6.3 + i)) * 0.04; animateLimbs(h, t * 0.9 + i * 0.4, true, 0.9); }); return z; };
  s.userData.cam = (t, mode) => {
    if (mode === "high") return [new THREE.Vector3(0, 24, 30 - t * 0.6), new THREE.Vector3(0, 0, -20 - t * 0.6)];
    if (mode === "low") return [new THREE.Vector3(1.6, 1.0, 18 - t * 0.5), new THREE.Vector3(-0.5, 2.6, -10 - t * 0.5)];
    if (mode === "side") return [new THREE.Vector3(3.4, 3.2, 16 - t * 0.5), new THREE.Vector3(-1.5, 2.4, 2 - t * 0.5)];
    // "follow": behind and above the heroes, slowly closing in (like a film shot)
    const hz = 6 - t * (spec.hero_speed ?? 0.9);
    if (mode === "front") return [new THREE.Vector3(0.8, 3.0, hz - 15 + t * 0.2), new THREE.Vector3(0, 2.4, hz)];
    return [new THREE.Vector3(1.8, 12 - t * 0.15, hz + 17 - t * 0.25), new THREE.Vector3(0, 1.2, hz - 3)];
  };
  return s;
}

// ---------- post-processing: bloom + grade + vignette + grain ----------
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.9 }, uGrain: { value: 0.05 }, uTint: { value: new THREE.Vector3(0.96, 1.0, 1.08) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uVig, uGrain; uniform vec3 uTint; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime*7.13) * 43758.5453); }
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec3 col = c.rgb * uTint;
      float l = dot(col, vec3(0.299,0.587,0.114)); col = mix(vec3(l), col, 1.08);
      vec2 d = vUv - 0.5; d.x *= 0.62; col *= mix(1.0, smoothstep(0.85, 0.2, length(d)), uVig);
      col += (h(vUv*1000.0) - 0.5) * uGrain; gl_FragColor = vec4(col, c.a); }`,
};
export function makePost(renderer, W, H) {
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 }));
  composer.setSize(W, H);
  const rp = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  const bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.75, 0.55, 0.82);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(rp); composer.addPass(bloom); composer.addPass(new OutputPass()); composer.addPass(grade);
  return {
    render(scene, camera, t, look = {}) {
      rp.scene = scene; rp.camera = camera;
      bloom.strength = look.bloom ?? 0.75; bloom.threshold = look.threshold ?? 0.82; grade.uniforms.uTime.value = t; grade.uniforms.uVig.value = look.vignette ?? 0.9;
      grade.uniforms.uGrain.value = look.grain ?? 0.045; composer.render();
    },
  };
}

// ---------- shared scenery for the older scenes ----------
export { facadeTex, lamp, utilityPole, wires };
export const SKY = {
  day: [0x3d7cc9, 0xc4dcef], sunset: [0x2f3a68, 0xf3a372], night: [0x04070e, 0x1c2742],
};
export function skyDome(top, horizon) {
  const m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, hor: { value: new THREE.Color(horizon) } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top, hor; varying vec3 vP; void main(){ float h = clamp(vP.y, 0.0, 1.0); gl_FragColor = vec4(mix(hor, top, pow(h, 0.55)), 1.0); }` });
  const d = new THREE.Mesh(new THREE.SphereGeometry(850, 24, 16), m); d.renderOrder = -1; d.frustumCulled = false; return d;
}
// smooth (non-pixel) noisy ground texture, tiled
export function groundTex(base, r, repeat = 20, amt = 0.18, specks = null) {
  const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
  for (let y = 0; y < 128; y += 2) for (let x = 0; x < 128; x += 2) { g.fillStyle = shade(base, 1 - amt / 2 + r() * amt); g.fillRect(x, y, 2, 2); }
  if (specks) for (let i = 0; i < 120; i++) { g.fillStyle = specks; g.fillRect(r() * 128, r() * 128, 2, 2); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
export function pineTree(r) {
  const g = new THREE.Group(), trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 4.5, 6), S(0x5a4232));
  trunk.position.y = 2.25; trunk.rotation.z = (r() - 0.5) * 0.3; g.add(trunk);
  for (let i = 0; i < 3; i++) { const cl = new THREE.Mesh(new THREE.DodecahedronGeometry(1.1 + r() * 0.6, 0), S(pick(r, [0x2f5a3a, 0x355f3c, 0x2a4f34]), 0.9, { flatShading: true }));
    cl.scale.y = 0.45; cl.position.set((r() - 0.5) * 2, 3.6 + i * 0.9, (r() - 0.5) * 2); cl.castShadow = true; g.add(cl); }
  return g;
}
export function tetrapod() {
  const g = new THREE.Group(), m = S(0xa8a49c, 0.95, { flatShading: true });
  const dirs = [[0, 1, 0], [0.943, -0.333, 0], [-0.471, -0.333, 0.816], [-0.471, -0.333, -0.816]];
  for (const d of dirs) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.55, 1.6, 7), m);
    leg.position.set(d[0] * 0.75, d[1] * 0.75, d[2] * 0.75); leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...d)); leg.castShadow = true; g.add(leg); }
  return g;
}
export function cloud(r) {
  const g = new THREE.Group(), m = S(0xf4f6fa, 1, { flatShading: true, emissive: 0x7a8494, emissiveIntensity: 0.25 });
  for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.DodecahedronGeometry(6 + r() * 7, 0), m); b.position.set((r() - 0.5) * 30, (r() - 0.3) * 5, (r() - 0.5) * 12); b.scale.y = 0.6; g.add(b); }
  return g;
}
