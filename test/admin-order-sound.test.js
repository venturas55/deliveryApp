import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";

test("admin sound: baseline, new IDs, duplicates, mute, reconnect and expired session",async()=>{
  const source=await readFile(new URL("../public/admin-order-sound.js",import.meta.url),"utf8");
  let click,poll,tones=0,events=[],failed=false,redirected=false;
  const frequencies=[];
  const button={addEventListener:(event,fn)=>{click=fn;},setAttribute(){}};
  const status={textContent:""};
  const panel={dataset:{notificationSnapshot:JSON.stringify({cursor:{afterId:"9007199254740993",since:"2026-10-01 12:00:00"},events:[{id:"1",kind:"card"}]})},querySelector:selector=>selector==="[data-sound-toggle]"?button:status};
  class AudioContext{
    state="running";currentTime=0;destination={};
    async resume(){}
    createOscillator(){return {frequency:{},connect(){},disconnect(){},start(){tones++;frequencies.push(this.frequency.value);},stop(){}};}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
  }
  vm.runInNewContext(source,{document:{querySelector:()=>panel,addEventListener(){}},window:{AudioContext},AbortSignal,URLSearchParams,
    setInterval:fn=>{poll=fn;},fetch:async()=>{if(failed)throw new Error("offline");return {ok:true,redirected,status:200,json:async()=>({events})};}});
  await poll();assert.equal(tones,0);
  assert.equal(button.textContent,"Silenciar avisos");
  await poll();assert.equal(tones,0);
  events=[{id:"1",kind:"card"},{id:"9007199254740994",kind:"cash"}];await poll();assert.equal(tones,3);
  assert.deepEqual(frequencies.slice(-3),[660,880,1100]);
  await poll();assert.equal(tones,3);
  // An older pending order is paid after a newer cash order: it still alerts.
  events.push({id:"2",kind:"card"});await poll();assert.equal(tones,7);
  assert.deepEqual(frequencies.slice(-4),[1100,880,1100,1320]);
  await poll();assert.equal(tones,7);
  await click();events.push({id:"9007199254740995",kind:"cash"});await poll();assert.equal(tones,7);
  await click();assert.equal(tones,7);
  failed=true;events.push({id:"3",kind:"card"});await poll();assert.equal(tones,7);
  failed=false;await poll();assert.equal(tones,11);
  redirected=true;await poll();assert.equal(button.disabled,true);
  events.push({id:"4",kind:"card"});await poll();assert.equal(tones,11);
});

test("autoplay blocked: interaction releases pending alerts, mute prevents unlock",async()=>{
  const source=await readFile(new URL("../public/admin-order-sound.js",import.meta.url),"utf8");
  let poll,click,allowed=false,tones=0,resumes=0;
  const handlers={};
  const button={addEventListener:(event,fn)=>{click=fn;},setAttribute(){}};
  const status={};
  const panel={dataset:{notificationSnapshot:JSON.stringify({cursor:{afterId:"0",since:"2026-10-01 12:00:00"},events:[]})},querySelector:s=>s==="[data-sound-toggle]"?button:status};
  class AudioContext{
    state="suspended";currentTime=0;destination={};
    async resume(){resumes++;if(allowed)this.state="running";}
    createOscillator(){return {frequency:{},connect(){},disconnect(){},start(){tones++;},stop(){}};}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
  }
  vm.runInNewContext(source,{document:{querySelector:()=>panel,addEventListener:(event,fn)=>{handlers[event]=fn;}},window:{AudioContext},AbortSignal,URLSearchParams,setInterval:fn=>{poll=fn;},fetch:async()=>({ok:true,json:async()=>({events:[{id:"1",kind:"card"}]})})});
  await poll();assert.equal(tones,0);assert.equal(button.textContent,"Silenciar avisos");
  allowed=true;handlers.click();await new Promise(setImmediate);assert.equal(tones,4);
  await poll();assert.equal(tones,4);
  click();const previous=resumes;handlers.keydown();await Promise.resolve();assert.equal(resumes,previous);
});
