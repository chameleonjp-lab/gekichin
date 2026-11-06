import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion } from 'three';
import { FlightSession, FixedStepper } from '../src/game-state';
import { getEffectiveFlightCameraPose } from '../src/flight-view';
import { FlightPresentation, displayTarget } from '../src/flight-presentation';
import { updateQuaternion } from '../src/flight';
import { getFlightCameraPose } from '../src/flight-view';

const input={turn:0,climb:.45,fire:false,loop:false,steeringActive:true};
test('120Hz presentation has0/48 repeated optical directions in both modes and leaves logic unchanged',()=>{
 for(const mode of ['easy','normal'] as const){
  const finals=[];
  for(const hz of [30,60,120]){
   const session=new FlightSession();session.begin(session.prepare(mode,73)!);session.player.position.y=1500;
   const clock=new FixedStepper(),view=new FlightPresentation();clock.reset(0);
   const forwards:Vector3[]=[];
   for(let frame=1;frame<=hz/2;frame++){
    clock.frame(frame*1000/hz,true,()=>{view.capture(session);session.step(input);},()=>assert.fail('gap'));
    const before=JSON.stringify({player:session.player,bullets:session.weapons.bullets,tick:session.tick,score:session.score.totals});
    const sampled=view.sample(session,clock.alpha),p=new Vector3(),q=new Quaternion();
    getEffectiveFlightCameraPose(sampled.player,mode,p,q,session.world);
    if(hz===120)forwards.push(new Vector3(0,0,-1).applyQuaternion(q));
    assert.equal(JSON.stringify({player:session.player,bullets:session.weapons.bullets,tick:session.tick,score:session.score.totals}),before);
   }
   if(hz===120){let repeats=0;for(let i=12;i<60;i++)if(forwards[i].distanceTo(forwards[i-1])<1e-12)repeats++;assert.equal(repeats,0);}
   finals.push(JSON.stringify({tick:session.tick,player:session.player,bullets:session.weapons.bullets,score:session.score.totals,events:session.events}));
  }
  assert.equal(finals[0],finals[1]);assert.equal(finals[1],finals[2]);
 }
});

test('display target enters, switches ID and exits using sampled view at alpha0 half and1',()=>{
 const session=new FlightSession();session.begin(session.prepare('easy',73)!);session.player.position.y=1500;
 for(const turret of session.mothership.turrets)turret.hpMilli=0;
 const a=session.mothership.turrets[0],b=session.mothership.turrets[1];a.hpMilli=a.maxHpMilli;b.hpMilli=b.maxHpMilli;
 const p=new Vector3(),q=new Quaternion();getFlightCameraPose(session.player,'easy',p,q);
 a.layout.aimPoint.copy(new Vector3(0,0,-500).applyQuaternion(q).add(p));
 b.layout.aimPoint.copy(new Vector3(105,0,-500).applyQuaternion(q).add(p));
 const view=new FlightPresentation();view.capture(session);session.player.yaw=-.7;updateQuaternion(session.player);session.tick++;
 session.target=null;
 assert.deepEqual([0,.5,1].map(alpha=>displayTarget(session,view.sample(session,alpha).player,402/874)?.id??null),[a.id,b.id,null]);
 view.capture(session);session.player.yaw=0;updateQuaternion(session.player);session.tick++;session.target=a;
 assert.deepEqual([0,.5,1].map(alpha=>displayTarget(session,view.sample(session,alpha).player,402/874)?.id??null),[null,b.id,a.id]);
 assert.equal(session.target,a,'display selection never rewrites the authoritative trigger');
});

test('presentation samples aircraft and rounds at one fraction and rejects pause, replacement and old operation poses',()=>{
 const session=new FlightSession();session.begin(session.prepare('normal',73)!);const view=new FlightPresentation();
 const before=session.player.position.clone(),beforePitch=session.player.pitch;
 view.capture(session);session.step({...input,fire:true});
 const quarter=view.sample(session,.25),half=view.sample(session,.5),full=view.sample(session,1);
 assert.ok(half.player.position.distanceTo(before.clone().lerp(session.player.position,.5))<1e-10);
 assert.ok(Math.abs(half.player.pitch-(beforePitch+session.player.pitch)*.5)<1e-12);
 assert.deepEqual(full.player.position.toArray(),session.player.position.toArray());
 assert.notDeepEqual(quarter.player.position.toArray(),half.player.position.toArray());
 assert.ok(half.state.fleet!.active.every(t=>t.position!==session.fleet.active.find(real=>real.tokenId===t.tokenId)!.position));
 for(const bullet of half.state.weapons!.bullets){const real=session.weapons.bullets.find(b=>b.id===bullet.id)!;assert.ok(bullet.position.distanceTo(real.previous.clone().lerp(real.position,.5))<1e-10);}
 session.pause('manual');assert.equal(view.sample(session,.25).player,session.player);
 session.resume();assert.equal(view.sample(session,.25).player,session.player);
 view.capture(session);session.step(input);session.fleet.player!.generation+=1;
 assert.equal(view.sample(session,.25).player,session.player,'new generation never blends from retired aircraft');
 session.home();session.begin(session.prepare('normal',73)!);assert.equal(view.sample(session,.25).player,session.player);
});
