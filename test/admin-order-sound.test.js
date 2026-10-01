import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";

test("admin sound: baseline, new IDs, duplicates, mute, reconnect and expired session",async()=>{
  const source=await readFile(new URL("../public/admin-order-sound.js",import.meta.url),"utf8");
  let click,poll,tones=0,id="9007199254740993",failed=false,redirected=false;
  const button={addEventListener:(event,fn)=>{click=fn;},setAttribute(){}};
  const status={textContent:""};
  const panel={dataset:{latestOrder:id},querySelector:selector=>selector==="[data-sound-toggle]"?button:status};
  class AudioContext{
    state="running";currentTime=0;destination={};
    async resume(){}
    createOscillator(){return {frequency:{},connect(){},disconnect(){},start(){tones++;},stop(){}};}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
  }
  vm.runInNewContext(source,{document:{querySelector:()=>panel,addEventListener(){}},window:{AudioContext},AbortSignal,
    setInterval:fn=>{poll=fn;},fetch:async()=>{if(failed)throw new Error("offline");return {ok:true,redirected,status:200,json:async()=>({latestOrderId:id})};}});
  await poll();assert.equal(tones,0);
  await click();assert.equal(tones,3);
  await poll();assert.equal(tones,3);
  id="9007199254740994";await poll();assert.equal(tones,6);
  await poll();assert.equal(tones,6);
  await click();id="9007199254740995";await poll();assert.equal(tones,6);
  await click();assert.equal(tones,9);
  failed=true;id="9007199254740996";await poll();assert.equal(tones,9);
  failed=false;await poll();assert.equal(tones,12);
  redirected=true;await poll();assert.equal(button.disabled,true);
  id="9007199254740997";await poll();assert.equal(tones,12);
});
