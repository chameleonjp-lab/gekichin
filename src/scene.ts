import {
  BoxGeometry, Color, CylinderGeometry, DirectionalLight, FogExp2, Group, HemisphereLight,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Quaternion,
  Scene, SRGBColorSpace, Vector3, WebGLRenderer, type BufferGeometry, type Material,
} from 'three';
import { AircraftFactory, type AircraftVisual } from './aircraft';
import { FLIGHT_FAR, FLIGHT_FOV, getFlightCameraPose } from './flight-view';
import { MOTHERSHIP_PREVIEW } from './rules';
import type { Aircraft, GameMode } from './types';

/** Decorative P1 placeholder, with no turrets, hitboxes, targets, or HP. */
function createMothership(): Group {
  const group = new Group();
  const hull = new MeshStandardMaterial({ color: 0x343e4a, metalness: 0.65, roughness: 0.66 });
  const panel = new MeshStandardMaterial({ color: 0x526474, metalness: 0.55, roughness: 0.58 });
  const glow = new MeshBasicMaterial({ color: 0x72deed });
  const box = (width: number, height: number, length: number, x: number, y: number, z: number, material: Material) => {
    const mesh = new Mesh(new BoxGeometry(width, height, length), material);
    mesh.position.set(x, y, z); group.add(mesh); return mesh;
  };
  box(380, MOTHERSHIP_PREVIEW.thickness, MOTHERSHIP_PREVIEW.length, 0, 0, 0, hull);
  for (const side of [-1, 1]) {
    box(110, 140, 960, side * 245, -8, -20, panel);
    box(65, 24, 420, side * 247, 80, 100, hull);
    box(14, 5, 740, side * 298, 10, 0, glow);
    for (let index = 0; index < 7; index += 1) box(16, 130, 6, side * 245, -8, -380 + index * 120, hull);
  }
  for (const z of [-350, 80, 360]) box(160, 58, 135, 0, 147, z, panel);
  const ring = new Mesh(new CylinderGeometry(68, 68, 6, 32), glow);
  ring.position.set(0, -123, 20); group.add(ring);
  group.position.y = MOTHERSHIP_PREVIEW.altitude;
  return group;
}

export class FlightScene {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FLIGHT_FOV, 1, 0.5, FLIGHT_FAR);
  private readonly factory: AircraftFactory;
  private readonly aircraft: AircraftVisual;
  private readonly abort = new AbortController();
  private readonly rotation = new Quaternion();
  private readonly position = new Vector3();
  private readonly observer: ResizeObserver;
  private lastTick = 0;
  private lost = false;

  constructor(private readonly container: HTMLElement, contextChanged: (available: boolean) => void) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.factory = new AircraftFactory();
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.canvas = this.renderer.domElement;
    this.canvas.id = 'flight-canvas';
    this.canvas.setAttribute('aria-label', '航空機と母艦の飛行確認画面');
    this.canvas.setAttribute('role', 'img');
    container.append(this.canvas);
    this.scene.background = new Color(0x162b3d);
    this.scene.fog = new FogExp2(0x243c4b, 0.000085);
    this.scene.add(new HemisphereLight(0xc7e5ee, 0x31404f, 2.3));
    const sun = new DirectionalLight(0xffe8c7, 2.6); sun.position.set(-1500, 3200, 900); this.scene.add(sun);
    this.scene.add(createMothership());
    const sea = new Mesh(new PlaneGeometry(16000, 16000), new MeshStandardMaterial({ color: 0x224557, metalness: 0.35, roughness: 0.64 }));
    sea.rotation.x = -Math.PI / 2; this.scene.add(sea);
    this.aircraft = this.factory.create('hero'); this.scene.add(this.aircraft.root);
    const signal = this.abort.signal;
    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); this.lost = true; contextChanged(false);
    }, { signal });
    this.canvas.addEventListener('webglcontextrestored', () => { this.lost = false; contextChanged(true); }, { signal });
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container);
    window.visualViewport?.addEventListener('resize', () => this.resize(), { signal });
    this.resize();
  }

  get available(): boolean { return !this.lost; }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height));
    this.camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
    this.camera.updateProjectionMatrix();
  }

  render(player: Aircraft, mode: GameMode, tick: number): void {
    if (this.lost) return;
    this.aircraft.root.position.copy(player.position);
    this.aircraft.root.quaternion.copy(player.quaternion);
    const tickDelta = tick >= this.lastTick ? tick - this.lastTick : 0;
    this.aircraft.propeller.rotation.z += tickDelta / 60 * 45;
    this.lastTick = tick;
    this.aircraft.ailerons[0].rotation.z = player.bank * 0.22;
    this.aircraft.ailerons[1].rotation.z = -player.bank * 0.22;
    this.aircraft.elevator.rotation.x = -player.pitch * 0.08;
    getFlightCameraPose(player, mode, this.position, this.rotation);
    this.camera.position.copy(this.position); this.camera.quaternion.copy(this.rotation);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.abort.abort(); this.observer.disconnect();
    this.scene.remove(this.aircraft.root);
    const geometries = new Set<BufferGeometry>(), materials = new Set<Material>();
    this.scene.traverse(node => {
      if (!(node instanceof Mesh)) return;
      geometries.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.factory.dispose();
    this.scene.clear(); this.renderer.dispose(); this.canvas.remove();
  }
}
