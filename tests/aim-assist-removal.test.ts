import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion } from 'three';
import { createPlayer, FlightSession } from '../src/game-state';
import { getFlightAssist, selectFlightAssistTarget } from '../src/flight-assist';
import { createFlightController, updatePlayerLoop, updateQuaternion } from '../src/flight';
import { getEffectiveFlightCameraPose, getFlightCameraPose, projectFlightTarget } from '../src/flight-view';
import { AircraftWeapons } from '../src/aircraft-weapons';
import { createAircraftToken } from '../src/fleet';
import type { FlightInput, GameMode } from '../src/types';

const neutral: FlightInput = {turn:0,climb:0,fire:false,loop:false,viewAspect:402/874};
function angle(a:Vector3,b:Vector3){return Math.atan2(new Vector3().crossVectors(a,b).length(),a.dot(b));}

test('enemy layouts cannot change steering, response or camera in either mode',()=>{
 for(const mode of ['easy','normal'] as const)for(const command of [{turn:0,climb:0},{turn:.1,climb:.05},{turn:.2,climb:.2,steeringActive:true}]){
  const world=new FlightSession().world;
  const run=(layout:'none'|'front'|'right'|'edge'|'behind'|'crossing'|'disappearing')=>{
   const player=createPlayer();player.position.y=1500;const meta=createFlightController(player);
   const p=new Vector3(),q=new Quaternion();getFlightCameraPose(player,mode,p,q);
   const points={front:new Vector3(0,0,-500),right:new Vector3(105,0,-500),edge:new Vector3(140,0,-500),behind:new Vector3(0,0,500)};
   for(const point of Object.values(points)){point.applyQuaternion(q).add(p);assert.equal(world.lineOfSight(player.position,point),true);}
   for(let tick=0;tick<12;tick++){
    const name=layout==='crossing'?(tick<4?'right':tick<8?'behind':'front'):layout==='disappearing'?(tick<6?'right':'none'):layout;
    const targets=name==='none'?[]:[{id:1,alive:true,exposed:true,aimPoint:points[name]}];
    const input={...neutral,...command},assist=getFlightAssist(player,targets,input,mode,meta.targetLock,world);
    assert.equal(assist.responseMultiplier,1,`${mode}/${layout}/${tick}`);
    assert.equal(assist.turn,input.turn);assert.equal(assist.climb,input.climb);
    const adjusted={...input,...assist};
    updatePlayerLoop(player,meta,adjusted,input,false,1/60,110,141,meta.responseMultiplier,mode);
   }
   getEffectiveFlightCameraPose(player,mode,p,q,world);
   return {position:player.position.toArray(),quaternion:player.quaternion.toArray(),camera:p.toArray(),rotation:q.toArray()};
  };
  const baseline=run('none');
  for(const layout of ['front','right','edge','behind','crossing','disappearing'] as const)assert.deepEqual(run(layout),baseline);
 }
});

test('real session clears stale pull and only display or firing candidates need target LOS queries',()=>{
 for(const mode of ['easy','normal'] as const){
  const run=(stale:boolean)=>{
   const session=new FlightSession();session.begin(session.prepare(mode,73)!);
   if(stale){session.controller.assistTurn=.8;session.controller.assistClimb=.8;session.controller.responseMultiplier=1.65;}
   let queries=0;const original=session.world.lineOfSight.bind(session.world);
   session.world.lineOfSight=(...args)=>{queries++;assert.equal(projectFlightTarget(session.player,args[1],402/874,mode,session.world).visible,true);return original(...args);};
   session.step({...neutral,turn:.1,climb:.05,steeringActive:true});
   assert.ok(queries<100,'no eager all-turret scan; only projected display or firing candidates are checked');
   assert.equal(session.controller.responseMultiplier,1);assert.equal(session.controller.assistTurn,0);assert.equal(session.controller.assistClimb,0);
   return {position:session.player.position.toArray(),quaternion:session.player.quaternion.toArray()};
  };
  assert.deepEqual(run(true),run(false));
 }
});

test('both MG and cannon barrels leave along the captured physical nose in both modes',()=>{
 for(const mode of ['easy','normal'] as const){
  const plane=createAircraftToken(1,0,0,1,'player',new Vector3(0,1500,0));plane.pitch=.3;plane.yaw=.5;plane.bank=.4;updateQuaternion(plane);
  const weapons=new AircraftWeapons(1),aimPoint=new Vector3(20,0,-500).applyQuaternion(plane.quaternion).add(plane.position);
  const requests=weapons.plan(plane,1,true,mode==='easy',aimPoint);let id=0;const bullets=requests.flatMap(r=>weapons.fire(r,1,()=>++id));
  assert.equal(bullets.length,4);
  const nose=new Vector3(0,0,-1).applyQuaternion(plane.quaternion);
  for(const bullet of bullets)assert.ok(angle(bullet.velocity.clone().normalize(),nose)<1e-12,`${mode}/${bullet.kind}`);
 }
});

test('held neutral retains20degree pitch and release levels smoothly in both modes',()=>{
 for(const mode of ['easy','normal'] as const){
  const player=createPlayer();player.pitch=20*Math.PI/180;updateQuaternion(player);const controller=createFlightController(player),held={...neutral,steeringActive:true};
  for(let tick=0;tick<12;tick++)updatePlayerLoop(player,controller,held,held,false,1/60,110,141,1,mode);
  assert.ok(Math.abs(player.pitch-20*Math.PI/180)<1e-12);
  const before=player.pitch;updatePlayerLoop(player,controller,neutral,neutral,false,1/60,110,141,1,mode);
  assert.ok(player.pitch<before&&player.pitch>before-.02);
 }
});

test('eligible circle targets use current aspect and occlusion without steering',()=>{
 const session=new FlightSession(),player=createPlayer();player.position.y=1500;
 const p=new Vector3(),q=new Quaternion();getFlightCameraPose(player,'easy',p,q);
 const target=(right:number,depth:number,alive=true,exposed=true)=>({id:1,aimPoint:new Vector3(right,0,-depth).applyQuaternion(q).add(p),alive,exposed});
 assert.ok(selectFlightAssistTarget(player,[target(0,500)],402/874,'easy')?.projection.inCircle);
 assert.equal(selectFlightAssistTarget(player,[target(0,1600)],402/874,'easy'),null);
 assert.equal(selectFlightAssistTarget(player,[target(0,500,false)],402/874,'easy'),null);
 assert.equal(selectFlightAssistTarget(player,[target(0,500,true,false)],402/874,'easy'),null);
 assert.equal(selectFlightAssistTarget(player,[target(0,-500)],402/874,'easy'),null);
 assert.equal(selectFlightAssistTarget(player,[target(55,500)],402/874,'easy')?.projection.inCircle,false);
 assert.equal(selectFlightAssistTarget(player,[target(55,500)],874/402,'easy')?.projection.inCircle,true);
});

test('integrated turret layout fixtures change Easy trigger availability without changing flight or camera',()=>{
 // Isolated initial-state fixture: aim points are relocated outside the real hull.
 // This exercises the production session pipeline, not physical turret reachability.
 for(const mode of ['easy','normal'] as const)for(const command of [{turn:0,climb:0},{turn:.1,climb:.05,steeringActive:true}]){
  const runs=[];
  for(const layout of ['none','front','right','behind'] as const){
   const session=new FlightSession();session.begin(session.prepare(mode,73)!);session.player.position.y=1500;
   for(const turret of session.mothership.turrets)turret.hpMilli=0;
   const p=new Vector3(),q=new Quaternion();getFlightCameraPose(session.player,mode,p,q);
   if(layout!=='none'){
    const turret=session.mothership.turrets[0];turret.hpMilli=turret.maxHpMilli;
    turret.layout.aimPoint.copy(new Vector3(layout==='right'?105:0,0,layout==='behind'?500:-500).applyQuaternion(q).add(p));
    assert.equal(session.world.lineOfSight(session.player.position,turret.layout.aimPoint,turret.id),true);
   }
   const poses=[];
   for(let tick=0;tick<12;tick++){
    session.step({...neutral,...command,fire:mode==='normal'});
    assert.equal(session.controller.responseMultiplier,1);
    assert.equal(session.world.sweep(session.player.position,session.player.position,{radius:9,aircraft:false}),null);
    getEffectiveFlightCameraPose(session.player,mode,p,q,session.world);
    poses.push({position:session.player.position.toArray(),quaternion:session.player.quaternion.toArray(),camera:p.toArray(),rotation:q.toArray()});
   }
   runs.push({layout,poses,shots:session.weapons.bullets.filter(b=>b.owner==='player').length});
  }
  for(const run of runs)assert.deepEqual(run.poses,runs[0].poses,`${mode}/${run.layout}`);
  if(mode==='easy'){assert.equal(runs[0].shots,0);assert.ok(runs[1].shots>0);assert.equal(runs[3].shots,0);}
  else for(const run of runs)assert.ok(run.shots>0);
 }
});

test('real hull blocks automatic fire at an otherwise in-circle rear turret',()=>{
 const session=new FlightSession();session.begin(session.prepare('easy',73)!);
 session.player.position.set(0,1000,800);session.player.yaw=0;updateQuaternion(session.player);
 for(const turret of session.mothership.turrets)if(turret.id!==92)turret.hpMilli=0;
 const turret=session.mothership.byId(92)!;
 assert.equal(session.world.sweep(session.player.position,session.player.position,{radius:9,aircraft:false}),null);
 assert.equal(projectFlightTarget(session.player,turret.layout.aimPoint,402/874,'easy',session.world).inCircle,true);
 assert.equal(session.world.lineOfSight(session.player.position,turret.layout.aimPoint,turret.id),false);
 session.step(neutral);
 assert.equal(session.target,null);assert.equal(session.weapons.bullets.filter(b=>b.owner==='player').length,0);
});
