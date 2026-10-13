import { Matrix4, Quaternion, Vector3 } from 'three';

export type TurretKind = 'main' | 'mg';
export type MothershipFace = 'top' | 'bottom' | 'left' | 'right' | 'front' | 'rear';
export type TurretId = number;
export interface BoxSpec {
  id: string;
  kind: 'hull' | 'structure' | 'turret' | 'wreck';
  center: Vector3;
  halfSize: Vector3;
  rotation: Quaternion;
  turretId?: TurretId;
}
export interface TurretDefinition {
  id: TurretId;
  label: string;
  kind: TurretKind;
  face: MothershipFace;
  localPosition: Vector3;
  position: Vector3;
  aimPoint: Vector3;
  muzzle: Vector3;
  normal: Vector3;
  tangent: Vector3;
  right: Vector3;
  maxHpMilli: number;
  yawMin: number;
  yawMax: number;
  pitchMin: number;
  pitchMax: number;
  attackApproach: readonly [Vector3, Vector3];
  outwardWaypoint: Vector3;
}
export interface MothershipLayout {
  center: Vector3;
  hullParts: BoxSpec[];
  turrets: TurretDefinition[];
  outerWaypoints: Vector3[];
  /** Deterministic front corridor: index0 is the initial player. */
  spawnCandidates: Vector3[];
}

export const MOTHERSHIP_CENTER = new Vector3(0, 1000, 0);
export const MOTHERSHIP_LENGTH = 1200;
export const MOTHERSHIP_WIDTH = 600;
export const MOTHERSHIP_THICKNESS = 240;
export const AIRCRAFT_RADIUS = 5;
export const AIRCRAFT_SEPARATION = 30;
export const TURRET_TOTAL_HP_MILLI = 24_000_000;
export const FACE_NAMES: readonly MothershipFace[] = ['top', 'bottom', 'left', 'right', 'front', 'rear'];
const DEGREE = Math.PI / 180;

export function turretDirection(turret: TurretDefinition, yaw: number, pitch: number): Vector3 {
  return turret.tangent.clone().multiplyScalar(Math.cos(yaw) * Math.cos(pitch))
    .addScaledVector(turret.right, Math.sin(yaw) * Math.cos(pitch))
    .addScaledVector(turret.normal, Math.sin(pitch)).normalize();
}

export function turretBarrelRight(turret: TurretDefinition, yaw: number): Vector3 {
  return turret.right.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(turret.tangent, -Math.sin(yaw));
}

export function turretMuzzle(turret: TurretDefinition, yaw = 0, pitch = Math.PI / 4, side: -1 | 1 = 1): Vector3 {
  return turret.aimPoint.clone().addScaledVector(turretDirection(turret, yaw, pitch), turret.kind === 'main' ? 26 : 13)
    .addScaledVector(turretBarrelRight(turret, yaw), side * (turret.kind === 'main' ? 5 : 2));
}

/** These boxes are the visible meshes and authoritative contact/occlusion shapes. */
export function turretBoxes(turret: TurretDefinition, yaw = 0, pitch = Math.PI / 4, destroyed = false): BoxSpec[] {
  const main = turret.kind === 'main';
  const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(turret.right, turret.normal, turret.tangent.clone().negate()));
  const baseHalf = main ? 16 : 9;
  const part = (id: string, center: Vector3, halfSize: Vector3, orientation = rotation): BoxSpec => ({
    id: `${turret.label}-${id}`, kind: destroyed ? 'wreck' : 'turret', center, halfSize, rotation: orientation.clone(), turretId: turret.id,
  });
  if (destroyed) return [part('wreck', turret.position.clone().addScaledVector(turret.normal, 2), new Vector3(baseHalf, 2, baseHalf))];
  const base = part('base', turret.position.clone().addScaledVector(turret.normal, main ? 4 : 3), new Vector3(baseHalf, main ? 4 : 3, baseHalf));
  const head = part('head', turret.aimPoint.clone(), new Vector3(main ? 12 : 7, main ? 8 : 5, main ? 12 : 7));
  const direction = turretDirection(turret, yaw, pitch), length = main ? 26 : 13;
  const boreRotation = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), direction);
  const barrels = [-1, 1].map(side => part(`barrel-${side}`, turret.aimPoint.clone()
    .addScaledVector(turretBarrelRight(turret, yaw), side * (main ? 5 : 2)).addScaledVector(direction, length / 2),
  new Vector3(main ? 1.5 : .65, main ? 1.5 : .65, length / 2), boreRotation));
  return [base, head, ...barrels];
}

function hullBox(
  id: string,
  kind: BoxSpec['kind'],
  x: number,
  localY: number,
  z: number,
  width: number,
  height: number,
  length: number,
  rotation = new Quaternion(),
): BoxSpec {
  return {
    id, kind, center: new Vector3(x, 1000 + localY, z),
    halfSize: new Vector3(width / 2, height / 2, length / 2), rotation: rotation.clone(),
  };
}

export function createMothershipLayout(): MothershipLayout {
  const center = MOTHERSHIP_CENTER.clone();
  // A narrow keel carries the six turret faces. The paired end sections step
  // inward from the center block, while separate side armor wings flare out
  // and sweep back into the prow and stern as rotated, collidable armor.
  const wingTipHalfWidth = 30, wingTipHalfLength = 110, wingTipAngle = Math.PI / 4;
  const wingTipExtent = (wingTipHalfWidth + wingTipHalfLength) * Math.SQRT1_2;
  const wingTipCenterX = MOTHERSHIP_WIDTH / 2 - wingTipExtent;
  const wingTipCenterZ = MOTHERSHIP_LENGTH / 2 - wingTipExtent;
  const topBottomTurretRows = [-480, -240, 0, 240, 480] as const;
  const sideTurretRows = [-400, -200, 0, 200, 400] as const;
  const wingLinkRows = [-300, -100, 100, 300] as const;
  const hullParts = [
    hullBox('keel-spine', 'hull', 0, 0, 0, 240, 160, 1040),
    hullBox('bow-endcap', 'hull', 0, 0, 560, 340, 180, 80),
    hullBox('stern-endcap', 'hull', 0, 0, -560, 340, 180, 80),
    ...topBottomTurretRows.flatMap((z, row) => {
      const length = row === 2 ? 140 : 100;
      return [
        hullBox(`top-gun-deck-${row}`, 'hull', 0, 100, z, 340, 40, length),
        hullBox(`bottom-gun-deck-${row}`, 'hull', 0, -100, z, 340, 40, length),
      ];
    }),
    ...([-1, 1] as const).flatMap(side => sideTurretRows.map((z, row) =>
      hullBox(`side-pod-${side < 0 ? 'left' : 'right'}-${row}`, 'hull', side * 235, 0, z, 130, 160, 120))),
    ...([-1, 1] as const).flatMap(side => wingLinkRows.map((z, row) => {
      // Each oblique bridge overlaps its neighboring pod ends and reaches back
      // into the keel, keeping the scalloped wing one continuous solid shell.
      const angle = -side * Math.sign(z) * Math.PI / 10;
      return hullBox(`side-link-${side < 0 ? 'left' : 'right'}-${row}`, 'hull', side * 181, 0, z,
        140, 100, 80, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle));
    })),
    ...([-1, 1] as const).flatMap(side => ([-1, 1] as const).map(end => {
      const angle = -side * end * wingTipAngle;
      const centerX = side * wingTipCenterX;
      const centerZ = end * wingTipCenterZ;
      return hullBox(`wingtip-${side < 0 ? 'left' : 'right'}-${end < 0 ? 'stern' : 'bow'}`, 'hull',
        centerX, 0, centerZ, wingTipHalfWidth * 2, 160, wingTipHalfLength * 2,
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle));
    })),
    // The tower rises 180m above the 160m keel and 140m above the fixed main
    // hull maximum. Each narrowing stage remains below100m wide and sits on the
    // enlarged, central top-gun deck rather than overhanging into empty space.
    hullBox('command-base', 'structure', 0, 140, 0, 80, 40, 120),
    hullBox('command-bridge', 'structure', 0, 190, 0, 64, 60, 90),
    hullBox('command-crown', 'structure', 0, 240, 0, 48, 40, 60),
  ];
  const turrets: TurretDefinition[] = [];
  const add = (face: MothershipFace, kind: TurretKind, local: Vector3, normal: Vector3, tangent: Vector3) => {
    const position = local.clone().add(center), aimPoint = position.clone().addScaledVector(normal, kind === 'main' ? 14 : 9);
    // All ingress legs have <=30deg vertical pitch, within the shared aircraft
    // limits, and stay at least125m outside their mounting plane at the near end.
    const normalWeight = face === 'top' || face === 'bottom' ? .5 : face === 'front' || face === 'rear' ? Math.sqrt(.75) : Math.SQRT1_2;
    const ingress = normal.clone().multiplyScalar(normalWeight).addScaledVector(tangent, Math.sqrt(1 - normalWeight * normalWeight));
    const turret: TurretDefinition = {
      id: turrets.length, label: `${face}-${kind}-${turrets.length.toString().padStart(3, '0')}`,
      kind, face, localPosition: local, position, aimPoint, muzzle: new Vector3(), normal, tangent,
      right: tangent.clone().cross(normal).normalize(), maxHpMilli: kind === 'main' ? 600_000 : 150_000,
      yawMin: -75 * DEGREE, yawMax: 75 * DEGREE, pitchMin: 5 * DEGREE, pitchMax: 85 * DEGREE,
      attackApproach: [aimPoint.clone().addScaledVector(ingress, 600), aimPoint.clone().addScaledVector(ingress, 250)],
      outwardWaypoint: aimPoint.clone().addScaledVector(ingress, 900),
    };
    turret.muzzle.copy(turretMuzzle(turret)); turrets.push(turret);
  };
  for (const face of ['top', 'bottom'] as const) {
    for (let row = 0; row < 5; row += 1) for (let column = 0; column < 4; column += 1) {
      const x = [-150, -65, 65, 150][column], z = [-480, -240, 0, 240, 480][row];
      add(face, (row === 1 || row === 3) && (column === 0 || column === 3) ? 'main' : 'mg',
        new Vector3(x, face === 'top' ? 120 : -120, z), new Vector3(0, face === 'top' ? 1 : -1, 0), new Vector3(0, 0, z < 0 ? -1 : 1));
    }
  }
  for (const face of ['left', 'right'] as const) {
    for (let row = 0; row < 5; row += 1) for (let column = 0; column < 4; column += 1) {
      const y = [-55, -20, 20, 55][column], z = [-400, -200, 0, 200, 400][row];
      add(face, (row === 1 || row === 3) && (column === 0 || column === 3) ? 'main' : 'mg',
        new Vector3(face === 'left' ? -300 : 300, y, z), new Vector3(face === 'left' ? -1 : 1, 0, 0), new Vector3(0, 0, z < 0 ? -1 : 1));
    }
  }
  for (const face of ['front', 'rear'] as const) {
    for (let row = 0; row < 2; row += 1) for (let column = 0; column < 5; column += 1) {
      const x = [-150, -75, 0, 75, 150][column], y = row === 0 ? -70 : 70;
      add(face, column === 2 ? 'main' : 'mg', new Vector3(x, y, face === 'front' ? 600 : -600),
        new Vector3(0, 0, face === 'front' ? 1 : -1), new Vector3(0, y < 0 ? -1 : 1, 0));
    }
  }
  // Connected exterior box-edge network; the corners leave enough clearance
  // for ordinary finite-radius turns rather than a sharp path through the hull.
  const outerWaypoints: Vector3[] = [];
  for (const y of [480, 1520]) for (const x of [-850, 850]) for (const z of [-1250, 1250]) outerWaypoints.push(new Vector3(x, y, z));
  for (const y of [480, 1520]) for (const z of [-1250, 1250]) outerWaypoints.push(new Vector3(0, y, z));
  for (const x of [-850, 850]) for (const z of [-1250, 1250]) outerWaypoints.push(new Vector3(x, 1000, z));
  const spawnCandidates: Vector3[] = [];
  for (const y of [1000, 1040, 960, 1080, 920]) for (const x of [0, 40, -40, 80, -80, 120, -120, 160, -160]) {
    const candidate = new Vector3(x, y, 2000);
    while (turrets.some(turret => candidate.distanceTo(turret.muzzle) < (turret.kind === 'main' ? 1300 : 800))) candidate.z += 1;
    spawnCandidates.push(candidate);
  }
  return { center, hullParts, turrets, outerWaypoints, spawnCandidates };
}
