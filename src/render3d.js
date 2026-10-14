// The 3D view, N64 style: a low-resolution frame scaled up, distance fog, per-district lighting
// and sky that blend as you cross from one district to the next, blob shadows, and simple
// additive effects for lights, slashes, shockwaves and the devastator.
import * as THREE from 'three';
import { HUD_H, HUD_W } from './config.js';
import { isBoss } from './enemies.js';
import { groundHeight } from './level.js';
import { BUILDERS, buildHero, poseHero } from './models.js';
import { ATTACKS } from './player.js';
import { createBlob, createGlow } from './textures.js';
import { buildWorld } from './world3d.js';

const RENDER_HEIGHT = 270; // vertical resolution of the 3D frame, before it's scaled up

// sky: zenith, horizon; fog; hemisphere light: sky, ground; sun: colour, strength; windows glow.
const THEMES = {
  dusk: { zenith: '#141446', horizon: '#e0704c', fog: '#5a3060', hemiSky: '#9a8ac0', hemiGround: '#3a2a3a', sun: '#ffd8b0', sunK: 0.9, windows: '#ffe08a', glow: 1, stars: 1, moon: '#fff4d6' },
  infected: { zenith: '#2a0810', horizon: '#d0482c', fog: '#5a1a1c', hemiSky: '#c07060', hemiGround: '#2a1010', sun: '#ff9070', sunK: 0.7, windows: '#ff9070', glow: 0.9, weather: 'rain' },
  military: { zenith: '#08202a', horizon: '#7aa070', fog: '#2a5048', hemiSky: '#8ac0b0', hemiGround: '#1a2a28', sun: '#e6fff0', sunK: 0.8, windows: '#9cffa0', glow: 1, stars: 1, moon: '#e6fff0', searchlights: true },
  hive: { zenith: '#28062e', horizon: '#d02c4c', fog: '#4a1040', hemiSky: '#c060a0', hemiGround: '#2a0a2a', sun: '#ff70a0', sunK: 0.7, windows: '#ff4a80', glow: 1, weather: 'embers' },
  arena: { zenith: '#200204', horizon: '#c02020', fog: '#4a0a0a', hemiSky: '#ff9090', hemiGround: '#401010', sun: '#ff8070', sunK: 0.9, windows: '#ff6060', glow: 0.8, moon: '#ff5a4a', weather: 'embers' },
  harbor: { zenith: '#061430', horizon: '#5a8aa8', fog: '#1c3a5a', hemiSky: '#9ac0e0', hemiGround: '#1a2430', sun: '#f0f6ff', sunK: 0.9, windows: '#ffd890', glow: 1, stars: 1, moon: '#f0f6ff' },
  toxic: { zenith: '#0a1a08', horizon: '#9aa830', fog: '#3a4a14', hemiSky: '#b0c070', hemiGround: '#1a2008', sun: '#e0ff90', sunK: 0.7, windows: '#d8ff60', glow: 1, weather: 'ash' },
  storm: { zenith: '#10141e', horizon: '#5a6474', fog: '#3a4250', hemiSky: '#9aa4b8', hemiGround: '#1a1e26', sun: '#d0e0ff', sunK: 0.6, windows: '#fff0c0', glow: 1, weather: 'rain', lightning: true },
  dawn: { zenith: '#4a3a6a', horizon: '#ffd08a', fog: '#c08a8a', hemiSky: '#ffe0d0', hemiGround: '#4a3040', sun: '#ffd8a0', sunK: 1.3, windows: '#fff0b0', glow: 0.4, searchlights: true },
  lair: { zenith: '#2a1206', horizon: '#c06018', fog: '#5a2a10', hemiSky: '#ffc080', hemiGround: '#4a2410', sun: '#ffc070', sunK: 1.3, windows: '#ffa040', glow: 0.9, moon: '#ffb050', weather: 'embers' },
};
const COLOR_KEYS = ['zenith', 'horizon', 'fog', 'hemiSky', 'hemiGround', 'sun', 'windows'];
const NUMBER_KEYS = ['sunK', 'glow', 'stars'];

/** The look at position x: the district's theme, blended with its neighbour near a border. */
function themeAt(level, x) {
  const ds = level.districts;
  let i = ds.findIndex((d) => x < d.x1);
  if (i === -1) i = ds.length - 1;
  const d = ds[i];
  const blendZone = 18;
  let other = null;
  let w = 0;
  if (x < d.x0 + blendZone && i > 0) {
    other = ds[i - 1];
    w = 0.5 - (x - d.x0) / (blendZone * 2);
  } else if (x > d.x1 - blendZone && i < ds.length - 1) {
    other = ds[i + 1];
    w = 0.5 - (d.x1 - x) / (blendZone * 2);
  }
  const a = THEMES[d.theme];
  const b = other ? THEMES[other.theme] : a;
  const out = { ...a };
  for (const k of COLOR_KEYS) out[k] = new THREE.Color(a[k]).lerp(new THREE.Color(b[k]), w);
  for (const k of NUMBER_KEYS) out[k] = (a[k] || 0) * (1 - w) + (b[k] || 0) * w;
  out.moonColor = a.moon ? new THREE.Color(a.moon) : null;
  return out;
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.2, 320);
  scene.fog = new THREE.Fog(0x000000, 40, 220);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1.4);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.position.set(-0.5, 1, 0.35);
  scene.add(hemi, sun);

  // Sky dome with a vertex-coloured gradient, following the camera.
  const skyGeo = new THREE.SphereGeometry(300, 24, 12);
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -2;
  scene.add(sky);

  const glowTex = createGlow();
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 400; i++) {
    const a = Math.random() * Math.PI * 2;
    const el = 0.15 + Math.random() * 1.3;
    starPos.push(Math.cos(a) * Math.cos(el) * 280, Math.sin(el) * 280, Math.sin(a) * Math.cos(el) * 280);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 1.4, sizeAttenuation: false, color: 0xffffff, fog: false, transparent: true, depthWrite: false }));
  stars.renderOrder = -1;
  scene.add(stars);

  const moon = new THREE.Group();
  const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(9, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
  const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, blending: THREE.AdditiveBlending, fog: false, depthWrite: false, opacity: 0.6 }));
  moonHalo.scale.set(70, 70, 1);
  moon.add(moonHalo, moonDisc);
  scene.add(moon);

  // Weather around the camera
  const RAIN = 600;
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(RAIN * 6), 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xa8b8e0, transparent: true, opacity: 0.45 }));
  rain.frustumCulled = false;
  scene.add(rain);
  const rainDrops = Array.from({ length: RAIN }, () => [Math.random() * 60 - 30, Math.random() * 30, Math.random() * 60 - 30]);
  const FLECKS = 400;
  const fleckGeo = new THREE.BufferGeometry();
  fleckGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(FLECKS * 3), 3));
  const flecks = new THREE.Points(fleckGeo, new THREE.PointsMaterial({ size: 0.25, color: 0xff7a30, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  flecks.frustumCulled = false;
  scene.add(flecks);
  const fleckSeeds = Array.from({ length: FLECKS }, () => [Math.random() * 60 - 30, Math.random() * 30, Math.random() * 60 - 30, Math.random()]);

  // Searchlights sweeping the sky in the military districts
  const beamGeo = new THREE.ConeGeometry(6, 120, 12, 1, true);
  beamGeo.translate(0, 60, 0);
  const beams = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xd8ffe0, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    scene.add(m);
    return m;
  });

  // Dynamic things
  const dynamic = new THREE.Group();
  scene.add(dynamic);
  const hero = buildHero();
  dynamic.add(hero.root);
  const models = new Map();

  const MAX_SHADOWS = 120;
  const shadows = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: createBlob(), transparent: true, depthWrite: false }),
    MAX_SHADOWS,
  );
  shadows.frustumCulled = false;
  dynamic.add(shadows);

  const MAX_PARTICLES = 900;
  const particles = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), MAX_PARTICLES);
  particles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
  particles.frustumCulled = false;
  dynamic.add(particles);

  const pools = new Map();
  const projectileFactories = {
    bullet: () => new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: 0xfff0a0 })),
    rocket: () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.2, 0.2), new THREE.MeshLambertMaterial({ color: 0xbcbcbc })));
      const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff8a30, blending: THREE.AdditiveBlending, depthWrite: false }));
      flame.scale.set(1.6, 1.6, 1);
      flame.position.x = -0.5;
      g.add(flame);
      return g;
    },
    acid: () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), new THREE.MeshBasicMaterial({ color: 0x58d854 })));
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x80ff40, blending: THREE.AdditiveBlending, depthWrite: false }));
      s.scale.set(1.8, 1.8, 1);
      g.add(s);
      return g;
    },
    rock: () => new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 0), new THREE.MeshLambertMaterial({ color: 0x6a665e, flatShading: true })),
    ring: () => {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 0.7, 48, 1, true).translate(0, 0.35, 0),
        new THREE.MeshBasicMaterial({ color: 0xff3050, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
      );
      return m;
    },
    spike: () => {
      const g = new THREE.Group();
      const warn = new THREE.Mesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff4020, transparent: true, opacity: 0.6, depthWrite: false }));
      warn.position.y = 0.04;
      warn.name = 'warn';
      g.add(warn);
      const spikes = new THREE.Group();
      spikes.name = 'spikes';
      const bone = new THREE.MeshLambertMaterial({ color: 0xd8d0c0 });
      for (const [x, z, h] of [[0, 0, 2.6], [0.5, 0.3, 1.8], [-0.45, 0.35, 2], [0.2, -0.5, 1.6], [-0.4, -0.4, 2.2]]) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.25, h, 5), bone);
        c.position.set(x, h / 2, z);
        spikes.add(c);
      }
      g.add(spikes);
      return g;
    },
  };
  const take = (kind) => {
    let pool = pools.get(kind);
    if (!pool) pools.set(kind, (pool = { items: [], used: 0 }));
    if (pool.used === pool.items.length) {
      const obj = projectileFactories[kind]();
      dynamic.add(obj);
      pool.items.push(obj);
    }
    const obj = pool.items[pool.used++];
    obj.visible = true;
    return obj;
  };

  // Slash trails and other effects
  const trailMat = new THREE.MeshBasicMaterial({ color: 0xffd0d8, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
  const trail = new THREE.Mesh(new THREE.RingGeometry(1.2, 3, 20, 1, -1.1, 2.2), trailMat);
  trail.visible = false;
  dynamic.add(trail);
  const devBurst = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xff2050, wireframe: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending }));
  devBurst.visible = false;
  dynamic.add(devBurst);
  const tendrilGeo = new THREE.BufferGeometry();
  tendrilGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 10 * 3), 3));
  const tendrils = new THREE.LineSegments(tendrilGeo, new THREE.LineBasicMaterial({ color: 0xff2050 }));
  tendrils.frustumCulled = false;
  dynamic.add(tendrils);

  let world = null;
  let worldSeed = null;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  function setLevel(level) {
    if (worldSeed === level.seed) return;
    if (world) scene.remove(world.group);
    world = buildWorld(level);
    worldSeed = level.seed;
    scene.add(world.group);
  }

  function applyTheme(theme, t, cam) {
    scene.fog.color.copy(theme.fog);
    renderer.setClearColor(theme.fog);
    // Sky gradient: horizon colour low, zenith overhead, a little fog colour at the bottom.
    const pos = skyGeo.attributes.position;
    const col = skyGeo.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 300;
      if (y > 0) color.copy(theme.horizon).lerp(theme.zenith, Math.min(1, Math.pow(y, 0.6)));
      else color.copy(theme.horizon).lerp(theme.fog, Math.min(1, -y * 4));
      col.setXYZ(i, color.r, color.g, color.b);
    }
    col.needsUpdate = true;
    sky.position.copy(cam);
    stars.position.copy(cam);
    stars.material.opacity = theme.stars * (0.6 + 0.4 * Math.sin(t / 50));
    stars.visible = theme.stars > 0.05;
    moon.visible = !!theme.moonColor;
    if (theme.moonColor) {
      moon.position.set(cam.x + 150, cam.y + 110, cam.z - 170);
      moon.lookAt(cam);
      moonDisc.material.color.copy(theme.moonColor);
      moonHalo.material.color.copy(theme.moonColor);
    }
    hemi.color.copy(theme.hemiSky);
    hemi.groundColor.copy(theme.hemiGround);
    sun.color.copy(theme.sun);
    let flash = 0;
    if (theme.lightning) {
      const k = t % 420;
      if (k < 4 || (k > 9 && k < 12)) flash = k < 4 ? 2 : 1.2;
    }
    hemi.intensity = 1.3 + flash;
    sun.intensity = theme.sunK;
    for (const m of world.windowMaterials) {
      m.emissive.copy(theme.windows);
      m.emissiveIntensity = theme.glow;
    }

    // Weather
    const W = theme.weather;
    rain.visible = W === 'rain';
    flecks.visible = W === 'embers' || W === 'ash';
    if (rain.visible) {
      const a = rainGeo.attributes.position;
      for (let i = 0; i < RAIN; i++) {
        const d = rainDrops[i];
        d[1] -= 0.9;
        if (d[1] < -2) d[1] += 32;
        const x = cam.x + d[0];
        const y = cam.y - 10 + d[1];
        const z = cam.z + d[2];
        a.setXYZ(i * 2, x, y, z);
        a.setXYZ(i * 2 + 1, x - 0.1, y - 0.7, z);
      }
      a.needsUpdate = true;
    }
    if (flecks.visible) {
      flecks.material.color.set(W === 'ash' ? '#c8c8b0' : '#ff7a30');
      flecks.material.blending = W === 'ash' ? THREE.NormalBlending : THREE.AdditiveBlending;
      const a = fleckGeo.attributes.position;
      for (let i = 0; i < FLECKS; i++) {
        const s = fleckSeeds[i];
        const rise = W === 'ash' ? -t * 0.03 * (0.5 + s[3]) : t * 0.04 * (0.5 + s[3]);
        const y = (((s[1] + rise) % 30) + 30) % 30;
        a.setXYZ(i, cam.x + s[0] + Math.sin(t / 40 + i) * 0.6, cam.y - 10 + y, cam.z + s[2]);
      }
      a.needsUpdate = true;
    }
    beams.forEach((b, i) => {
      b.visible = !!theme.searchlights;
      if (!b.visible) return;
      b.position.set(cam.x + 30 + i * 35, 0, (i % 2 ? 1 : -1) * 45);
      b.rotation.set(Math.sin(t / 90 + i * 2) * 0.5, 0, Math.cos(t / 110 + i) * 0.4);
    });
  }

  function placeShadow(i, level, e, scale) {
    if (i >= MAX_SHADOWS) return i;
    const gy = groundHeight(level, e.x, e.z, 0, e.y + 0.1);
    const fade = Math.max(0.2, 1 - (e.y - gy) / 12);
    dummy.position.set(e.x, gy + 0.03, e.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(scale * fade, 1, scale * fade);
    dummy.updateMatrix();
    shadows.setMatrixAt(i, dummy.matrix);
    return i + 1;
  }

  function flashModel(m, on, strength = 0.55) {
    for (const mat of m.materials) {
      if (on) mat.emissive.setRGB(strength, strength, strength);
      else if (mat.userData.glow) mat.emissive.copy(mat.userData.glow);
      else mat.emissive.setRGB(0, 0, 0);
    }
  }

  function updateCharacters(game, t) {
    const level = game.level;
    let s = 0;
    const p = game.player;
    hero.root.visible = p.alive;
    hero.root.position.set(p.x, p.y, p.z);
    hero.root.rotation.y = -p.yaw;
    poseHero(hero, p, t);
    flashModel(hero, p.hurt > 10);
    const blink = p.invuln > 0 && !p.consume && p.dev === 0 && p.dash === 0 && Math.floor(t / 3) % 2;
    if (blink && p.alive) hero.root.visible = false;
    if (p.alive) s = placeShadow(s, level, p, 1.2);

    const seen = new Set();
    for (const e of game.enemies) {
      if (e.dead && !(e === game.boss && game.bossDownT > 0)) continue;
      seen.add(e);
      let m = models.get(e);
      if (!m) {
        m = BUILDERS[e.type][0]();
        models.set(e, m);
        dynamic.add(m.root);
      }
      m.root.visible = !(e.dead && Math.floor(t / 3) % 2);
      m.root.position.set(e.x, e.y, e.z);
      m.root.rotation.y = -e.yaw;
      BUILDERS[e.type][1](m, e, t);
      const pulse = isBoss(e) && e.phase === 3 && Math.floor(t / 6) % 2 === 0;
      // A brief flash, softer on the big bosses, so rapid hits don't keep them white.
      flashModel(m, e.flash > 3 || pulse, isBoss(e) ? 0.25 : 0.55);
      if (e.type !== 'heli') s = placeShadow(s, level, e, e.r * 3);
    }
    for (const [e, m] of models) {
      if (!seen.has(e)) {
        dynamic.remove(m.root);
        models.delete(e);
      }
    }
    for (const pr of game.projectiles) if (pr.kind === 'rock') s = placeShadow(s, level, pr, 1.6 + Math.max(0, 1 - (pr.y - groundHeight(level, pr.x, pr.z)) / 20) * 1.4);
    shadows.count = s;
    shadows.instanceMatrix.needsUpdate = true;
  }

  function updateProjectiles(game, t) {
    for (const pool of pools.values()) {
      for (const obj of pool.items) obj.visible = false;
      pool.used = 0;
    }
    for (const pr of game.projectiles) {
      const obj = take(pr.kind);
      obj.position.set(pr.x, pr.y, pr.z);
      if (pr.kind === 'bullet' || pr.kind === 'rocket') {
        obj.lookAt(pr.x + pr.vx, pr.y + pr.vy, pr.z + pr.vz);
        obj.rotateY(-Math.PI / 2);
      } else if (pr.kind === 'rock') {
        obj.rotation.set(t * 0.1, t * 0.13, 0);
      } else if (pr.kind === 'ring') {
        obj.scale.set(pr.radius, 1, pr.radius);
        obj.material.opacity = Math.min(0.8, pr.life / 30);
      } else if (pr.kind === 'spike') {
        const warn = obj.getObjectByName('warn');
        const spikes = obj.getObjectByName('spikes');
        const erupted = pr.t >= pr.warn;
        warn.visible = !erupted;
        warn.scale.setScalar(pr.r);
        warn.material.opacity = Math.floor(t / 4) % 2 ? 0.7 : 0.3;
        spikes.visible = erupted;
        spikes.scale.set(pr.r, Math.min(1, (pr.t - pr.warn + 1) / 5), pr.r);
      }
    }
  }

  function updateParticles(game) {
    let n = 0;
    for (const pt of game.particles) {
      if (n >= MAX_PARTICLES) break;
      const life = Math.min(1, pt.life / 18);
      dummy.position.set(pt.x, pt.y, pt.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(pt.size * (0.5 + life * 0.5));
      dummy.updateMatrix();
      particles.setMatrixAt(n, dummy.matrix);
      particles.setColorAt(n, color.set(pt.color));
      n++;
    }
    particles.count = n;
    particles.instanceMatrix.needsUpdate = true;
    if (particles.instanceColor) particles.instanceColor.needsUpdate = true;
  }

  function updateEffects(game, t) {
    const p = game.player;
    // Slash trail for the blade and claws
    trail.visible = false;
    const atk = p.attack;
    if (atk && (atk.power === 'blade' || atk.power === 'claws')) {
      const def = ATTACKS[atk.power][atk.index];
      if (atk.t >= def.from && atk.t <= def.to + 3) {
        trail.visible = true;
        trailMat.opacity = atk.t > def.to ? 0.6 * (1 - (atk.t - def.to) / 4) : 0.6;
        trail.position.set(p.x, p.y + 1.2, p.z);
        const vertical = atk.power === 'claws' || atk.index === 1;
        trail.rotation.set(vertical ? 0 : -Math.PI / 2, -p.yaw, 0, 'YXZ');
        if (vertical) trail.rotation.set(0, -p.yaw, Math.PI / 2, 'YXZ');
        trailMat.color.set(atk.power === 'blade' ? '#ffd0d8' : '#ff4050');
      }
    }
    // Devastator burst
    devBurst.visible = p.dev > 0 && p.dev <= 22;
    if (devBurst.visible) {
      const k = (22 - p.dev) / 22;
      devBurst.position.set(p.x, p.y + 1, p.z);
      devBurst.scale.setScalar(1 + k * 13);
      devBurst.rotation.set(t * 0.05, t * 0.07, 0);
      devBurst.material.opacity = 0.9 * (1 - k);
    }
    // Consume tendrils: jagged lines from the hero to what he's grabbed
    tendrils.visible = !!p.consume;
    if (p.consume) {
      const tg = p.consume.target;
      const a = tendrilGeo.attributes.position;
      let i = 0;
      for (let line = 0; line < 3; line++) {
        let px = p.x;
        let py = p.y + 1.3;
        let pz = p.z;
        for (let k = 1; k <= 5; k++) {
          const f = k / 5;
          const nx = p.x + (tg.x - p.x) * f + (k < 5 ? Math.sin(t * 0.5 + line * 2 + k) * 0.3 : 0);
          const ny = p.y + 1.3 + (tg.y + tg.h * 0.6 - p.y - 1.3) * f + (k < 5 ? Math.cos(t * 0.4 + line + k) * 0.3 : 0);
          const nz = p.z + (tg.z - p.z) * f + (k < 5 ? Math.sin(t * 0.3 + line * 3 + k * 2) * 0.3 : 0);
          if (i < 30) {
            a.setXYZ(i++, px, py, pz);
            a.setXYZ(i++, nx, ny, nz);
          }
          px = nx;
          py = ny;
          pz = nz;
        }
      }
      a.needsUpdate = true;
      tendrilGeo.setDrawRange(0, i);
    }
  }

  return {
    camera,
    setLevel,
    resize(w, h) {
      const height = Math.min(RENDER_HEIGHT, h);
      const width = Math.round((w / h) * height);
      renderer.setSize(width, height, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    /** Draws a frame. view: { position, target } for the camera, in world space. */
    render(game, view, t) {
      setLevel(game.level);
      camera.position.set(view.position.x, view.position.y, view.position.z);
      camera.lookAt(view.target.x, view.target.y, view.target.z);
      if (game.shakeT > 0) {
        const s = Math.min(0.4, game.shakeT * 0.03);
        camera.position.x += (Math.random() - 0.5) * s;
        camera.position.y += (Math.random() - 0.5) * s;
      }
      for (const a of game.level.arenas) {
        const gate = world.gates.get(a.wall.id);
        if (gate) gate.visible = !a.wall.removed;
      }
      applyTheme(themeAt(game.level, game.player.x), t, camera.position);
      updateCharacters(game, t);
      updateProjectiles(game, t);
      updateParticles(game);
      updateEffects(game, t);
      renderer.render(scene, camera);
    },
    /** World point → HUD canvas coordinates, or null when behind the camera. */
    project(x, y, z) {
      const v = new THREE.Vector3(x, y, z).project(camera);
      if (v.z > 1 || v.z < -1) return null;
      return { x: ((v.x + 1) / 2) * HUD_W, y: ((1 - v.y) / 2) * HUD_H };
    },
  };
}
