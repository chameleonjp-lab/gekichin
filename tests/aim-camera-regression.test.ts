import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import { createPlayer, FlightSession } from '../src/game-state';
import { updateQuaternion } from '../src/flight';
import { getFlightAssist } from '../src/flight-assist';
import { EASY_CAMERA_LOOK_ANGLE, FLIGHT_CAMERA_BANK_FACTOR, FLIGHT_FOV, NORMAL_CAMERA_LOOK_ANGLE, getFlightCameraPose, projectFlightTarget, getEffectiveFlightCameraPose, sinkingShipPose } from '../src/flight-view';

const input = { turn: 0, climb: 0, fire: false, loop: false, viewAspect: 393 / 852 };
function atScreen(player: ReturnType<typeof createPlayer>, x: number, y: number, depth: number) {
  const position = new Vector3(), rotation = new Quaternion();
  getFlightCameraPose(player, 'easy', position, rotation);
  const tan = Math.tan(FLIGHT_FOV * Math.PI / 360);
  return new Vector3(x * depth * tan * input.viewAspect, y * depth * tan, -depth).applyQuaternion(rotation).add(position);
}
test('centered target A prevents a nearer off-circle B from steering the aircraft', () => {
  const player = createPlayer();
  const a = { id: 'A', aimPoint: atScreen(player, 0, 0, 950), alive: true, exposed: true };
  const b = { id: 'B', aimPoint: atScreen(player, .8, .55, 400), alive: true, exposed: true };
  const result = getFlightAssist(player, [a, b], input, 'easy');
  assert.equal(result.turn, 0); assert.equal(result.climb, 0);
});
test('real mothership #95 inside the circle fires despite nearer off-circle #90', () => {
  const session = new FlightSession(); session.begin(session.prepare('easy')!);
  const player = session.fleet.player!;
  player.position.set(-900, 800, -1200); player.pitch = .28998653505671845; player.yaw = -2.2823738938461804; player.bank = 0;
  updateQuaternion(player); session.step(input);
  assert.equal(session.target?.layout.id, 95);
  assert.ok(session.weapons.bullets.some(b => b.owner === 'player'), 'real player projectiles must be emitted');
});

import { projectGunSight } from '../src/gun-sight';
import { FlightScene } from '../src/scene';
import { createFlightTargetLock, selectProjectedTarget, smoothFlightAssistance } from '../src/flight-target';

const sizes = [[320,568],[393,852],[852,393],[568,320],[1280,720]];
test('Normal 500m bore uses the independent rendered projection at all attitudes and sizes',()=>{
  const player=createPlayer();player.position.set(0,1000,0);
  for(const [pitch,yaw,bank] of [[0,0,0],[.35,.7,.4],[-.3,-.6,-.5],[.1,Math.PI,.4],[-.9,-3.14,-.72],[.9,3.14,.72]]){
    Object.assign(player,{pitch,yaw,bank});updateQuaternion(player);
    for(const [width,height] of sizes){
      const camera=new PerspectiveCamera(64,width/height,.5,6500);
      getFlightCameraPose(player,'normal',camera.position,camera.quaternion);camera.updateMatrixWorld();
      const bore=new Vector3(0,0,-504.5).applyQuaternion(player.quaternion).add(player.position).project(camera);
      const sight=projectGunSight(player,width,height);
      assert.ok(Math.abs(sight.x-(bore.x*.5+.5)*width)<1e-8);
      assert.ok(Math.abs(sight.y-(.5-bore.y*.5)*height)<1e-8);
    }
  }
});
test('bank rolls the rendered image while optical forward keeps pitch and yaw, and offset remains the 55% legacy offset',()=>{
  const player=createPlayer();player.position.set(35,1100,-80);
  for(const mode of ['easy','normal'] as const)for(const [pitch,yaw] of [[-.9,-2.1],[0,.4],[.9,2.8]]){
    const poses=[];
    for(const bank of [0,-.72,.72]){
      Object.assign(player,{pitch,yaw,bank});updateQuaternion(player);
      const position=new Vector3(),rotation=new Quaternion();getFlightCameraPose(player,mode,position,rotation);
      poses.push({position,forward:new Vector3(0,0,-1).applyQuaternion(rotation).normalize()});
    }
    assert.ok(poses[0].forward.distanceTo(poses[1].forward)<1e-12);
    assert.ok(poses[0].forward.distanceTo(poses[2].forward)<1e-12);
    // Re-run the pre-roll-separation position formula verbatim: only the
    // optical rotation changes; camera offset stays byte-for-byte equivalent.
    const oldPositionRotation=player.quaternion.clone().multiply(new Quaternion().setFromAxisAngle(
      new Vector3(0,0,1),player.bank*(1-FLIGHT_CAMERA_BANK_FACTOR)));
    const oldPosition=new Vector3(0,11,29).applyQuaternion(oldPositionRotation).add(player.position);
    assert.deepEqual(poses[2].position.toArray(),oldPosition.toArray());
    const normal=poses[0].forward, rolled=poses[2].forward;
    assert.ok(normal.distanceTo(rolled)<1e-12,`${mode} optical forward must be bank-independent`);
  }
  assert.equal(NORMAL_CAMERA_LOOK_ANGLE,-.19);assert.ok(Math.abs(EASY_CAMERA_LOOK_ANGLE+Math.atan2(11,479))<1e-15);
});
test('actual scene collision camera and target projection agree, including independent sinking transforms',()=>{
  const game=new FlightSession(),player=createPlayer();player.position.set(0,1000,620);player.yaw=Math.PI;updateQuaternion(player);
  assert.equal(game.world.sweep(player.position,player.position,{radius:9,aircraft:false}),null);
  const nominal=new Vector3(),rotation=new Quaternion();getFlightCameraPose(player,'normal',nominal,rotation);
  const corrected=new Vector3();getEffectiveFlightCameraPose(player,'normal',corrected,rotation,game.world);
  assert.ok(corrected.distanceTo(nominal)>10,'real hull must move the camera');
  for(const seconds of [0,2,4.9])for(const [width,height] of sizes){
    const progress=seconds/5,ease=progress*progress*(3-2*progress),roll=Math.sin(seconds*.72)*.055*progress;
    const ship={center:game.world.layout.center,position:game.world.layout.center.clone().add(new Vector3(0,-126*ease,0)),
      rotation:new Quaternion().setFromEuler(new Euler(.035*progress+roll*.35,0,.105*progress+roll,'XYZ'))};
    const camera=new PerspectiveCamera(64,width/height,.5,6500);
    const fake:any={layout:game.world.layout,reducedMotion:false,position:new Vector3(),rotation:new Quaternion(),camera,scene:new Scene(),
      canvas:{closest:()=>null},renderer:{render(){}},selectWorld:()=>game.world,previewMothership:game.mothership};
    for(const method of ['applyTurrets','consumeEvents','updateAircraft','updateWarningVisuals','updateTracerVisuals','setSinking','updateParticles','writeDiagnostics'])fake[method]=()=>{};
    FlightScene.prototype.render.call(fake,player,'normal',0,{mothership:game.mothership,collisionWorld:game.world},seconds);
    camera.updateMatrixWorld();
    const point=new Vector3(0,0,-500).applyQuaternion(player.quaternion).add(player.position),rendered=point.clone().project(camera);
    const logical=projectFlightTarget(player,point,width/height,'normal',game.world,ship);
    assert.ok(Math.abs(logical.x-rendered.x)*width/2<1e-8);assert.ok(Math.abs(logical.y-rendered.y)*height/2<1e-8);
    const normalSight=projectGunSight(player,width,height,game.world,ship);
    const renderedBore=new Vector3(0,0,-504.5).applyQuaternion(player.quaternion).add(player.position).project(camera);
    assert.ok(Math.abs(normalSight.y-(.5-renderedBore.y*.5)*height)<1e-8);
  }
});
test('effective camera cast keeps radius and normal push, with ship-local coordinates transformed back to world',()=>{
  const player=createPlayer();player.position.set(30,1200,-70);player.pitch=.3;player.yaw=-.8;player.bank=.2;updateQuaternion(player);
  const before=new Vector3(),rotation=new Quaternion();getFlightCameraPose(player,'normal',before,rotation);
  let radius=0,castFrom=new Vector3(),castTo=new Vector3();
  const hitPoint=new Vector3(10,20,30),hitNormal=new Vector3(0,1,0);
  const world={cameraCast(from:Vector3,to:Vector3,castRadius:number){castFrom.copy(from);castTo.copy(to);radius=castRadius;return {point:hitPoint.clone(),normal:hitNormal.clone()};}};
  const camera=new Vector3();getEffectiveFlightCameraPose(player,'normal',camera,rotation,world);
  assert.equal(radius,1.5);assert.ok(castFrom.distanceTo(player.position)<1e-12);assert.ok(castTo.distanceTo(before)<1e-12);
  assert.ok(camera.distanceTo(hitPoint.clone().addScaledVector(hitNormal,2.05))<1e-12);

  const center=new Vector3(5,800,-9),shipPosition=new Vector3(3,650,-11);
  const ship={center,position:shipPosition,rotation:new Quaternion().setFromEuler(new Euler(.15,-.3,.24,'XYZ'))};
  const inverse=ship.rotation.clone().invert();
  const expectedFrom=player.position.clone().sub(ship.position).applyQuaternion(inverse).add(ship.center);
  const expectedTo=before.clone().sub(ship.position).applyQuaternion(inverse).add(ship.center);
  const localPoint=new Vector3(13,24,37),localNormal=new Vector3(0,0,1).normalize();
  let observedFrom=new Vector3(),observedTo=new Vector3();
  const transformedWorld={cameraCast(from:Vector3,to:Vector3,castRadius:number){observedFrom.copy(from);observedTo.copy(to);assert.equal(castRadius,1.5);return {point:localPoint.clone(),normal:localNormal.clone()};}};
  getEffectiveFlightCameraPose(player,'normal',camera,rotation,transformedWorld,ship);
  assert.ok(observedFrom.distanceTo(expectedFrom)<1e-12);assert.ok(observedTo.distanceTo(expectedTo)<1e-12);
  const expectedWorld=localPoint.clone().sub(ship.center).applyQuaternion(ship.rotation).add(ship.position)
    .addScaledVector(localNormal.clone().applyQuaternion(ship.rotation),2.05);
  assert.ok(camera.distanceTo(expectedWorld)<1e-12);
});
test('sinking camera preserves five seconds, clamps after completion, and honors reduced motion',()=>{
  const center=new Vector3(12,900,-33);
  for(const seconds of [0,2,4.9,5,8]){
    const pose=sinkingShipPose(center,seconds,false),s=Math.min(5,Math.max(0,seconds)),progress=s/5,eased=progress*progress*(3-2*progress),roll=Math.sin(s*.72)*.055*progress;
    assert.equal(pose.position.y,center.y-126*eased);assert.equal(pose.position.x,center.x);assert.equal(pose.position.z,center.z);
    const expected=new Quaternion().setFromEuler(new Euler(.035*progress+roll*.35,0,.105*progress+roll,'XYZ'));
    assert.deepEqual(pose.rotation.toArray(),expected.toArray());
  }
  for(const seconds of [0,2,4.9,5,8]){
    const pose=sinkingShipPose(center,seconds,true),s=Math.min(5,Math.max(0,seconds)),progress=s/5;
    const expected=new Quaternion().setFromEuler(new Euler(.035*progress,0,.105*progress,'XYZ'));
    assert.deepEqual(pose.rotation.toArray(),expected.toArray(),'reduced motion removes only the oscillating roll');
  }
});
test('Normal fire emits rounds without changing flight pose, camera or sight',()=>{
  for(const [turn,climb] of [[0,0],[.3,.2],[-.2,-.3]]){
    const sessions=[new FlightSession(),new FlightSession()];for(const session of sessions)session.begin(session.prepare('normal',71)!);
    for(let tick=0;tick<12;tick++)sessions.forEach((session,index)=>session.step({...input,turn,climb,fire:index===1}));
    assert.deepEqual(sessions[0].player.position.toArray(),sessions[1].player.position.toArray());
    assert.deepEqual(sessions[0].player.quaternion.toArray(),sessions[1].player.quaternion.toArray());
    assert.deepEqual(projectGunSight(sessions[0].player,393,852,sessions[0].world),projectGunSight(sessions[1].player,393,852,sessions[1].world));
    assert.equal(sessions[0].weapons.bullets.filter(b=>b.owner==='player').length,0);
    assert.ok(sessions[1].weapons.bullets.some(b=>b.owner==='player'));
  }
});
test('switch margin boundary, held manual aim, invalid release and fresh pull are deterministic',()=>{
  const candidate=(key:string,radius:number,visible=true)=>({key,enemy:key,projection:{x:radius*2,y:0,distance:500,visible,inCircle:false}});
  const lock=createFlightTargetLock();selectProjectedTarget([candidate('A',.4)],1,1500,lock);
  assert.equal(selectProjectedTarget([candidate('B',.385),candidate('A',.4)],1,1500,lock)?.key,'A');
  assert.equal(selectProjectedTarget([candidate('A',.4),candidate('B',.384999)],1,1500,lock)?.key,'B');
  assert.equal(selectProjectedTarget([candidate('A',.1),candidate('B',.384999)],1,1500,lock,true)?.key,'B');
  assert.equal(selectProjectedTarget([candidate('A',.1),candidate('B',.384999,false)],1,1500,lock,true)?.key,'A');
  const state={targetLock:lock,assistTurn:0,assistClimb:0,responseMultiplier:1};
  const adjusted=smoothFlightAssistance(state,input,{turn:1,climb:.3,responseMultiplier:1,hasVisibleTarget:true},1/60);
  assert.ok(adjusted.turn<=2.5/60+1e-12);assert.ok(adjusted.climb<=1.5/60+1e-12);
  const noTarget=smoothFlightAssistance(state,input,{turn:0,climb:0,responseMultiplier:1,hasVisibleTarget:false},1/60);
  assert.equal(noTarget.turn,0);assert.equal(noTarget.climb,0);
});
