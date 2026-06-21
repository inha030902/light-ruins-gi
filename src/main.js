import * as THREE from "https://unpkg.com/three@0.165.0/build/three.module.js";

const canvas = document.querySelector("#game");
const promptEl = document.querySelector("#prompt");
const objectiveEl = document.querySelector("#objective");
const viewModeEl = document.querySelector("#viewMode");
const dangerTextEl = document.querySelector("#dangerText");
const damageFlashEl = document.querySelector("#damageFlash");
const stageStatEl = document.querySelector("#stageStat");
const giStatEl = document.querySelector("#giStat");
const relicStatEl = document.querySelector("#relicStat");
const deathStatEl = document.querySelector("#deathStat");
const introEl = document.querySelector("#intro");
const endingEl = document.querySelector("#ending");
const startButton = document.querySelector("#startButton");
const restartButton = document.querySelector("#restartButton");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070a);
scene.fog = new THREE.FogExp2(0x05070a, 0.036);

const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 160);
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0);

const keys = new Set();
const interactables = [];
const roomObjects = [];
const probes = [];
const probeDebug = new THREE.Group();
const relics = [];
const pedestals = [];
const obstacles = [];
const hazards = [];
const bridgePlatforms = [];
const bridgeObjects = [];
const spawnPoint = new THREE.Vector3(0, 0.82, 2.75);
const bridgeCenterX = 13;
const bridgeStartPoint = new THREE.Vector3(bridgeCenterX, 0.82, 2.75);
const bridgeGatePoint = new THREE.Vector3(bridgeCenterX, 0.82, -6.75);
let giSwitch = null;
let bridgeVoid = null;
let bridgeGate = null;

const state = {
  yaw: 0,
  pitch: -0.08,
  thirdPerson: true,
  pointerLocked: false,
  draggingView: false,
  carrying: null,
  giEnabled: false,
  giSwitchUsed: false,
  probeVisible: false,
  completed: false,
  stage: 1,
  maxStage: 3,
  stageCleared: false,
  bridgeMode: false,
  activatedCount: 0,
  deaths: 0,
  respawnTimer: 0,
  velocityY: 0,
  grounded: true,
  hudHidden: false,
  guideText: "",
  guideTimer: 0,
};

const palette = {
  amber: new THREE.Color(0xffb11f),
  cyan: new THREE.Color(0x15d9ff),
  green: new THREE.Color(0x3cff5f),
  stone: new THREE.Color(0x6e706a),
  floor: new THREE.Color(0x3f453f),
};

const baseMaterials = [];

function makeMat(color, roughness = 0.82, metalness = 0.02) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    emissive: 0x000000,
    emissiveIntensity: 0,
  });
  baseMaterials.push({ mat, base: new THREE.Color(color), indirect: new THREE.Color(0, 0, 0) });
  return mat;
}

const floorMat = makeMat(0x3d423c);
const wallMat = makeMat(0x5e615c);
const trimMat = makeMat(0x272d31);
const goldMat = makeMat(0xb89347, 0.48, 0.15);
const runeMat = new THREE.MeshStandardMaterial({
  color: 0x0f1215,
  emissive: 0x000000,
  roughness: 0.55,
});

const player = new THREE.Group();
player.position.copy(spawnPoint);
scene.add(player);

const playerBody = createBlockAvatar();
playerBody.scale.setScalar(0.72);
player.add(playerBody);

const playerLamp = new THREE.PointLight(0xffddaa, 0.55, 5.5, 2);
playerLamp.position.set(0, 0.98, 0.16);
player.add(playerLamp);

function addBox(name, position, scale, material, cast = true, receive = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.name = name;
  mesh.position.copy(position);
  mesh.scale.copy(scale);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  scene.add(mesh);
  roomObjects.push(mesh);
  return mesh;
}

function addObstacle(name, position, scale) {
  const mesh = addBox(name, position, scale, trimMat);
  mesh.userData.collider = {
    minX: position.x - scale.x * 0.5,
    maxX: position.x + scale.x * 0.5,
    minZ: position.z - scale.z * 0.5,
    maxZ: position.z + scale.z * 0.5,
  };
  obstacles.push(mesh);
  return mesh;
}

function addHazard(name, position, scale, options = {}) {
  const hazardMat = new THREE.MeshStandardMaterial({
    color: options.color ?? 0xff275a,
    emissive: options.color ?? 0xff275a,
    emissiveIntensity: 2.4,
    roughness: 0.22,
  });
  const mesh = addBox(name, position, scale, hazardMat, false, false);
  mesh.userData.hazard = {
    base: position.clone(),
    scale: scale.clone(),
    axis: options.axis ?? "x",
    amplitude: options.amplitude ?? 0,
    speed: options.speed ?? 1,
    phase: options.phase ?? 0,
    minStage: options.minStage ?? 1,
  };
  hazards.push(mesh);

  const glow = new THREE.PointLight(options.color ?? 0xff275a, 2.2, 4.2, 2);
  glow.position.copy(position).add(new THREE.Vector3(0, 0.45, 0));
  mesh.userData.glow = glow;
  scene.add(glow);
  return mesh;
}

function makeGISwitch(position) {
  const group = new THREE.Group();
  group.position.copy(position);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.58, 0.42, 8), trimMat);
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const columnMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 0.45,
    transparent: true,
    opacity: 0.42,
    roughness: 0.18,
  });
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 2.2, 18), columnMat);
  column.position.y = 1.25;
  group.add(column);

  const orbMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 1.25,
    roughness: 0.25,
  });
  const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), orbMat);
  orb.position.y = 1.02;
  orb.castShadow = true;
  group.add(orb);

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.48, 0.025, 12, 40),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.28 })
  );
  halo.position.y = 1.03;
  halo.rotation.x = Math.PI / 2;
  group.add(halo);

  const pointer = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.42, 4),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.15, roughness: 0.25 })
  );
  pointer.position.y = 2.35;
  pointer.rotation.y = Math.PI / 4;
  group.add(pointer);

  const light = new THREE.PointLight(0xffffff, 4.2, 7.5, 2);
  light.position.y = 1.2;
  group.add(light);

  group.userData = { type: "giSwitch", label: "흰 별 기둥", orb, halo, pointer, column, light };
  scene.add(group);
  interactables.push(group);
  giSwitch = group;
  return group;
}

function buildBridgeCourse() {
  const voidMat = new THREE.MeshStandardMaterial({
    color: 0x020309,
    emissive: 0x030712,
    emissiveIntensity: 0.7,
    roughness: 0.95,
  });
  bridgeVoid = addBox("stage bridge void", new THREE.Vector3(bridgeCenterX, 0.012, -2.25), new THREE.Vector3(3.05, 0.035, 8.2), voidMat, false, false);
  bridgeObjects.push(bridgeVoid);

  const platformMat = new THREE.MeshStandardMaterial({
    color: 0xd6e4ff,
    emissive: 0x88d8ff,
    emissiveIntensity: 0.55,
    roughness: 0.34,
  });
  const platformData = [
    { x: -0.42, z: 1.2, w: 1.05, d: 0.72 },
    { x: 0.48, z: -0.35, w: 0.98, d: 0.72 },
    { x: -0.5, z: -1.9, w: 0.94, d: 0.68 },
    { x: 0.58, z: -3.45, w: 0.9, d: 0.66 },
    { x: -0.5, z: -5.0, w: 0.88, d: 0.64 },
    { x: 0, z: -6.45, w: 1.35, d: 0.72 },
  ];
  platformData.forEach((data, index) => {
    const platform = addBox(
      `stage bridge platform ${index + 1}`,
      new THREE.Vector3(bridgeCenterX + data.x, 0.16, data.z),
      new THREE.Vector3(data.w, 0.16, data.d),
      platformMat,
      true,
      true
    );
    platform.userData.platform = true;
    platform.userData.easy = {
      x: data.x,
      z: data.z,
      w: data.w,
      d: data.d,
    };
    platform.userData.hard = {
      x: [0.78, -0.78, 0.55, -0.7, 0.7, 0][index],
      z: [1.25, -0.12, -1.45, -2.82, -4.35, -6.45][index],
      w: [0.82, 0.74, 0.72, 0.66, 0.62, 1.05][index],
      d: [0.56, 0.52, 0.5, 0.48, 0.46, 0.62][index],
    };
    bridgePlatforms.push(platform);
    bridgeObjects.push(platform);
  });

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x28443f,
    emissive: 0x0a1c1e,
    emissiveIntensity: 0.32,
    roughness: 0.88,
  });
  const leftWall = addBox("bridge left wall", new THREE.Vector3(bridgeCenterX - 1.78, 1.05, -2.25), new THREE.Vector3(0.22, 2.1, 8.45), wallMat, false, true);
  const rightWall = addBox("bridge right wall", new THREE.Vector3(bridgeCenterX + 1.78, 1.05, -2.25), new THREE.Vector3(0.22, 2.1, 8.45), wallMat, false, true);
  const entryFrame = addBox("bridge entry frame", new THREE.Vector3(bridgeCenterX, 1.5, 2.22), new THREE.Vector3(3.6, 0.34, 0.22), wallMat, false, true);
  bridgeObjects.push(leftWall, rightWall, entryFrame);

  const gateMat = new THREE.MeshStandardMaterial({
    color: 0x7dff9f,
    emissive: 0x7dff9f,
    emissiveIntensity: 1.2,
    roughness: 0.28,
  });
  bridgeGate = addBox("stage bridge gate", bridgeGatePoint.clone().add(new THREE.Vector3(0, 0.26, 0)), new THREE.Vector3(1.5, 0.5, 0.16), gateMat, false, false);
  bridgeObjects.push(bridgeGate);
  setBridgeVisible(false);
}

function setBridgeVisible(visible) {
  for (const object of bridgeObjects) {
    object.visible = visible;
  }
}

function applyBridgeDifficulty() {
  const mode = state.stage >= 2 ? "hard" : "easy";
  for (const platform of bridgePlatforms) {
    const data = platform.userData[mode];
    platform.position.set(bridgeCenterX + data.x, 0.16, data.z);
    platform.scale.set(data.w, 0.16, data.d);
  }
  if (bridgeGate) {
    bridgeGate.scale.set(state.stage >= 2 ? 1.05 : 1.5, 0.5, 0.16);
  }
}

function createBlockAvatar() {
  const avatar = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xd2a074, roughness: 0.72 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x2d231b, roughness: 0.86 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0x355f3a, roughness: 0.68 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0xf0f0ed, roughness: 0.66 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x6f9fc8, roughness: 0.72 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.5 });

  const part = (name, size, pos, mat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
    mesh.name = name;
    mesh.position.copy(pos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    avatar.add(mesh);
    return mesh;
  };

  part("torso", new THREE.Vector3(0.42, 0.48, 0.22), new THREE.Vector3(0, 0.55, 0), shirt);
  part("head", new THREE.Vector3(0.28, 0.28, 0.28), new THREE.Vector3(0, 0.98, 0), skin);
  part("hair", new THREE.Vector3(0.3, 0.08, 0.3), new THREE.Vector3(0, 1.16, -0.01), hair);
  part("left arm", new THREE.Vector3(0.16, 0.46, 0.18), new THREE.Vector3(-0.32, 0.55, 0), sleeve);
  part("right arm", new THREE.Vector3(0.16, 0.46, 0.18), new THREE.Vector3(0.32, 0.55, 0), sleeve);
  part("left hand", new THREE.Vector3(0.15, 0.14, 0.16), new THREE.Vector3(-0.32, 0.24, 0), skin);
  part("right hand", new THREE.Vector3(0.15, 0.14, 0.16), new THREE.Vector3(0.32, 0.24, 0), skin);
  part("left leg", new THREE.Vector3(0.18, 0.46, 0.18), new THREE.Vector3(-0.12, 0.05, 0), pants);
  part("right leg", new THREE.Vector3(0.18, 0.46, 0.18), new THREE.Vector3(0.12, 0.05, 0), pants);
  part("left shoe", new THREE.Vector3(0.2, 0.08, 0.24), new THREE.Vector3(-0.12, -0.23, -0.03), shoe);
  part("right shoe", new THREE.Vector3(0.2, 0.08, 0.24), new THREE.Vector3(0.12, -0.23, -0.03), shoe);
  return avatar;
}

function buildRuins() {
  addBox("floor", new THREE.Vector3(0, -0.05, -3), new THREE.Vector3(9, 0.1, 14), floorMat, false);
  addBox("ceiling beam L", new THREE.Vector3(-3.7, 4.18, -3), new THREE.Vector3(0.32, 0.18, 14), trimMat, false);
  addBox("ceiling beam R", new THREE.Vector3(3.7, 4.18, -3), new THREE.Vector3(0.32, 0.18, 14), trimMat, false);
  addBox("ceiling beam back", new THREE.Vector3(0, 4.18, -8.4), new THREE.Vector3(8.5, 0.18, 0.32), trimMat, false);
  addBox("left wall", new THREE.Vector3(-4.55, 2, -3), new THREE.Vector3(0.22, 4.2, 14), wallMat, false);
  addBox("right wall", new THREE.Vector3(4.55, 2, -3), new THREE.Vector3(0.22, 4.2, 14), wallMat, false);
  addBox("back wall", new THREE.Vector3(0, 2, -10.05), new THREE.Vector3(9.2, 4.2, 0.22), wallMat, false);
  addBox("entry lintel", new THREE.Vector3(0, 4.05, 4.05), new THREE.Vector3(9.2, 0.52, 0.22), wallMat, false);
  addBox("room divider left", new THREE.Vector3(-2.9, 2, -1.8), new THREE.Vector3(0.28, 4.1, 2.4), wallMat, false);
  addBox("room divider right", new THREE.Vector3(2.9, 2, -1.8), new THREE.Vector3(0.28, 4.1, 2.4), wallMat, false);

  for (let z = 2.5; z > -9.4; z -= 3.2) {
    addBox("pillar L", new THREE.Vector3(-3.35, 1.1, z), new THREE.Vector3(0.54, 2.2, 0.54), trimMat);
    addBox("pillar R", new THREE.Vector3(3.35, 1.1, z), new THREE.Vector3(0.54, 2.2, 0.54), trimMat);
  }

  addObstacle("fallen stone", new THREE.Vector3(-1.25, 0.22, 1.25), new THREE.Vector3(1.35, 0.44, 0.36));
  addObstacle("broken plinth", new THREE.Vector3(1.35, 0.26, -2.25), new THREE.Vector3(0.42, 0.52, 1.45));
  addObstacle("low rubble", new THREE.Vector3(-1.6, 0.2, -5.25), new THREE.Vector3(1.05, 0.4, 0.52));
  addHazard("sweeping light trap A", new THREE.Vector3(0, 0.22, -0.65), new THREE.Vector3(2.1, 0.16, 0.16), {
    axis: "x",
    amplitude: 1.55,
    speed: 1.5,
    phase: 0.2,
    minStage: 1,
    color: 0xff2d68,
  });
  addHazard("sweeping light trap B", new THREE.Vector3(0, 0.28, -4.35), new THREE.Vector3(0.18, 0.18, 2.1), {
    axis: "x",
    amplitude: 1.7,
    speed: 1.25,
    phase: 1.9,
    minStage: 2,
    color: 0xff3b4f,
  });
  addHazard("sweeping light trap C", new THREE.Vector3(0, 0.25, -2.7), new THREE.Vector3(1.7, 0.15, 0.15), {
    axis: "z",
    amplitude: 0.95,
    speed: 1.8,
    phase: 0.8,
    minStage: 3,
    color: 0xff703d,
  });
  addHazard("sweeping light trap D", new THREE.Vector3(0, 0.32, -6.7), new THREE.Vector3(0.16, 0.18, 2.25), {
    axis: "x",
    amplitude: 2.15,
    speed: 1.45,
    phase: 2.7,
    minStage: 3,
    color: 0xff3b4f,
  });

  const altar = addBox("central altar", new THREE.Vector3(0, 0.28, -7.35), new THREE.Vector3(1.95, 0.56, 1.32), goldMat);
  altar.userData.isAltar = true;

  const runePositions = [
    [-3.95, 1.65, -4.6, Math.PI / 2, palette.amber],
    [3.95, 1.65, -5.5, -Math.PI / 2, palette.cyan],
    [0, 1.55, -9.9, 0, palette.green],
  ];
  for (const [x, y, z, rot, color] of runePositions) {
    const rune = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.72), runeMat.clone());
    rune.position.set(x, y, z);
    rune.rotation.y = rot;
    rune.userData.runeColor = color;
    scene.add(rune);
  }

  const moon = new THREE.DirectionalLight(0x89a8ff, 0.38);
  moon.position.set(-3, 8, 4);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  scene.add(moon);

  const ambient = new THREE.HemisphereLight(0x8ea3c6, 0x12100c, 0.18);
  scene.add(ambient);
}

function makePedestal(index, position, color, label) {
  const group = new THREE.Group();
  group.position.copy(position);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.68, 0.55, 8), goldMat);
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.43, 0.035, 10, 28),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.18, roughness: 0.35 })
  );
  ring.position.y = 0.32;
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  group.userData = { type: "pedestal", index, label, relic: null, color: new THREE.Color(color), ring, activated: false };
  scene.add(group);
  pedestals.push(group);
  interactables.push(group);
  return group;
}

function makeRelic(index, position, color, label) {
  const group = new THREE.Group();
  group.position.copy(position);

  const relicColor = new THREE.Color(color);
  const coreMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 2.15,
    roughness: 0.18,
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 2), coreMat);
  core.castShadow = true;
  group.add(core);
  const symbol = createRelicSymbol(index, relicColor);
  group.add(symbol);

  const cageMat = new THREE.MeshStandardMaterial({
    color: relicColor.clone().lerp(new THREE.Color(0xffffff), 0.18),
    emissive: color,
    emissiveIntensity: 0.55,
    roughness: 0.34,
    metalness: 0.2,
  });
  const cage = new THREE.Mesh(new THREE.TorusKnotGeometry(0.32, 0.02, 80, 8), cageMat);
  cage.castShadow = true;
  group.add(cage);

  const light = new THREE.PointLight(color, 4.8, 8.5, 2);
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  group.add(light);

  group.userData = {
    type: "relic",
    index,
    label,
    color: relicColor,
    placed: false,
    light,
    core,
    symbol,
    cage,
  };
  scene.add(group);
  relics.push(group);
  interactables.push(group);
  return group;
}

function createRelicSymbol(index, color) {
  const symbol = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 1.25,
    roughness: 0.26,
  });
  const brightMat = new THREE.MeshStandardMaterial({
    color: color.clone().lerp(new THREE.Color(0xffffff), 0.22),
    emissive: color,
    emissiveIntensity: 1.4,
    roughness: 0.22,
  });

  if (index === 0) {
    const disk = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 12), brightMat);
    disk.scale.set(1, 1, 0.45);
    symbol.add(disk);

    for (let i = 0; i < 12; i += 1) {
      const angle = (Math.PI * 2 * i) / 12;
      const ray = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.2, 4), mat);
      ray.position.set(Math.cos(angle) * 0.34, Math.sin(angle) * 0.34, 0);
      ray.rotation.z = angle - Math.PI / 2;
      symbol.add(ray);
    }
  } else if (index === 1) {
    const crescentShape = new THREE.Shape();
    crescentShape.absellipse(0, 0, 0.27, 0.34, Math.PI * 0.18, Math.PI * 1.82, false, 0);
    crescentShape.absellipse(0.13, 0, 0.23, 0.31, Math.PI * 1.72, Math.PI * 0.28, true, 0);
    const crescent = new THREE.Mesh(
      new THREE.ExtrudeGeometry(crescentShape, { depth: 0.055, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 }),
      brightMat
    );
    crescent.position.z = -0.03;
    crescent.rotation.z = -0.18;
    symbol.add(crescent);

    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.055, 0), mat);
    star.position.set(0.21, 0.24, 0.02);
    symbol.add(star);
  } else {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.035, 0.42, 10), mat);
    stem.position.y = -0.08;
    stem.rotation.z = -0.08;
    symbol.add(stem);

    const leafGeo = new THREE.SphereGeometry(0.14, 18, 10);
    const leafL = new THREE.Mesh(leafGeo, brightMat);
    leafL.scale.set(1.55, 0.58, 0.22);
    leafL.position.set(-0.12, 0.13, 0);
    leafL.rotation.z = 0.55;
    symbol.add(leafL);

    const leafR = new THREE.Mesh(leafGeo, brightMat);
    leafR.scale.set(1.55, 0.58, 0.22);
    leafR.position.x = 0.12;
    leafR.position.y = 0.13;
    leafR.rotation.z = -0.55;
    symbol.add(leafR);

    const bud = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), mat);
    bud.position.set(0, 0.3, 0);
    bud.scale.set(0.9, 1.2, 0.65);
    symbol.add(bud);
  }

  symbol.position.y = 0.02;
  symbol.position.z = 0.03;
  return symbol;
}

function buildPuzzle() {
  makePedestal(0, new THREE.Vector3(-2.1, 0.3, -7.55), 0xffb11f, "태양 받침대");
  makePedestal(1, new THREE.Vector3(0, 0.3, -7.55), 0x15d9ff, "달 받침대");
  makePedestal(2, new THREE.Vector3(2.1, 0.3, -7.55), 0x3cff5f, "새싹 받침대");

  makeRelic(0, new THREE.Vector3(-2.85, 0.72, 2.35), 0xffb11f, "태양 유물");
  makeRelic(1, new THREE.Vector3(2.75, 0.72, 0.15), 0x15d9ff, "달 유물");
  makeRelic(2, new THREE.Vector3(-0.15, 0.72, -3.2), 0x3cff5f, "새싹 유물");
  for (const relic of relics) {
    relic.userData.home = relic.position.clone();
  }

  makeGISwitch(new THREE.Vector3(0, 0.24, -5.95));

  const doorMat = new THREE.MeshStandardMaterial({ color: 0x15191d, roughness: 0.72, metalness: 0.12 });
  const door = addBox("sealed exit", new THREE.Vector3(0, 1.35, -9.91), new THREE.Vector3(2.15, 2.7, 0.18), doorMat);
  door.userData.isDoor = true;
  door.userData.closedY = door.position.y;
  scene.userData.door = door;
}

function buildProbes() {
  const probeGeo = new THREE.SphereGeometry(0.065, 8, 8);
  for (let x = -3; x <= 3; x += 1.5) {
    for (let y = 0.75; y <= 2.75; y += 1) {
      for (let z = 2.5; z >= -8.5; z -= 2.2) {
        const probe = {
          position: new THREE.Vector3(x, y, z),
          color: new THREE.Color(0, 0, 0),
          energy: 0,
        };
        probes.push(probe);
        const mesh = new THREE.Mesh(
          probeGeo,
          new THREE.MeshBasicMaterial({ color: 0x222222 })
        );
        mesh.position.copy(probe.position);
        probe.mesh = mesh;
        probeDebug.add(mesh);
      }
    }
  }
  probeDebug.visible = false;
  scene.add(probeDebug);
}

function updateGI() {
  const activeLights = relics.map((relic) => ({
    position: relic.position,
    color: relic.userData.color,
    power: relic.userData.placed ? 1.35 : 0.8,
  }));

  for (const probe of probes) {
    probe.color.setRGB(0.015, 0.018, 0.02);
    probe.energy = 0;
    for (const light of activeLights) {
      const d = probe.position.distanceTo(light.position);
      const bounce = Math.max(0, 1 - d / 7.2) ** 2 * light.power;
      const floorTint = probe.position.y < 1.15 ? 1.12 : 0.78;
      probe.color.add(light.color.clone().multiplyScalar(bounce * floorTint));
      probe.energy += bounce;
    }
    probe.color.multiplyScalar(state.giEnabled ? 0.28 : 0.03);
    probe.mesh.material.color.copy(probe.color).multiplyScalar(2.2);
  }

  for (const record of baseMaterials) {
    record.indirect.setRGB(0.012, 0.014, 0.016);
  }

  for (const object of roomObjects) {
    const nearest = nearestProbe(object.position);
    if (!nearest) continue;
    const matRecord = baseMaterials.find((record) => record.mat === object.material);
    if (matRecord) matRecord.indirect.add(nearest.color);
  }

  for (const record of baseMaterials) {
    const indirect = state.giEnabled ? record.indirect.clone().multiplyScalar(0.58) : new THREE.Color(0, 0, 0);
    record.mat.emissive.copy(indirect);
    record.mat.emissiveIntensity = state.giEnabled ? 1.0 : 0.12;
  }

  scene.traverse((obj) => {
    if (obj.material?.userData?.skipGI) return;
    if (obj.userData.runeColor) {
      const probe = nearestProbe(obj.position);
      const reveal = state.giEnabled ? Math.min(1, probe.energy * 0.9) : 0.12;
      obj.material.emissive.copy(obj.userData.runeColor).multiplyScalar(reveal);
      obj.material.emissiveIntensity = reveal * 1.4;
    }
  });

  for (const relic of relics) {
    const color = relic.userData.color;
    const visibleColor = state.giEnabled ? color : new THREE.Color(0xffffff);
    relic.userData.core.material.color.copy(visibleColor);
    relic.userData.core.material.emissive.copy(visibleColor);
    relic.userData.core.material.emissiveIntensity = state.giEnabled ? 1.4 : 1.05;
    relic.userData.symbol.traverse((part) => {
      if (!part.material) return;
      part.material.color.copy(visibleColor);
      part.material.emissive.copy(visibleColor);
      part.material.emissiveIntensity = state.giEnabled ? 1.25 : 0.55;
    });
    relic.userData.cage.material.color.copy(visibleColor).lerp(new THREE.Color(0xffffff), state.giEnabled ? 0.12 : 0.45);
    relic.userData.cage.material.emissive.copy(visibleColor);
    relic.userData.cage.material.emissiveIntensity = state.giEnabled ? 0.58 : 0.34;
    relic.userData.light.color.copy(visibleColor);
    relic.userData.light.intensity = relic.userData.placed ? (state.giEnabled ? 7.2 : 3.5) : (state.giEnabled ? 4.8 : 2.4);
  }

  for (const pedestal of pedestals) {
    const visibleColor = state.giEnabled ? pedestal.userData.color : new THREE.Color(0xffffff);
    pedestal.userData.ring.material.color.copy(visibleColor);
    pedestal.userData.ring.material.emissive.copy(visibleColor);
    pedestal.userData.ring.material.emissiveIntensity = state.giEnabled ? 0.38 : 0.12;
  }

  if (giSwitch) {
    const switchColor = state.giEnabled ? new THREE.Color(0x7dff9f) : new THREE.Color(0xffffff);
    giSwitch.userData.orb.material.color.copy(switchColor);
    giSwitch.userData.orb.material.emissive.copy(switchColor);
    giSwitch.userData.orb.material.emissiveIntensity = state.giEnabled ? 2.2 : 1.35;
    giSwitch.userData.halo.material.color.copy(switchColor);
    giSwitch.userData.halo.material.emissive.copy(switchColor);
    giSwitch.userData.halo.material.emissiveIntensity = state.giEnabled ? 1.4 : 0.95;
    giSwitch.userData.pointer.material.color.copy(switchColor);
    giSwitch.userData.pointer.material.emissive.copy(switchColor);
    giSwitch.userData.pointer.material.emissiveIntensity = state.giEnabled ? 1.8 : 1.2;
    giSwitch.userData.column.material.emissive.copy(switchColor);
    giSwitch.userData.column.material.emissiveIntensity = state.giEnabled ? 0.95 : 0.45;
    giSwitch.userData.light.color.copy(switchColor);
    giSwitch.userData.light.intensity = state.giEnabled ? 5.4 : 4.2;
  }
}

function nearestProbe(pos) {
  let best = null;
  let bestDistance = Infinity;
  for (const probe of probes) {
    const d = probe.position.distanceToSquared(pos);
    if (d < bestDistance) {
      bestDistance = d;
      best = probe;
    }
  }
  return best;
}

function interactionTarget() {
  raycaster.setFromCamera(center, camera);
  const hits = raycaster.intersectObjects(interactables, true);
  for (const hit of hits) {
    let root = hit.object;
    while (root.parent && !root.userData.type) root = root.parent;
    if (root.userData.type === "relic" && root.userData.placed) {
      const pedestal = pedestals.find((item) => item.userData.relic === root);
      if (pedestal && pedestal.position.distanceTo(player.position) < 2.35) return pedestal;
      continue;
    }
    if (root.userData.type && root.position.distanceTo(player.position) < 2.35) return root;
  }
  return nearbyInteractionTarget();
}

function nearbyInteractionTarget() {
  let best = null;
  let bestScore = Infinity;

  for (const relic of relics) {
    if (relic.userData.placed) continue;
    const d = relic.position.distanceTo(player.position);
    if (d < 1.85 && d < bestScore) {
      best = relic;
      bestScore = d;
    }
  }

  for (const pedestal of pedestals) {
    const d = pedestal.position.distanceTo(player.position);
    if (d < 1.55 && d + 0.2 < bestScore) {
      best = pedestal;
      bestScore = d + 0.2;
    }
  }

  if (giSwitch) {
    const d = giSwitch.position.distanceTo(player.position);
    if (d < 1.75 && d + 0.05 < bestScore) {
      best = giSwitch;
      bestScore = d + 0.05;
    }
  }

  return best;
}

function interact() {
  if (state.completed) return;
  const target = interactionTarget();

  if (state.carrying) {
    if (!state.giEnabled) {
      dropRelic();
      setGuide("아직 색을 알 수 없습니다. 먼저 안쪽의 흰 별 기둥을 켜세요.", 4);
      return;
    }

    const pedestal = target?.userData.type === "pedestal" ? target : nearestFreePedestal();
    if (pedestal && pedestal.position.distanceTo(player.position) < 2.4) {
      placeRelic(state.carrying, pedestal);
      state.carrying = null;
      return;
    }
    dropRelic();
    return;
  }

  if (target?.userData.type === "relic" && !target.userData.placed) {
    state.carrying = target;
    target.userData.light.intensity = 5.3;
    setGuide(`${relicLabel(target)} 운반 중입니다. 받침대 앞에서 E를 누르면 놓습니다.`, 3);
    return;
  }

  if (target?.userData.type === "giSwitch") {
    activateGISwitch();
    return;
  }

  if (target?.userData.type === "pedestal" && target.userData.relic) {
    const relic = target.userData.relic;
    target.userData.relic = null;
    target.userData.activated = false;
    relic.userData.placed = false;
    state.carrying = relic;
    relic.userData.light.intensity = 5.3;
    setGuide(`${relicLabel(relic)}을 다시 들었습니다. 알맞은 받침대로 옮기세요.`, 3);
    updatePuzzleState();
  }
}

function activateGISwitch() {
  if (state.giSwitchUsed) {
    setGuide("흰 별 기둥은 이미 켜졌습니다. 이제 유물 색에 맞는 받침대로 옮기세요.", 3);
    return;
  }
  state.giEnabled = true;
  state.giSwitchUsed = true;
  setGuide("GI 활성화! 이제 유물의 색을 보고 같은 색 받침대로 옮기세요.", 5);
  playTone(420, 0.08, "sine", 0.04);
  playTone(840, 0.18, "sine", 0.035, 0.08);
  updatePuzzleState();
  updateStats();
}

function relicLabel(relic) {
  return state.giEnabled ? relic.userData.label : "미확인 유물";
}

function nearestFreePedestal() {
  let best = null;
  let bestDistance = Infinity;
  for (const pedestal of pedestals) {
    if (pedestal.userData.relic) continue;
    const d = pedestal.position.distanceToSquared(player.position);
    if (d < bestDistance) {
      bestDistance = d;
      best = pedestal;
    }
  }
  return best;
}

function placeRelic(relic, pedestal) {
  if (pedestal.userData.relic) return;
  pedestal.userData.relic = relic;
  pedestal.userData.activated = relic.userData.index === pedestal.userData.index;
  relic.userData.placed = true;
  relic.position.copy(pedestal.position).add(new THREE.Vector3(0, 0.58, 0));
  relic.userData.light.intensity = pedestal.userData.activated ? 7.2 : 3.1;
  if (pedestal.userData.activated) {
    setGuide(`${relic.userData.label} 배치 성공! 남은 유물도 같은 방식으로 옮기세요.`, 3);
    playTone(620, 0.07, "triangle", 0.035);
    playTone(920, 0.08, "triangle", 0.03, 0.07);
  } else {
    setGuide("색이 맞지 않습니다. 유물을 다시 들고 같은 색 받침대로 옮기세요.", 4);
    dangerTextEl.textContent = "받침대 색이 맞지 않습니다";
    dangerTextEl.classList.remove("hidden");
    setTimeout(() => dangerTextEl.classList.add("hidden"), 650);
    playTone(210, 0.12, "square", 0.03);
  }
  updatePuzzleState();
  updateStats();
}

function dropRelic() {
  const forward = getViewForward();
  state.carrying.position.copy(player.position).add(forward.multiplyScalar(1.1));
  state.carrying.position.y = 0.72;
  state.carrying.userData.light.intensity = 4.4;
  state.carrying = null;
}

function updatePuzzleState() {
  state.activatedCount = pedestals.filter((p) => p.userData.activated).length;
  const prefix = `Stage ${state.stage}/${state.maxStage}`;

  if (state.bridgeMode) {
    objectiveEl.textContent = `${prefix} 클리어 - 통곡의 다리를 건너 다음 스테이지로 이동하세요`;
  } else if (!state.giEnabled) {
    objectiveEl.textContent = `${prefix} - 안쪽의 흰 별 기둥을 찾아 E로 GI를 켜세요`;
  } else if (state.activatedCount === 3 && state.stage < state.maxStage) {
    objectiveEl.textContent = `${prefix} 클리어 - 빛의 다리를 건너 다음 스테이지로 이동하세요`;
  } else {
    objectiveEl.textContent = `${prefix} - 유물 ${state.activatedCount}/3 - ${state.activatedCount === 3 ? "열린 문으로 나아가세요" : "유물 색에 맞는 받침대로 옮기세요"}`;
  }

  if (state.activatedCount === 3 && state.stage < state.maxStage && !state.stageCleared) {
    state.stageCleared = true;
    setGuide("유물 배치 완료! 앞쪽에 열린 문으로 들어가 통곡의 다리로 이동하세요.", 6);
    playTone(740, 0.08, "sine", 0.04);
    playTone(980, 0.12, "sine", 0.035, 0.08);
  } else if (state.activatedCount === 3 && state.stage === state.maxStage && !state.stageCleared) {
    state.stageCleared = true;
    setGuide("마지막 유물 배치 완료! 앞쪽에 열린 문으로 나가면 엔딩입니다.", 6);
    playTone(740, 0.08, "sine", 0.04);
    playTone(1040, 0.12, "sine", 0.035, 0.08);
  }

  const door = scene.userData.door;
  if (door) {
    door.userData.opening = state.stageCleared || (state.activatedCount === 3 && state.stage === state.maxStage);
  }
  updateStats();
}

function updateStats() {
  stageStatEl.textContent = `Stage ${state.stage}/${state.maxStage}`;
  giStatEl.textContent = state.giEnabled ? "GI ON" : "GI OFF";
  relicStatEl.textContent = state.bridgeMode ? "Bridge" : `Relics ${state.activatedCount}/3`;
  deathStatEl.textContent = `Deaths ${state.deaths}`;
}

function movePlayer(dt) {
  if (state.respawnTimer > 0) {
    updatePlayerVertical(dt);
    return;
  }
  const speed = keys.has("ShiftLeft") ? 4.8 : 3.2;
  const input = new THREE.Vector3(
    (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0),
    0,
    (keys.has("KeyS") ? 1 : 0) - (keys.has("KeyW") ? 1 : 0)
  );

  if (input.lengthSq() > 0) {
    input.normalize();
    const forward = getViewForward();
    const right = getViewRight();
    const delta = forward.multiplyScalar(-input.z).add(right.multiplyScalar(input.x));
    player.position.add(delta.multiplyScalar(speed * dt));
    constrainPlayer();
  }

  updatePlayerVertical(dt);

  player.rotation.y = state.yaw;
  if (state.carrying) {
    const hold = getViewForward().multiplyScalar(0.64);
    hold.y = 0.72;
    state.carrying.position.copy(player.position).add(hold);
    state.carrying.rotation.y += dt * 1.5;
  }
}

function jumpPlayer() {
  if (state.completed || state.respawnTimer > 0 || !state.grounded) return;
  state.velocityY = 4.15;
  state.grounded = false;
  playTone(520, 0.045, "triangle", 0.035);
}

function updatePlayerVertical(dt) {
  const groundY = currentGroundY();
  state.velocityY -= 10.5 * dt;
  player.position.y += state.velocityY * dt;

  if (groundY !== null && player.position.y <= groundY) {
    player.position.y = groundY;
    state.velocityY = 0;
    state.grounded = true;
  } else {
    state.grounded = false;
  }

  if (state.bridgeMode && player.position.y < -1.15) {
    failBridge();
  }
}

function currentGroundY() {
  if (state.bridgeMode) {
    if (isBridgeStartLedge() || isBridgeExitLedge()) return spawnPoint.y;
    const platform = bridgePlatforms.find((item) => {
      if (!item.visible) return false;
      return Math.abs(player.position.x - item.position.x) <= item.scale.x * 0.5 + 0.18
        && Math.abs(player.position.z - item.position.z) <= item.scale.z * 0.5 + 0.18
        && player.position.y >= spawnPoint.y - 0.36;
    });
    if (platform) return spawnPoint.y + platform.position.y - 0.16;
    if (isInBridgeCourse()) return null;
  }
  return spawnPoint.y;
}

function isBridgeStartLedge() {
  return Math.abs(player.position.x - bridgeCenterX) <= 1.55 && player.position.z > 1.82 && player.position.z < 3.1;
}

function isBridgeExitLedge() {
  return Math.abs(player.position.x - bridgeCenterX) <= 1.55 && player.position.z < -6.62 && player.position.z > -7.25;
}

function isInBridgeCourse() {
  return Math.abs(player.position.x - bridgeCenterX) <= 1.65 && player.position.z <= 1.82 && player.position.z >= -7.25;
}

function failBridge() {
  state.deaths += 1;
  state.respawnTimer = 0.45;
  dangerTextEl.textContent = `빛의 다리에서 떨어졌습니다 - 재시작 ${state.deaths}`;
  dangerTextEl.classList.remove("hidden");
  damageFlashEl.classList.add("active");
  setGuide("발판 밖으로 떨어졌습니다. 시작 발판에서 다시 점프해 건너세요.", 4);
  playTone(140, 0.22, "sawtooth", 0.04);
  resetBridgeAttempt();
  updateStats();
}

function getViewForward() {
  return new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw)).normalize();
}

function getViewRight() {
  const forward = getViewForward();
  return new THREE.Vector3(-forward.z, 0, forward.x).normalize();
}

function constrainPlayer() {
  const radius = 0.22;
  if (state.bridgeMode) {
    player.position.x = THREE.MathUtils.clamp(player.position.x, bridgeCenterX - 1.52, bridgeCenterX + 1.52);
    player.position.z = THREE.MathUtils.clamp(player.position.z, -7.18, 3.0);
    return;
  }

  player.position.x = THREE.MathUtils.clamp(player.position.x, -3.75, 3.75);
  player.position.z = THREE.MathUtils.clamp(player.position.z, -9.25, 3.25);

  for (const obstacle of obstacles) {
    const box = obstacle.userData.collider;
    const closestX = THREE.MathUtils.clamp(player.position.x, box.minX, box.maxX);
    const closestZ = THREE.MathUtils.clamp(player.position.z, box.minZ, box.maxZ);
    const dx = player.position.x - closestX;
    const dz = player.position.z - closestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq >= radius * radius) continue;
    if (distSq === 0) {
      const left = Math.abs(player.position.x - box.minX);
      const right = Math.abs(box.maxX - player.position.x);
      const front = Math.abs(player.position.z - box.minZ);
      const back = Math.abs(box.maxZ - player.position.z);
      const min = Math.min(left, right, front, back);
      if (min === left) player.position.x = box.minX - radius;
      else if (min === right) player.position.x = box.maxX + radius;
      else if (min === front) player.position.z = box.minZ - radius;
      else player.position.z = box.maxZ + radius;
      continue;
    }

    const dist = Math.sqrt(distSq);
    const push = radius - dist;
    player.position.x += (dx / dist) * push;
    player.position.z += (dz / dist) * push;
  }
}

function updateHazards(dt) {
  if (state.completed) return;
  for (const hazard of hazards) {
    const data = hazard.userData.hazard;
    const active = state.stage >= data.minStage && !state.bridgeMode;
    hazard.visible = active;
    hazard.userData.glow.visible = active;
    if (!active) continue;

    const stageSpeed = data.speed * (1 + (state.stage - 1) * 0.32);
    const stageAmplitude = data.amplitude * (1 + (state.stage - 1) * 0.08);
    const offset = Math.sin(clock.elapsedTime * stageSpeed + data.phase) * stageAmplitude;
    hazard.position.copy(data.base);
    hazard.position[data.axis] += offset;
    hazard.rotation.y = Math.sin(clock.elapsedTime * stageSpeed + data.phase) * 0.16;
    hazard.userData.glow.position.copy(hazard.position).add(new THREE.Vector3(0, 0.48, 0));

    if (state.respawnTimer <= 0 && touchesBox(hazard.position, data.scale, 0.24)) {
      triggerDeath();
    }
  }

  if (state.respawnTimer > 0) {
    state.respawnTimer -= dt;
    if (state.respawnTimer <= 0) {
      dangerTextEl.classList.add("hidden");
      damageFlashEl.classList.remove("active");
    }
  }
}

function updateStageProgress(dt) {
  if (!state.bridgeMode) return;
  if (player.position.distanceTo(bridgeGatePoint) < 0.85) {
    advanceStage();
  }
}

function startBridgeMode() {
  state.bridgeMode = true;
  applyBridgeDifficulty();
  setBridgeVisible(true);
  resetAllRelics();
  player.position.copy(bridgeStartPoint);
  state.yaw = 0;
  state.pitch = -0.08;
  state.velocityY = 0;
  state.grounded = true;
  dangerTextEl.textContent = `통곡의 다리 - Space로 발판을 건너세요`;
  dangerTextEl.classList.remove("hidden");
  damageFlashEl.classList.remove("active");
  setGuide(state.stage >= 2
    ? "더 어려운 통곡의 다리입니다. 좁은 발판만 밟고 끝까지 건너세요."
    : "통곡의 다리입니다. Space로 점프해 발판만 밟고 끝까지 건너세요.", 6);
  playTone(740, 0.08, "sine", 0.04);
  playTone(980, 0.12, "sine", 0.035, 0.08);
  updateStats();
}

function advanceStage() {
  state.stage += 1;
  state.stageCleared = false;
  state.bridgeMode = false;
  state.giEnabled = false;
  state.giSwitchUsed = false;
  setBridgeVisible(false);
  resetAllRelics();
  player.position.copy(spawnPoint);
  state.yaw = 0;
  state.pitch = -0.08;
  state.velocityY = 0;
  state.grounded = true;
  dangerTextEl.classList.add("hidden");
  damageFlashEl.classList.remove("active");
  setGuide(`Stage ${state.stage} 시작! 다시 붉은 함정을 피해 흰 별 기둥을 켜세요.`, 6);
  playTone(660, 0.09, "triangle", 0.04);
  playTone(990, 0.12, "triangle", 0.03, 0.08);
  updatePuzzleState();
}

function resetBridgeAttempt() {
  player.position.copy(bridgeStartPoint);
  state.velocityY = 0;
  state.grounded = true;
  damageFlashEl.classList.add("active");
  setTimeout(() => damageFlashEl.classList.remove("active"), 260);
}

function touchesBox(position, scale, radius) {
  const closestX = THREE.MathUtils.clamp(player.position.x, position.x - scale.x * 0.5, position.x + scale.x * 0.5);
  const closestZ = THREE.MathUtils.clamp(player.position.z, position.z - scale.z * 0.5, position.z + scale.z * 0.5);
  const dx = player.position.x - closestX;
  const dz = player.position.z - closestZ;
  return dx * dx + dz * dz < radius * radius;
}

function triggerDeath() {
  state.deaths += 1;
  state.respawnTimer = 0.9;
  dangerTextEl.textContent = `Stage ${state.stage} 실패 - 재시작 ${state.deaths}`;
  dangerTextEl.classList.remove("hidden");
  damageFlashEl.classList.add("active");
  setGuide("함정에 닿았습니다. 유물 배치가 초기화되었으니 다시 GI 장치부터 진행하세요.", 5);
  playTone(150, 0.16, "sawtooth", 0.045);

  resetAllRelics();
  state.giEnabled = false;
  state.giSwitchUsed = false;
  state.stageCleared = false;
  state.bridgeMode = false;
  setBridgeVisible(false);
  player.position.copy(spawnPoint);
  state.velocityY = 0;
  state.grounded = true;
  updatePuzzleState();
  updateStats();
}

function resetAllRelics() {
  state.carrying = null;
  for (const pedestal of pedestals) {
    pedestal.userData.relic = null;
    pedestal.userData.activated = false;
  }

  for (const relic of relics) {
    relic.userData.placed = false;
    relic.position.copy(relic.userData.home);
    relic.userData.light.intensity = state.giEnabled ? 4.8 : 2.4;
  }
  state.activatedCount = 0;
}

function updateCamera() {
  const lookTarget = player.position.clone().add(new THREE.Vector3(0, 0.72, 0));
  if (state.thirdPerson) {
    if (state.bridgeMode) {
      const back = getViewForward().multiplyScalar(-4.15);
      camera.position.copy(lookTarget).add(back);
      camera.position.y += 2.05;
      camera.position.x = THREE.MathUtils.clamp(camera.position.x, bridgeCenterX - 1.38, bridgeCenterX + 1.38);
      camera.position.z = THREE.MathUtils.clamp(camera.position.z, -7.05, 3.1);
      camera.lookAt(lookTarget.clone().add(new THREE.Vector3(0, 0.1, 0)));
      playerBody.visible = true;
      return;
    }

    const back = getViewForward().multiplyScalar(-2.65);
    camera.position.copy(lookTarget).add(back);
    camera.position.y += 0.92;
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -4.05, 4.05);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -9.6, 3.9);
    camera.lookAt(lookTarget);
    playerBody.visible = true;
  } else {
    camera.position.copy(player.position).add(new THREE.Vector3(0, 0.94, 0));
    camera.rotation.order = "YXZ";
    camera.rotation.y = state.yaw;
    camera.rotation.x = state.pitch;
    playerBody.visible = false;
  }
}

function updatePrompt() {
  if (state.guideTimer > 0) {
    promptEl.textContent = state.guideText;
    return;
  }

  if (state.bridgeMode) {
    promptEl.textContent = "Space로 점프해서 빛의 다리를 건너세요";
    return;
  }

  if (state.respawnTimer > 0) {
    promptEl.textContent = "빛 함정을 피해서 유물을 운반하세요";
    return;
  }

  if (state.completed) return;
  if (state.carrying) {
    promptEl.textContent = `${relicLabel(state.carrying)} 운반 중 - E로 놓기`;
    return;
  }
  const target = interactionTarget();
  if (target?.userData.type === "relic" && !target.userData.placed) {
    promptEl.textContent = `E: ${relicLabel(target)} 들기`;
  } else if (target?.userData.type === "giSwitch") {
    promptEl.textContent = state.giEnabled ? "흰 별 기둥 활성화됨" : "E: 흰 별 기둥 켜기";
  } else if (target?.userData.type === "pedestal") {
    promptEl.textContent = target.userData.relic ? `E: ${relicLabel(target.userData.relic)} 회수` : `${state.giEnabled ? target.userData.label : "미확인 받침대"}`;
  } else {
    promptEl.textContent = state.giEnabled
      ? "유물 색에 맞는 받침대로 옮기세요"
      : "붉은 함정을 지나 안쪽의 흰 별 기둥을 찾으세요";
  }
}

function updateDoor(dt) {
  const door = scene.userData.door;
  if (!door) return;
  if (door.userData.opening) {
    door.position.y = THREE.MathUtils.damp(door.position.y, 3.85, 1.8, dt);
    if (player.position.z < -9.0 && !state.completed) {
      if (state.stageCleared && state.stage < state.maxStage) {
        startBridgeMode();
      } else if (state.stage === state.maxStage && state.activatedCount === 3) {
        finishGame();
      }
    }
  } else {
    door.position.y = THREE.MathUtils.damp(door.position.y, door.userData.closedY, 3.2, dt);
  }
}

function finishGame() {
  state.completed = true;
  endingEl.classList.remove("hidden");
  promptEl.textContent = `유적 복원 완료 - 실패 ${state.deaths}회`;
  playTone(520, 0.12, "sine", 0.04);
  playTone(780, 0.14, "sine", 0.035, 0.1);
  playTone(1040, 0.2, "sine", 0.03, 0.22);
  document.exitPointerLock?.();
}

function resetGame() {
  location.reload();
}

function setGuide(text, duration = 4) {
  state.guideText = text;
  state.guideTimer = duration;
  promptEl.textContent = text;
}

function updateGuide(dt) {
  if (state.guideTimer <= 0) return;
  state.guideTimer = Math.max(0, state.guideTimer - dt);
}

function playTone(frequency, duration, type = "sine", gain = 0.03, delay = 0) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = playTone.context ?? new AudioContext();
  playTone.context = context;
  const start = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const volume = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  volume.gain.setValueAtTime(0.0001, start);
  volume.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(volume);
  volume.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.04);
  movePlayer(dt);
  updateHazards(dt);
  updateStageProgress(dt);
  updateGuide(dt);
  updateCamera();
  updateDoor(dt);
  for (const relic of relics) {
    relic.rotation.y += dt * 0.7;
    relic.children[0].position.y = Math.sin(clock.elapsedTime * 2 + relic.userData.index) * 0.04;
  }
  if (giSwitch) {
    giSwitch.userData.orb.rotation.y += dt * 1.4;
    giSwitch.userData.halo.rotation.z += dt * 1.8;
    giSwitch.userData.pointer.position.y = 2.35 + Math.sin(clock.elapsedTime * 3.2) * 0.12;
  }
  updateGI();
  updatePrompt();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function startGame() {
  introEl.classList.add("hidden");
  setGuide("먼저 붉은 함정을 피해 안쪽의 흰 별 기둥으로 가서 E를 누르세요.", 6);
  requestPointerLockSafely();
}

function requestPointerLockSafely() {
  const result = canvas.requestPointerLock?.();
  if (result?.catch) result.catch(() => {});
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (event.code === "Space") {
    event.preventDefault();
    jumpPlayer();
  }
  if (event.code === "KeyE") interact();
  if (event.code === "KeyV") {
    state.thirdPerson = !state.thirdPerson;
    viewModeEl.textContent = state.thirdPerson ? "3인칭" : "1인칭";
  }
  if (event.code === "KeyG") {
    promptEl.textContent = state.giEnabled ? "GI 활성화 상태" : "안쪽의 흰 별 기둥을 찾아야 합니다";
  }
  if (event.code === "KeyP") {
    state.probeVisible = !state.probeVisible;
    probeDebug.visible = state.probeVisible;
  }
  if (event.code === "KeyH") {
    state.hudHidden = !state.hudHidden;
    document.querySelector("#hud").classList.toggle("hud-hidden", state.hudHidden);
  }
});

window.addEventListener("keyup", (event) => keys.delete(event.code));

window.addEventListener("mousemove", (event) => {
  if (state.completed || !introEl.classList.contains("hidden")) return;
  state.yaw -= event.movementX * 0.0022;
  state.pitch = THREE.MathUtils.clamp(state.pitch - event.movementY * 0.002, -1.1, 0.75);
});

canvas.addEventListener("pointerdown", () => {
  state.draggingView = true;
  if (introEl.classList.contains("hidden") && !state.completed) requestPointerLockSafely();
});

window.addEventListener("pointerup", () => {
  state.draggingView = false;
});

document.addEventListener("pointerlockchange", () => {
  state.pointerLocked = Boolean(document.pointerLockElement);
});

startButton.addEventListener("click", startGame);
restartButton.addEventListener("click", resetGame);

buildRuins();
buildPuzzle();
buildBridgeCourse();
buildProbes();
updatePuzzleState();
updateStats();
animate();
