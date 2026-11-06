import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { FlightControls } from '../src/input';
class ElementStub extends EventTarget {
 style={left:'',top:'',setProperty(){},removeProperty(){}};classList={add(){},remove(){},toggle(){}};
 constructor(readonly kind='surface'){super();}
 attributes=new Map<string,string>();captures=new Set<number>();offsetHeight=200;
 getAttribute(k:string){return this.attributes.get(k)??null;}setAttribute(k:string,v:string){this.attributes.set(k,v);}
 getBoundingClientRect(){return {left:0,top:100,right:48,bottom:300,width:48,height:200};}
 closest(selector:string){return selector==='#app'||this.kind==='button'&&selector.includes('button')?this:null;}querySelector(){return this;}focus(){}
 setPointerCapture(id:number){this.captures.add(id);}hasPointerCapture(id:number){return this.captures.has(id);}releasePointerCapture(id:number){this.captures.delete(id);}
}
function pointer(type:string,id:number,x=100,y=200){const e=new Event(type,{cancelable:true});Object.assign(e,{pointerId:id,clientX:x,clientY:y,pointerType:'touch',button:0,buttons:1,isPrimary:false});return e;}
test('three pointer owners preserve micro-steering through fire/lever release and cancel, then clear on recovery',()=>{
 const originals=['window','document','HTMLElement','Element'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)] as const);
 const win=Object.assign(new EventTarget(),{visualViewport:new EventTarget()}),doc=Object.assign(new EventTarget(),{hidden:false,getElementById:()=>new ElementStub()});
 Object.defineProperty(globalThis,'window',{configurable:true,value:win});Object.defineProperty(globalThis,'document',{configurable:true,value:doc});Object.defineProperty(globalThis,'HTMLElement',{configurable:true,value:ElementStub});Object.defineProperty(globalThis,'Element',{configurable:true,value:ElementStub});
 const surface=new ElementStub(),buttons={fire:new ElementStub('button'),loop:new ElementStub('button'),throttle:new ElementStub('button')},controls=new FlightControls(surface as any,buttons as any,()=>true);controls.setMode('normal');
 try {
  surface.dispatchEvent(pointer('pointerdown',1));win.dispatchEvent(pointer('pointermove',1,106,197));const held=controls.sample();assert.equal(held.steeringActive,true);assert.ok(held.turn>0&&held.turn<.35);
  buttons.fire.dispatchEvent(pointer('pointerdown',2));buttons.throttle.dispatchEvent(pointer('pointerdown',3,100,122));
  const all=controls.sample();assert.equal(all.turn,held.turn);assert.equal(all.climb,held.climb);assert.equal(all.fire,true);assert.equal(all.throttle,1);
  win.dispatchEvent(pointer('pointermove',2,20,30));assert.equal(controls.sample().climb,held.climb);
  buttons.fire.dispatchEvent(pointer('lostpointercapture',2));assert.equal(controls.sample().fire,false);assert.equal(controls.sample().turn,held.turn);assert.equal(controls.sample().throttle,1);
  win.dispatchEvent(pointer('pointercancel',3));assert.equal(controls.sample().throttle,0);assert.equal(controls.sample().climb,held.climb);
  win.dispatchEvent(pointer('pointerup',1));assert.equal(controls.sample().turn,0);assert.equal(controls.sample().climb,0);assert.equal(controls.sample().steeringActive,undefined);
  for(const name of ['blur','orientationchange','pagehide']){surface.dispatchEvent(pointer('pointerdown',4));win.dispatchEvent(new Event(name));assert.equal(controls.peek().steerPointer,null);assert.equal(controls.sample().steeringActive,undefined);}
  surface.dispatchEvent(pointer('pointerdown',5));controls.clear();assert.equal(controls.sample().turn,0);
 } finally {controls.dispose();for(const [key,d] of originals)if(d)Object.defineProperty(globalThis,key,d);else Reflect.deleteProperty(globalThis,key);}
});

test('height-only window and visualViewport resize retain the same pointer and rebase its next move',()=>{
 for(const mode of ['easy','normal'] as const)for(const source of ['window','visualViewport'])for(const [fromHeight,toHeight] of [[874,820],[430,390],[390,430]]){
  const originals=['window','document','HTMLElement','Element'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)] as const);
  const win=Object.assign(new EventTarget(),{innerWidth:402,innerHeight:fromHeight,visualViewport:Object.assign(new EventTarget(),{width:402,height:fromHeight})});
  const doc=Object.assign(new EventTarget(),{hidden:false,getElementById:()=>new ElementStub()});
  for(const[k,value]of [['window',win],['document',doc],['HTMLElement',ElementStub],['Element',ElementStub]] as const)Object.defineProperty(globalThis,k,{configurable:true,value});
  const surface=new ElementStub(),buttons={fire:new ElementStub('button'),loop:new ElementStub('button'),throttle:new ElementStub('button')};
  const controls=new FlightControls(surface as any,buttons as any,()=>true);controls.setMode(mode);
  try{
   surface.dispatchEvent(pointer('pointerdown',1));win.dispatchEvent(pointer('pointermove',1,112,194));const before=controls.sample();
   if(mode==='normal'){buttons.fire.dispatchEvent(pointer('pointerdown',2));buttons.throttle.dispatchEvent(pointer('pointerdown',3,100,122));}
   if(source==='window')win.innerHeight=toHeight;win.visualViewport.height=toHeight;
   (source==='window'?win:win.visualViewport).dispatchEvent(new Event('resize'));
   assert.equal(controls.peek().steerPointer,1,`${mode}/${source}/402x${fromHeight}->402x${toHeight}`);assert.equal(controls.sample().turn,before.turn);
   win.dispatchEvent(pointer('pointermove',1,112,140));const rebased=controls.sample();
   assert.ok(Math.abs(rebased.turn-before.turn)<1e-12);assert.ok(Math.abs(rebased.climb-before.climb)<1e-12);
   win.dispatchEvent(pointer('pointermove',1,116,137));assert.ok(controls.sample().turn>before.turn);
   if(mode==='normal'){assert.equal(controls.sample().fire,true);assert.equal(controls.sample().throttle,1);win.dispatchEvent(pointer('pointercancel',2));assert.equal(controls.sample().fire,false);assert.equal(controls.peek().steerPointer,1);}
   win.innerWidth=874;win.innerHeight=402;win.dispatchEvent(new Event('resize'));
   assert.equal(controls.peek().steerPointer,null);assert.equal(controls.sample().turn,0);assert.equal(controls.sample().fire,false);
  }finally{controls.dispose();for(const[k,d]of originals)if(d)Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);}
 }
});

// Execute the product's real fitHud handler without creating its WebGL renderer.
// A HUD layout breakpoint must not release input while the width stays fixed.
test('main HUD resize handler preserves owned steering across square and compact-height boundaries',()=>{
 const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
 const tree=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
 const handler=tree.statements.find((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text==='fitHud');
 assert.ok(handler);
 const javascript=ts.transpileModule(`${handler.getText()}; fitHud;`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 for(const mode of ['easy','normal'] as const)for(const [fromHeight,toHeight] of [[430,390],[390,430],[460,430],[430,460]]){
  const originals=['window','document','HTMLElement','Element'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)] as const);
  const win=Object.assign(new EventTarget(),{innerWidth:402,innerHeight:fromHeight,visualViewport:Object.assign(new EventTarget(),{width:402,height:fromHeight})});
  const doc=Object.assign(new EventTarget(),{hidden:false,documentElement:{},getElementById:()=>new ElementStub()});
  for(const[k,value]of [['window',win],['document',doc],['HTMLElement',ElementStub],['Element',ElementStub]] as const)Object.defineProperty(globalThis,k,{configurable:true,value});
  const surface=new ElementStub(),buttons={fire:new ElementStub('button'),loop:new ElementStub('button'),throttle:new ElementStub('button')};
  const controls=new FlightControls(surface as any,buttons as any,()=>true);controls.setMode(mode);
  const app={clientWidth:402,clientHeight:fromHeight,dataset:{compactHud:String(fromHeight<=450),largeText:'false'}};
  const fitHud=runInNewContext(javascript,{app,controls,settings:{refresh(){}},document:doc,getComputedStyle:()=>({fontSize:'16px'}),presentHudNotices(){},fitCombatDetails(){}}) as ()=>void;
  try{
   surface.dispatchEvent(pointer('pointerdown',7));win.dispatchEvent(pointer('pointermove',7,112,194));const before=controls.sample();
   if(mode==='normal'){buttons.fire.dispatchEvent(pointer('pointerdown',8));buttons.throttle.dispatchEvent(pointer('pointerdown',9,100,122));}
   // Invoke main's actual handler independently; controller events are covered above.
   app.clientHeight=toHeight;fitHud();
   const label=`${mode}/402x${fromHeight}->402x${toHeight}`;
   assert.equal(app.dataset.compactHud,String(toHeight<=450),label);
   assert.equal(controls.peek().steerPointer,7,label);
   assert.equal(controls.sample().turn,before.turn,label);assert.equal(controls.sample().climb,before.climb,label);
   if(mode==='normal'){assert.equal(controls.sample().fire,true,label);assert.equal(controls.sample().throttle,1,label);}
   win.dispatchEvent(pointer('pointermove',7,116,191));assert.ok(controls.sample().turn>before.turn,label);
   win.dispatchEvent(new Event('orientationchange'));assert.equal(controls.peek().steerPointer,null,label);assert.equal(controls.sample().turn,0,label);
  }finally{controls.dispose();for(const[k,d]of originals)if(d)Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);}
 }
});
