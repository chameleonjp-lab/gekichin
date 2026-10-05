import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Euler,
  DynamicDrawUsage, FogExp2, Group, HemisphereLight, InstancedMesh, Line, LineBasicMaterial, Matrix4,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, PerspectiveCamera, PlaneGeometry,
  PointLight, Quaternion, RingGeometry, Scene, SphereGeometry, SRGBColorSpace, TorusGeometry, Vector3, WebGLRenderer,
  type BufferGeometry as ThreeBufferGeometry, type Material,
} from 'three';
import { AircraftFactory, type AircraftVisual } from './aircraft';
import { CollisionWorld } from './collision-world';
import type { AircraftToken, CombatEvent, Projectile } from './combat-types';
import { FLIGHT_FAR, FLIGHT_FOV, getFlightCameraPose } from './flight-view';
import { createMothershipLayout, type BoxSpec, type MothershipLayout, type TurretKind } from './mothership-layout';
import { Mothership, type TurretState } from './mothership';
import type { Aircraft, GameMode } from './types';

const PARTICLE_CAPACITY = 1024;
const DEBRIS_CAPACITY = 256;
const FRIENDLY_BULLET_CAPACITY = 256;
const ENEMY_MG_BULLET_CAPACITY = 256;
const ENEMY_MAIN_BULLET_CAPACITY = 16;
const TRACER_CAPACITY = FRIENDLY_BULLET_CAPACITY + ENEMY_MG_BULLET_CAPACITY + ENEMY_MAIN_BULLET_CAPACITY;
const WARNING_CAPACITY = 16;
const MAX_AIRCRAFT = 8;
const CAMERA_RADIUS = 1.5;
const CAMERA_MARGIN = 0.55;

/** Only the presentation-facing portion of the combat session is needed here. */
export interface SceneCombatState {
  operationId?: number;
  mothership?: Mothership;
  fleet?: { active: readonly AircraftToken[] };
  weapons?: { bullets: readonly Projectile[] };
  enemyCombat?: { bullets: readonly Projectile[]; warnings: readonly { turretId: number; kind: 'main' | 'mg'; origin: Vector3; direction: Vector3; startTick: number; fireTick: number }[] };
  events?: readonly CombatEvent[];
  collisionWorld?: CollisionWorld;
  world?: CollisionWorld;
}

type TurretPart = 'base' | 'head' | 'barrel' | 'wreck';
type ParticleKind = 'spark' | 'smoke';

interface Particle {
  active: boolean;
  kind: ParticleKind;
  position: Vector3;
  velocity: Vector3;
  bornFrame: number;
  lifeFrames: number;
  gravity: number;
  scale: number;
  seed: number;
}

interface Debris {
  active: boolean;
  position: Vector3;
  velocity: Vector3;
  bornFrame: number;
  lifeFrames: number;
  rotation: Quaternion;
  angularVelocity: Vector3;
  scale: Vector3;
}

interface TurretVisualCache {
  yaw: number;
  pitch: number;
  stage: number;
  initialized: boolean;
}

function setInstanceMatrix(mesh: InstancedMesh, slot: number, position: Vector3, rotation: Quaternion, scale: Vector3, matrix: Matrix4): void {
  matrix.compose(position, rotation, scale);
  mesh.setMatrixAt(slot, matrix);
}

function stableRandom(seed: number, lane: number): number {
  let value = (seed ^ Math.imul(lane + 1, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function stageFor(state: TurretState): number {
  if (state.hpMilli <= 0) return 3;
  if (state.hpMilli * 4 <= state.maxHpMilli) return 2;
  if (state.hpMilli * 2 <= state.maxHpMilli) return 1;
  return 0;
}

function partFromSpec(box: BoxSpec, label: string): { part: TurretPart; barrelIndex: number } {
  const suffix = box.id.slice(label.length + 1);
  if (suffix === 'wreck') return { part: 'wreck', barrelIndex: 0 };
  if (suffix === 'base') return { part: 'base', barrelIndex: 0 };
  if (suffix === 'head') return { part: 'head', barrelIndex: 0 };
  return { part: 'barrel', barrelIndex: suffix.endsWith('--1') ? 0 : 1 };
}

/**
 * P6 world view. The same fixed layout and turret boxes drive the meshes and
 * CollisionWorld; camera collision only changes the render camera position.
 */
export class FlightScene {
  readonly canvas: HTMLCanvasElement;
  readonly ready: Promise<void>;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FLIGHT_FOV, 1, 0.5, FLIGHT_FAR);
  private readonly factory = new AircraftFactory();
  private readonly aircraft: AircraftVisual[] = [];
  private readonly abort = new AbortController();
  private readonly observer: ResizeObserver;
  private readonly layout: MothershipLayout;
  private readonly previewMothership: Mothership;
  private currentMothership: Mothership;
  private previewCollision: CollisionWorld;
  private collisionWorld: CollisionWorld;
  private readonly ship = new Group();
  private bellyLight!: PointLight;
  private readonly boxGeometry = new BoxGeometry(1, 1, 1);
  private readonly planeGeometry = new PlaneGeometry(1, 1);
  private readonly turretMeshes = new Map<string, InstancedMesh>();
  private readonly turretSlots = new Map<number, number>();
  private readonly turretCache: TurretVisualCache[];
  private damagePatches!: InstancedMesh;
  private damageCores!: InstancedMesh;
  private damageSmoke!: InstancedMesh;
  private warningMainRings!: InstancedMesh;
  private warningMgRings!: InstancedMesh;
  private warningMainTips!: InstancedMesh;
  private warningMgTips!: InstancedMesh;
  private readonly warningLines: Line[] = [];
  private readonly warningLinePositions: BufferAttribute[] = [];
  private tracerMesh!: InstancedMesh;
  private readonly tracerMatrix = new Matrix4();
  private readonly particlePool: Particle[] = Array.from({ length: PARTICLE_CAPACITY }, () => ({
    active: false, kind: 'spark', position: new Vector3(), velocity: new Vector3(), bornFrame: 0,
    lifeFrames: 0, gravity: 0, scale: 1, seed: 0,
  }));
  private particleWrite = 0;
  private smokeMesh!: InstancedMesh;
  private sparkMesh!: InstancedMesh;
  private readonly debrisPool: Debris[] = Array.from({ length: DEBRIS_CAPACITY }, () => ({
    active: false, position: new Vector3(), velocity: new Vector3(), bornFrame: 0, lifeFrames: 0,
    rotation: new Quaternion(), angularVelocity: new Vector3(), scale: new Vector3(1, 1, 1),
  }));
  private debrisWrite = 0;
  private debrisMesh!: InstancedMesh;
  private readonly rotation = new Quaternion();
  private readonly position = new Vector3();
  private readonly matrix = new Matrix4();
  private readonly temporaryPosition = new Vector3();
  private readonly temporaryScale = new Vector3();
  private readonly temporaryQuaternion = new Quaternion();
  private readonly auxiliaryQuaternion = new Quaternion();
  private readonly temporaryEuler = new Euler();
  private readonly inverseShipQuaternion = new Quaternion();
  private readonly castFrom = new Vector3();
  private readonly castTo = new Vector3();
  private readonly collisionNormal = new Vector3();
  private readonly temporaryColor = new Color();
  private readonly unitY = new Vector3(0, 1, 0);
  private readonly reducedMotionQuery: MediaQueryList;
  private reducedMotion: boolean;
  private lastTick = 0;
  private lastOperationId: number | null = null;
  private lastEventSequence = 0;
  private lastSessionMothership: Mothership | null = null;
  private prewarmFailed = false;
  private disposed = false;
  private lost = false;

  constructor(private readonly container: HTMLElement, private readonly contextChanged: (available: boolean) => void) {
    this.layout = createMothershipLayout();
    this.previewMothership = new Mothership(this.layout);
    this.currentMothership = this.previewMothership;
    this.previewCollision = new CollisionWorld(this.previewMothership);
    this.collisionWorld = this.previewCollision;
    this.turretCache = this.layout.turrets.map(() => ({ yaw: Number.NaN, pitch: Number.NaN, stage: -1, initialized: false }));

    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.canvas = this.renderer.domElement;
    this.canvas.id = 'flight-canvas';
    this.canvas.setAttribute('aria-label', '航空機と六面の砲台を持つ超大型母艦の戦闘画面');
    this.canvas.setAttribute('role', 'img');
    container.append(this.canvas);

    this.scene.background = new Color(0x1c3345);
    this.scene.fog = new FogExp2(0x355163, 0.000037);
    this.scene.add(new HemisphereLight(0xd3e7f1, 0x273947, 1.9));
    const sun = new DirectionalLight(0xffe8cc, 2.8);
    sun.position.set(-1400, 2800, 1500);
    this.scene.add(sun);
    const hullFill = new DirectionalLight(0x78bcd2, 1.15);
    hullFill.position.set(0, -1500, -600);
    this.scene.add(hullFill);

    this.createHull();
    this.createTurretMeshes();
    this.createDamageVisuals();
    this.createWarningVisuals();
    this.createEffectPools();
    this.createTracerVisual();
    this.scene.add(this.ship);

    this.bellyLight = new PointLight(0x49cae4, 12, 900, 2);
    this.bellyLight.position.set(0, -121, 12);
    this.ship.add(this.bellyLight);

    for (let slot = 0; slot < MAX_AIRCRAFT; slot += 1) {
      const visual = this.factory.create('hero');
      visual.root.visible = false;
      visual.root.name = `player aircraft slot ${slot}`;
      this.aircraft.push(visual);
      this.scene.add(visual.root);
    }

    const sea = new Mesh(new PlaneGeometry(16000, 16000), new MeshStandardMaterial({ color: 0x294d61, metalness: 0.22, roughness: 0.7 }));
    sea.rotation.x = -Math.PI / 2;
    this.scene.add(sea);

    this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.reducedMotionQuery.matches;
    this.reducedMotionQuery.addEventListener('change', this.onReducedMotionChange, { signal: this.abort.signal });
    const signal = this.abort.signal;
    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); this.lost = true; this.contextChanged(false);
    }, { signal });
    this.canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.contextChanged(this.available); }, { signal });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    window.visualViewport?.addEventListener('resize', () => this.resize(), { signal });
    this.resize();
    this.applyTurrets(this.previewMothership.turrets);
    this.ready = this.prewarmMaterials().catch(error => {
      this.prewarmFailed = true;
      this.contextChanged(false);
      throw error;
    });
  }

  private async prewarmMaterials(): Promise<void> {
    const staging = this.scene.clone(true);
    staging.traverse(node => { node.visible = true; });
    try { await this.renderer.compileAsync(staging, this.camera); }
    finally { staging.clear(); }
  }

  private readonly onReducedMotionChange = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
  };

  get available(): boolean { return !this.lost && !this.prewarmFailed; }

  /** Read-only renderer and pool counters for inspection without changing play. */
  get diagnostics(): Readonly<{ geometries: number; textures: number; programs: number; drawCalls: number; particles: number; debris: number; wrecks: number }> {
    return Object.freeze({
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      programs: this.renderer.info.programs?.length ?? 0,
      drawCalls: this.renderer.info.render.calls,
      particles: this.particlePool.reduce((count, item) => count + Number(item.active), 0),
      debris: this.debrisPool.reduce((count, item) => count + Number(item.active), 0),
      wrecks: this.currentMothership.destroyedIds.size,
    });
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height));
    this.camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
    this.camera.updateProjectionMatrix();
  }

  private addHullBox(parent: Group, size: Vector3, position: Vector3, material: Material): Mesh {
    const mesh = new Mesh(this.boxGeometry, material);
    mesh.scale.copy(size);
    mesh.position.copy(position);
    parent.add(mesh);
    return mesh;
  }

  private addHullDecal(position: Vector3, scale: Vector3, rotation: Euler, material: Material): Mesh {
    const mesh = new Mesh(this.planeGeometry, material);
    mesh.position.copy(position);
    mesh.scale.copy(scale);
    mesh.rotation.copy(rotation);
    mesh.renderOrder = 1;
    this.ship.add(mesh);
    return mesh;
  }

  private createHull(): void {
    this.ship.position.copy(this.layout.center);
    const hull = new MeshStandardMaterial({ color: 0x3b4d5a, metalness: 0.42, roughness: 0.58 });
    const armor = new MeshStandardMaterial({ color: 0x667984, metalness: 0.4, roughness: 0.52 });
    const structure = new MeshStandardMaterial({ color: 0x536976, metalness: 0.36, roughness: 0.56 });
    const trim = new MeshStandardMaterial({ color: 0x243b48, metalness: 0.82, roughness: 0.38 });
    const glow = new MeshBasicMaterial({ color: 0x54d5ef, toneMapped: false });
    const warmLight = new MeshBasicMaterial({ color: 0xffc66f, toneMapped: false });
    for (const part of this.layout.hullParts) {
      const material = part.kind === 'structure' ? structure : part.id.includes('armor') ? armor : hull;
      const mesh = this.addHullBox(this.ship, part.halfSize.clone().multiplyScalar(2), part.center.clone().sub(this.layout.center), material);
      mesh.quaternion.copy(part.rotation);
      mesh.name = part.id;
    }

    // Armor seams, rails, and access panels add scale cues without changing
    // the shared hull collision boxes.
    for (const side of [-1, 1]) {
      for (let rib = 0; rib < 7; rib += 1) {
        this.addHullDecal(new Vector3(side * 300.025, -5, -410 + rib * 128), new Vector3(134, 3, 1),
          new Euler(0, side * Math.PI / 2, 0), trim);
      }
      this.addHullDecal(new Vector3(side * 300.025, 52, 0), new Vector3(220, 5, 1),
        new Euler(0, side * Math.PI / 2, 0), glow);
      for (let panel = 0; panel < 5; panel += 1) {
        this.addHullDecal(new Vector3(side * 300.025, -48, -330 + panel * 165), new Vector3(62, 9, 1),
          new Euler(0, side * Math.PI / 2, 0), structure);
      }
    }
    for (const z of [-482, -320, -160, 0, 160, 320, 482]) {
      this.addHullDecal(new Vector3(0, 120.025, z), new Vector3(330, 3, 1), new Euler(-Math.PI / 2, 0, 0), trim);
      this.addHullDecal(new Vector3(0, -120.025, z), new Vector3(330, 3, 1), new Euler(Math.PI / 2, 0, 0), trim);
    }
    this.addHullDecal(new Vector3(0, 120.03, -2), new Vector3(180, 5, 1), new Euler(-Math.PI / 2, 0, 0), glow);
    this.addHullDecal(new Vector3(0, -120.03, -2), new Vector3(180, 5, 1), new Euler(Math.PI / 2, 0, 0), glow);

    for (const bridgeZ of [-330, 0, 330]) {
      for (let window = 0; window < 5; window += 1) {
        this.addHullDecal(new Vector3(-27 + window * 13.5, 170.025, bridgeZ), new Vector3(11, 14, 1),
          new Euler(-Math.PI / 2, 0, 0), window === 2 ? warmLight : glow);
      }
    }

    // A flat emissive marking and point light give the belly a readable glow
    // without placing a collisionless solid over the bottom turret aim points.
    const bellyRing = new Mesh(new RingGeometry(84, 102, 48), new MeshBasicMaterial({
      color: 0x70e5f7, transparent: true, opacity: 0.92, depthWrite: false, toneMapped: false,
    }));
    bellyRing.rotation.x = Math.PI / 2;
    bellyRing.position.set(0, -120.025, 18);
    bellyRing.renderOrder = 2;
    this.ship.add(bellyRing);
  }

  private createTurretMeshes(): void {
    const materials: Record<string, Material> = {
      'main-base': new MeshStandardMaterial({ color: 0x727b7c, metalness: 0.58, roughness: 0.46 }),
      'main-head': new MeshStandardMaterial({ color: 0x99886a, metalness: 0.5, roughness: 0.45 }),
      'main-barrel': new MeshStandardMaterial({ color: 0x354550, metalness: 0.7, roughness: 0.36 }),
      'main-wreck': new MeshStandardMaterial({ color: 0x414a4d, metalness: 0.42, roughness: 0.73 }),
      'mg-base': new MeshStandardMaterial({ color: 0x59707b, metalness: 0.56, roughness: 0.47 }),
      'mg-head': new MeshStandardMaterial({ color: 0x81939a, metalness: 0.52, roughness: 0.44 }),
      'mg-barrel': new MeshStandardMaterial({ color: 0x293943, metalness: 0.72, roughness: 0.34 }),
      'mg-wreck': new MeshStandardMaterial({ color: 0x394347, metalness: 0.4, roughness: 0.76 }),
    };
    const count: Record<string, number> = {
      'main-base': 20, 'main-head': 20, 'main-barrel': 40, 'main-wreck': 20,
      'mg-base': 80, 'mg-head': 80, 'mg-barrel': 160, 'mg-wreck': 80,
    };
    for (const [key, capacity] of Object.entries(count)) {
      const mesh = new InstancedMesh(this.boxGeometry, materials[key], capacity);
      mesh.count = capacity;
      mesh.name = `canonical ${key} box instances`;
      // Slots start at a far-away zero-scale placeholder and move as turrets
      // rotate or become wrecks. A cached instance bound would otherwise keep
      // the later boxes culled at their original hidden location.
      mesh.frustumCulled = false;
      for (let slot = 0; slot < capacity; slot += 1) this.hideInstance(mesh, slot);
      this.turretMeshes.set(key, mesh);
      this.ship.add(mesh);
    }
    const byKind: Record<TurretKind, number> = { main: 0, mg: 0 };
    for (const turret of this.layout.turrets) this.turretSlots.set(turret.id, byKind[turret.kind]++);
  }

  private createDamageVisuals(): void {
    this.damagePatches = new InstancedMesh(this.boxGeometry,
      new MeshStandardMaterial({ color: 0x171d21, metalness: 0.55, roughness: 0.86 }), 100);
    this.damagePatches.name = 'visible damaged turret armor';
    this.damagePatches.frustumCulled = false;
    this.damageCores = new InstancedMesh(new OctahedronGeometry(1, 0),
      new MeshBasicMaterial({ color: 0xff9b50, depthTest: false, depthWrite: false, toneMapped: false }), 100);
    this.damageCores.name = 'exposed hot turret core';
    this.damageCores.frustumCulled = false;
    this.damageCores.renderOrder = 3;
    this.damageSmoke = new InstancedMesh(new ConeGeometry(0.5, 1, 6),
      new MeshBasicMaterial({ color: 0x849098, transparent: true, opacity: 0.68, depthWrite: false }), 100);
    this.damageSmoke.name = 'damage smoke silhouettes';
    this.damageSmoke.frustumCulled = false;
    for (let id = 0; id < 100; id += 1) {
      this.hideInstance(this.damagePatches, id); this.hideInstance(this.damageCores, id); this.hideInstance(this.damageSmoke, id);
    }
    this.ship.add(this.damagePatches, this.damageCores, this.damageSmoke);
  }

  private createWarningVisuals(): void {
    const mainRing = new MeshBasicMaterial({ color: 0xffce6a, toneMapped: false });
    const mgRing = new MeshBasicMaterial({ color: 0xf18e6e, toneMapped: false });
    const mainTip = new MeshBasicMaterial({ color: 0xffcf72, toneMapped: false });
    const mgTip = new MeshBasicMaterial({ color: 0xf17c67, toneMapped: false });
    this.warningMainRings = new InstancedMesh(new TorusGeometry(1, 0.12, 8, 28), mainRing, 4);
    this.warningMgRings = new InstancedMesh(new TorusGeometry(1, 0.1, 6, 18), mgRing, 12);
    this.warningMainTips = new InstancedMesh(new ConeGeometry(1, 2.2, 3), mainTip, 4);
    this.warningMgTips = new InstancedMesh(new ConeGeometry(1, 1.8, 3), mgTip, 12);
    this.warningMainRings.name = 'large main-gun warning rings';
    this.warningMgRings.name = 'machine-gun warning rings';
    this.warningMainTips.name = 'main-gun warning pointers';
    this.warningMgTips.name = 'machine-gun warning pointers';
    for (const mesh of [this.warningMainRings, this.warningMgRings, this.warningMainTips, this.warningMgTips]) {
      // Warning slots are also initialized off-world, then populated only
      // while the corresponding turret is actively aiming at a target.
      mesh.frustumCulled = false;
      for (let slot = 0; slot < mesh.instanceMatrix.count; slot += 1) this.hideInstance(mesh, slot);
      this.ship.add(mesh);
    }
    const mainLine = new LineBasicMaterial({ color: 0xffd27e, transparent: true, opacity: 0.72, depthWrite: false });
    const mgLine = new LineBasicMaterial({ color: 0xf58b70, transparent: true, opacity: 0.5, depthWrite: false });
    for (let index = 0; index < WARNING_CAPACITY; index += 1) {
      const geometry = new BufferGeometry();
      const positions = new BufferAttribute(new Float32Array(6), 3);
      positions.setUsage(DynamicDrawUsage);
      geometry.setAttribute('position', positions);
      geometry.setDrawRange(0, 0);
      const line = new Line(geometry, index < 4 ? mainLine : mgLine);
      line.name = `fixed warning aim line ${index}`;
      line.frustumCulled = false;
      this.warningLines.push(line);
      this.warningLinePositions.push(positions);
      this.ship.add(line);
    }
  }

  private createEffectPools(): void {
    const particleGeometry = new SphereGeometry(1, 7, 5);
    this.smokeMesh = new InstancedMesh(particleGeometry, new MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.34, depthWrite: false, toneMapped: false,
    }), PARTICLE_CAPACITY);
    this.sparkMesh = new InstancedMesh(particleGeometry, new MeshBasicMaterial({ vertexColors: true, toneMapped: false }), PARTICLE_CAPACITY);
    this.smokeMesh.name = 'bounded turret smoke pool';
    this.sparkMesh.name = 'bounded impact spark pool';
    this.smokeMesh.frustumCulled = false;
    this.sparkMesh.frustumCulled = false;
    this.scene.add(this.smokeMesh, this.sparkMesh);
    this.debrisMesh = new InstancedMesh(this.boxGeometry,
      new MeshStandardMaterial({ color: 0x46535a, metalness: 0.64, roughness: 0.63 }), DEBRIS_CAPACITY);
    this.debrisMesh.name = 'bounded turret debris pool';
    this.debrisMesh.frustumCulled = false;
    for (let slot = 0; slot < DEBRIS_CAPACITY; slot += 1) this.hideInstance(this.debrisMesh, slot);
    this.scene.add(this.debrisMesh);
  }

  private createTracerVisual(): void {
    const tracerGeometry = new CylinderGeometry(0.25, 0.25, 1, 5, 1);
    this.tracerMesh = new InstancedMesh(tracerGeometry, new MeshBasicMaterial({ vertexColors: true, toneMapped: false }), TRACER_CAPACITY);
    this.tracerMesh.name = 'bounded combat tracer pool';
    this.tracerMesh.frustumCulled = false;
    this.scene.add(this.tracerMesh);
  }

  private hideInstance(mesh: InstancedMesh, slot: number): void {
    this.matrix.compose(new Vector3(0, -100000, 0), new Quaternion(), new Vector3(0, 0, 0));
    mesh.setMatrixAt(slot, this.matrix);
  }

  private applyTurrets(states: readonly TurretState[]): void {
    for (const state of states) {
      const id = state.layout.id;
      const slot = this.turretSlots.get(id);
      const cache = this.turretCache[id];
      if (slot === undefined || !cache) continue;
      const stage = stageFor(state);
      if (cache.initialized && cache.yaw === state.yaw && cache.pitch === state.pitch && cache.stage === stage) continue;

      const kind = state.layout.kind;
      const prefix = kind === 'main' ? 'main' : 'mg';
      const partIndex = kind === 'main' ? slot : slot;
      for (const part of ['base', 'head', 'barrel', 'wreck'] as const) {
        const mesh = this.turretMeshes.get(`${prefix}-${part}`)!;
        const offsets = part === 'barrel' ? 2 : 1;
        for (let offset = 0; offset < offsets; offset += 1) {
          const index = partIndex * offsets + offset;
          this.hideInstance(mesh, index);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
      for (const box of state.boxes) {
        const resolved = partFromSpec(box, state.layout.label);
        const mesh = this.turretMeshes.get(`${prefix}-${resolved.part}`)!;
        const offsets = resolved.part === 'barrel' ? 2 : 1;
        const index = partIndex * offsets + resolved.barrelIndex;
        const localPosition = box.center.clone().sub(this.layout.center);
        setInstanceMatrix(mesh, index, localPosition, box.rotation,
          box.halfSize.clone().multiplyScalar(2), this.matrix);
        mesh.instanceMatrix.needsUpdate = true;
      }

      this.updateDamageStage(state, stage);
      cache.yaw = state.yaw;
      cache.pitch = state.pitch;
      cache.stage = stage;
      cache.initialized = true;
    }
  }

  private updateDamageStage(state: TurretState, stage: number): void {
    const definition = state.layout;
    if (stage < 1 || stage === 3) {
      this.hideInstance(this.damagePatches, definition.id);
      this.hideInstance(this.damageCores, definition.id);
      this.hideInstance(this.damageSmoke, definition.id);
    } else {
      const localAim = definition.aimPoint.clone().sub(this.layout.center);
      const orientation = new Quaternion().setFromRotationMatrix(this.matrix.makeBasis(
        definition.right, definition.normal, definition.tangent.clone().negate()));
      const headSurface = definition.kind === 'main' ? 8 : 5;
      const patchPosition = localAim.clone().addScaledVector(definition.normal, headSurface + 0.02);
      setInstanceMatrix(this.damagePatches, definition.id, patchPosition, orientation,
        new Vector3(stage === 1 ? 7 : 11, 0.035, stage === 1 ? 4 : 7), this.matrix);
      this.damagePatches.instanceMatrix.needsUpdate = true;
      if (stage === 2) {
        const corePosition = localAim.clone().addScaledVector(definition.normal, headSurface - 0.85);
        setInstanceMatrix(this.damageCores, definition.id, corePosition, orientation, new Vector3(0.8, 0.8, 0.8), this.matrix);
        this.temporaryPosition.copy(localAim).addScaledVector(definition.normal, 22);
        this.temporaryQuaternion.setFromUnitVectors(this.unitY, definition.normal);
        const plumeScale = new Vector3(9, 28, 9);
        setInstanceMatrix(this.damageSmoke, definition.id, this.temporaryPosition, this.temporaryQuaternion, plumeScale, this.matrix);
      } else {
        this.hideInstance(this.damageCores, definition.id);
        this.temporaryPosition.copy(localAim).addScaledVector(definition.normal, 14);
        this.temporaryQuaternion.setFromUnitVectors(this.unitY, definition.normal);
        setInstanceMatrix(this.damageSmoke, definition.id, this.temporaryPosition, this.temporaryQuaternion, new Vector3(3.5, 10, 3.5), this.matrix);
      }
      this.damageCores.instanceMatrix.needsUpdate = true;
      this.damageSmoke.instanceMatrix.needsUpdate = true;
    }
    this.damagePatches.instanceMatrix.needsUpdate = true;
    this.damageCores.instanceMatrix.needsUpdate = true;
    this.damageSmoke.instanceMatrix.needsUpdate = true;
    // stage 1 and stage 2 have different silhouettes in addition to the
    // smoke, exposed core, and changing turret geometry.
  }

  private updateAircraft(player: Aircraft, tick: number, session?: SceneCombatState): void {
    const active = session?.fleet?.active;
    if (!active) {
      for (let slot = 0; slot < this.aircraft.length; slot += 1) {
        const visual = this.aircraft[slot];
        visual.root.visible = slot === 0;
        if (slot !== 0) continue;
        this.updateAircraftVisual(visual, player, tick);
      }
      return;
    }
    for (const visual of this.aircraft) visual.root.visible = false;
    for (const token of active) {
      const visual = this.aircraft[token.slotId];
      if (!visual) continue;
      visual.root.visible = true;
      this.updateAircraftVisual(visual, token, tick);
    }
  }

  private updateAircraftVisual(visual: AircraftVisual, aircraft: Aircraft, tick: number): void {
    visual.root.position.copy(aircraft.position);
    visual.root.quaternion.copy(aircraft.quaternion);
    const tickDelta = tick >= this.lastTick ? tick - this.lastTick : 0;
    visual.propeller.rotation.z += tickDelta / 60 * 45;
    visual.ailerons[0].rotation.z = aircraft.bank * 0.22;
    visual.ailerons[1].rotation.z = -aircraft.bank * 0.22;
    visual.elevator.rotation.x = -aircraft.pitch * 0.08;
  }

  private updateWarningVisuals(tick: number, session?: SceneCombatState): void {
    const warnings = [...(session?.enemyCombat?.warnings ?? [])].sort((a, b) => Number(b.kind === 'main') - Number(a.kind === 'main'));
    let mainCount = 0, mgCount = 0, lineCount = 0;
    for (const warning of warnings) {
      const definition = this.layout.turrets[warning.turretId];
      if (!definition || lineCount >= WARNING_CAPACITY) continue;
      const main = warning.kind === 'main';
      const idSlot = main ? mainCount++ : mgCount++;
      const rings = main ? this.warningMainRings : this.warningMgRings;
      const tips = main ? this.warningMainTips : this.warningMgTips;
      const ringCapacity = main ? 4 : 12;
      if (idSlot >= ringCapacity) continue;

      const elapsed = Math.max(0, tick - warning.startTick);
      const phase = this.reducedMotion ? 0 : Math.sin(elapsed * 0.32) * 0.08;
      const normal = definition.normal;
      const ringScale = main ? 19 * (1 + phase) : 8.5 * (1 + phase);
      this.temporaryPosition.copy(warning.origin).sub(this.layout.center).addScaledVector(normal, main ? 14 : 8);
      this.temporaryQuaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal);
      setInstanceMatrix(rings, idSlot, this.temporaryPosition, this.temporaryQuaternion,
        new Vector3(ringScale, ringScale, ringScale), this.matrix);
      const tipPosition = warning.origin.clone().sub(this.layout.center).addScaledVector(normal, main ? 29 : 15);
      this.temporaryQuaternion.setFromUnitVectors(this.unitY, warning.direction);
      setInstanceMatrix(tips, idSlot, tipPosition, this.temporaryQuaternion,
        new Vector3(main ? 5 : 2.5, main ? 12 : 6, main ? 5 : 2.5), this.matrix);

      const line = this.warningLines[lineCount];
      const positions = this.warningLinePositions[lineCount];
      const endDistance = main ? 780 : 340;
      const end = warning.origin.clone().addScaledVector(warning.direction, endDistance).sub(this.layout.center);
      const start = warning.origin.clone().sub(this.layout.center);
      positions.setXYZ(0, start.x, start.y, start.z);
      positions.setXYZ(1, end.x, end.y, end.z);
      positions.needsUpdate = true;
      line.geometry.setDrawRange(0, 2);
      lineCount += 1;
    }
    for (let slot = mainCount; slot < 4; slot += 1) { this.hideInstance(this.warningMainRings, slot); this.hideInstance(this.warningMainTips, slot); }
    for (let slot = mgCount; slot < 12; slot += 1) { this.hideInstance(this.warningMgRings, slot); this.hideInstance(this.warningMgTips, slot); }
    for (let index = lineCount; index < WARNING_CAPACITY; index += 1) this.warningLines[index].geometry.setDrawRange(0, 0);
    for (const mesh of [this.warningMainRings, this.warningMgRings, this.warningMainTips, this.warningMgTips]) mesh.instanceMatrix.needsUpdate = true;
  }

  private updateTracerVisuals(session?: SceneCombatState): void {
    const friendly = session?.weapons?.bullets ?? [];
    const enemy = session?.enemyCombat?.bullets ?? [];
    let count = 0;
    const yAxis = this.unitY;
    for (const bullet of [...friendly, ...enemy]) {
      if (count >= TRACER_CAPACITY) break;
      this.temporaryQuaternion.setFromUnitVectors(yAxis, bullet.velocity.clone().normalize());
      const length = bullet.kind === 'main' ? 22 : bullet.kind === 'cannon' ? 12 : 7;
      this.temporaryScale.set(1, length, 1);
      this.tracerMatrix.compose(bullet.position, this.temporaryQuaternion, this.temporaryScale);
      this.tracerMesh.setMatrixAt(count, this.tracerMatrix);
      if (bullet.faction === 'enemy') this.temporaryColor.set(bullet.kind === 'main' ? 0xff6a3d : 0xf45157);
      else this.temporaryColor.set(bullet.kind === 'cannon' ? 0xffe8a0 : 0xffb653);
      this.tracerMesh.setColorAt(count, this.temporaryColor);
      count += 1;
    }
    this.tracerMesh.count = count;
    this.tracerMesh.instanceMatrix.needsUpdate = true;
    if (this.tracerMesh.instanceColor) this.tracerMesh.instanceColor.needsUpdate = true;
  }

  private consumeEvents(tick: number, session?: SceneCombatState): void {
    if (!session?.events) return;
    for (const event of session.events) {
      if (event.operationId !== (session.operationId ?? event.operationId) || event.sequence <= this.lastEventSequence) continue;
      this.lastEventSequence = Math.max(this.lastEventSequence, event.sequence);
      if (event.kind === 'hit' && event.point) {
        this.emitParticles(event.point, event.sequence, this.reducedMotion ? 2 : 5, 1, tick);
      } else if (event.kind === 'turret-destroyed' && event.point) {
        this.emitParticles(event.point, event.sequence, this.reducedMotion ? 5 : 10, this.reducedMotion ? 3 : 7, tick);
        this.emitDebris(event.point, event.sequence, this.reducedMotion ? 2 : 4, tick);
      } else if (event.kind === 'victory') {
        const epicenter = event.point ?? this.layout.center;
        this.emitParticles(epicenter, event.sequence, this.reducedMotion ? 10 : 22, this.reducedMotion ? 6 : 14, tick);
        this.emitDebris(epicenter, event.sequence, this.reducedMotion ? 5 : 12, tick);
      }
    }
  }

  private emitParticles(origin: Vector3, seed: number, sparks: number, smoke: number, tick: number): void {
    for (let index = 0; index < sparks + smoke; index += 1) {
      const particle = this.particlePool[this.particleWrite];
      this.particleWrite = (this.particleWrite + 1) % PARTICLE_CAPACITY;
      const isSpark = index < sparks;
      const lane = index + seed * 17;
      const x = stableRandom(seed, lane) * 2 - 1;
      const y = stableRandom(seed, lane + 1) * 2 - 1;
      const z = stableRandom(seed, lane + 2) * 2 - 1;
      particle.velocity.set(x, Math.abs(y) + 0.15, z).normalize();
      particle.active = true;
      particle.kind = isSpark ? 'spark' : 'smoke';
      particle.position.copy(origin);
      particle.velocity.multiplyScalar(isSpark ? 24 + stableRandom(seed, lane + 3) * 38 : 7 + stableRandom(seed, lane + 3) * 12);
      particle.bornFrame = tick;
      particle.lifeFrames = isSpark ? 22 + stableRandom(seed, lane + 4) * 18 : 90 + stableRandom(seed, lane + 4) * 100;
      particle.gravity = isSpark ? 12 : -1.5;
      particle.scale = isSpark ? 0.5 + stableRandom(seed, lane + 5) * 0.6 : 1.6 + stableRandom(seed, lane + 5) * 3.2;
      particle.seed = seed + index;
    }
  }

  private emitDebris(origin: Vector3, seed: number, count: number, tick: number): void {
    for (let index = 0; index < count; index += 1) {
      const debris = this.debrisPool[this.debrisWrite];
      this.debrisWrite = (this.debrisWrite + 1) % DEBRIS_CAPACITY;
      const lane = seed * 31 + index * 7;
      debris.active = true;
      debris.position.copy(origin);
      debris.velocity.set(stableRandom(seed, lane) * 2 - 1,
        0.3 + stableRandom(seed, lane + 1) * 1.5, stableRandom(seed, lane + 2) * 2 - 1).normalize()
        .multiplyScalar(13 + stableRandom(seed, lane + 3) * 28);
      debris.bornFrame = tick;
      debris.lifeFrames = 150 + stableRandom(seed, lane + 4) * 170;
      this.temporaryEuler.set(stableRandom(seed, lane + 5) * Math.PI, stableRandom(seed, lane + 6) * Math.PI,
        stableRandom(seed, lane + 7) * Math.PI, 'XYZ');
      debris.rotation.setFromEuler(this.temporaryEuler);
      debris.angularVelocity.set(stableRandom(seed, lane + 8) * 5, stableRandom(seed, lane + 9) * 5, stableRandom(seed, lane + 10) * 5);
      const scale = 1.6 + stableRandom(seed, lane + 11) * 3.5;
      debris.scale.set(scale * (0.7 + stableRandom(seed, lane + 12)), scale * (0.4 + stableRandom(seed, lane + 13)), scale);
    }
  }

  private updateParticles(renderFrame: number): void {
    let smokeCount = 0, sparkCount = 0;
    for (const particle of this.particlePool) {
      if (!particle.active) continue;
      const age = renderFrame - particle.bornFrame;
      if (age >= particle.lifeFrames || age < 0) { particle.active = false; continue; }
      const seconds = age / 60;
      this.temporaryPosition.copy(particle.position).addScaledVector(particle.velocity, seconds);
      this.temporaryPosition.y -= 0.5 * particle.gravity * seconds * seconds;
      const progress = age / particle.lifeFrames;
      const scale = particle.kind === 'smoke' ? particle.scale * (0.75 + progress * 1.7) : particle.scale * (1 - progress * 0.75);
      this.temporaryScale.setScalar(scale);
      this.temporaryQuaternion.setFromAxisAngle(this.unitY, stableRandom(particle.seed, 0) * Math.PI * 2);
      if (particle.kind === 'smoke') {
        setInstanceMatrix(this.smokeMesh, smokeCount, this.temporaryPosition, this.temporaryQuaternion, this.temporaryScale, this.matrix);
        this.temporaryColor.setRGB(0.28, 0.34, 0.37).multiplyScalar(1 - progress * 0.35);
        this.smokeMesh.setColorAt(smokeCount, this.temporaryColor);
        smokeCount += 1;
      } else {
        setInstanceMatrix(this.sparkMesh, sparkCount, this.temporaryPosition, this.temporaryQuaternion, this.temporaryScale, this.matrix);
        this.temporaryColor.setRGB(1, 0.47 + 0.4 * (1 - progress), 0.18);
        this.sparkMesh.setColorAt(sparkCount, this.temporaryColor);
        sparkCount += 1;
      }
    }
    this.smokeMesh.count = smokeCount;
    this.sparkMesh.count = sparkCount;
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    this.sparkMesh.instanceMatrix.needsUpdate = true;
    if (this.smokeMesh.instanceColor) this.smokeMesh.instanceColor.needsUpdate = true;
    if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true;

    let debrisCount = 0;
    for (const debris of this.debrisPool) {
      if (!debris.active) continue;
      const age = renderFrame - debris.bornFrame;
      if (age >= debris.lifeFrames || age < 0) { debris.active = false; continue; }
      const seconds = age / 60;
      this.temporaryPosition.copy(debris.position).addScaledVector(debris.velocity, seconds);
      this.temporaryPosition.y -= 4.9 * seconds * seconds;
      this.temporaryQuaternion.copy(debris.rotation);
      this.temporaryEuler.set(debris.angularVelocity.x * seconds, debris.angularVelocity.y * seconds,
        debris.angularVelocity.z * seconds, 'XYZ');
      this.auxiliaryQuaternion.setFromEuler(this.temporaryEuler);
      this.temporaryQuaternion.multiply(this.auxiliaryQuaternion);
      this.temporaryScale.copy(debris.scale);
      setInstanceMatrix(this.debrisMesh, debrisCount, this.temporaryPosition, this.temporaryQuaternion, this.temporaryScale, this.matrix);
      debrisCount += 1;
    }
    this.debrisMesh.count = debrisCount;
    this.debrisMesh.instanceMatrix.needsUpdate = true;
  }

  private setSinking(elapsedSeconds: number): void {
    const seconds = Math.max(0, Math.min(5, elapsedSeconds));
    const progress = seconds / 5;
    const eased = progress * progress * (3 - 2 * progress);
    const roll = this.reducedMotion ? 0 : Math.sin(seconds * 0.72) * 0.055 * progress;
    this.ship.position.set(this.layout.center.x, this.layout.center.y - 126 * eased, this.layout.center.z);
    this.ship.rotation.set(0.035 * progress + roll * 0.35, 0, 0.105 * progress + roll, 'XYZ');
    this.bellyLight.intensity = 12 * (1 - progress * 0.88);
  }

  private selectWorld(session?: SceneCombatState): CollisionWorld {
    const shared = session?.collisionWorld ?? session?.world;
    if (shared) return shared;
    const ship = session?.mothership;
    if (!ship) return this.previewCollision;
    if (this.lastSessionMothership !== ship) {
      this.lastSessionMothership = ship;
      this.collisionWorld = new CollisionWorld(ship);
    }
    return this.collisionWorld;
  }

  render(player: Aircraft, mode: GameMode, tick: number, session?: SceneCombatState, sinkingElapsedSeconds = 0): void {
    if (this.lost || this.prewarmFailed || this.disposed) return;
    if (session?.operationId !== undefined && session.operationId !== this.lastOperationId) {
      this.lastOperationId = session.operationId;
      this.lastEventSequence = 0;
      this.lastSessionMothership = null;
      for (const particle of this.particlePool) particle.active = false;
      for (const debris of this.debrisPool) debris.active = false;
      this.particleWrite = 0; this.debrisWrite = 0;
    }
    const turretStates = session?.mothership?.turrets ?? this.previewMothership.turrets;
    this.currentMothership = session?.mothership ?? this.previewMothership;
    this.applyTurrets(turretStates);
    this.consumeEvents(tick, session);
    this.updateAircraft(player, tick, session);
    this.updateWarningVisuals(tick, session);
    this.updateTracerVisuals(session);
    this.setSinking(sinkingElapsedSeconds);
    this.updateParticles(tick + Math.max(0, Math.min(5, sinkingElapsedSeconds)) * 60);
    this.lastTick = tick;

    getFlightCameraPose(player, mode, this.position, this.rotation);
    const world = this.selectWorld(session);
    const sinkSeconds = Math.max(0, Math.min(5, sinkingElapsedSeconds));
    const collisionFrom = player.position, collisionTo = this.position;
    if (sinkSeconds > 0) {
      this.inverseShipQuaternion.copy(this.ship.quaternion).invert();
      this.castFrom.copy(player.position).sub(this.ship.position).applyQuaternion(this.inverseShipQuaternion).add(this.layout.center);
      this.castTo.copy(this.position).sub(this.ship.position).applyQuaternion(this.inverseShipQuaternion).add(this.layout.center);
    }
    const hit = world.cameraCast(sinkSeconds > 0 ? this.castFrom : collisionFrom,
      sinkSeconds > 0 ? this.castTo : collisionTo, CAMERA_RADIUS);
    if (hit) {
      this.collisionNormal.copy(hit.normal);
      this.temporaryPosition.copy(hit.point);
      if (sinkSeconds > 0) {
        this.temporaryPosition.sub(this.layout.center).applyQuaternion(this.ship.quaternion).add(this.ship.position);
        this.collisionNormal.applyQuaternion(this.ship.quaternion);
      }
      if (sinkSeconds > 0) {
        this.position.copy(this.temporaryPosition).addScaledVector(this.collisionNormal, CAMERA_RADIUS + CAMERA_MARGIN);
      } else this.position.copy(this.temporaryPosition).addScaledVector(this.collisionNormal, CAMERA_RADIUS + CAMERA_MARGIN);
    }
    this.camera.position.copy(this.position);
    this.camera.quaternion.copy(this.rotation);
    this.renderer.render(this.scene, this.camera);
    this.writeDiagnostics();
  }

  private writeDiagnostics(): void {
    const stats = this.diagnostics;
    for (const [name, value] of Object.entries(stats)) {
      const key = `render${name[0].toUpperCase()}${name.slice(1)}`;
      if (this.canvas.dataset[key] !== String(value)) this.canvas.dataset[key] = String(value);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.observer.disconnect();
    for (const visual of this.aircraft) this.scene.remove(visual.root);
    this.factory.dispose();
    const geometries = new Set<ThreeBufferGeometry>();
    const materials = new Set<Material>();
    this.scene.traverse(node => {
      if (node instanceof Mesh || node instanceof Line) {
        geometries.add(node.geometry);
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
