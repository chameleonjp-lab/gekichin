import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import { createPlayer, FlightSession } from '../src/game-state';
import { updateQuaternion } from '../src/flight';
import { getFlightAssist } from '../src/flight-assist';
import { FLIGHT_FOV, getFlightCameraPose, projectFlightTarget, getEffectiveFlightCameraPose } from '../src/flight-view';

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
  for(const [pitch,yaw,bank] of [[0,0,0],[.35,.7,.4],[-.3,-.6,-.5],[.1,Math.PI,.4]]){
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
