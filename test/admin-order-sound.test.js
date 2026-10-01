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
  await click();assert.equal(tones,3);
  await poll();assert.equal(tones,3);
  events=[{id:"1",kind:"card"},{id:"9007199254740994",kind:"cash"}];await poll();assert.equal(tones,6);
  assert.deepEqual(frequencies.slice(-3),[660,880,1100]);
  await poll();assert.equal(tones,6);
  // An older pending order is paid after a newer cash order: it still alerts.
  events.push({id:"2",kind:"card"});await poll();assert.equal(tones,10);
  assert.deepEqual(frequencies.slice(-4),[1100,880,1100,1320]);
  await poll();assert.equal(tones,10);
  await click();events.push({id:"9007199254740995",kind:"cash"});await poll();assert.equal(tones,10);
  await click();assert.equal(tones,13);
  failed=true;events.push({id:"3",kind:"card"});await poll();assert.equal(tones,13);
  failed=false;await poll();assert.equal(tones,17);
  redirected=true;await poll();assert.equal(button.disabled,true);
  events.push({id:"4",kind:"card"});await poll();assert.equal(tones,17);
});
