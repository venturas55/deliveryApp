import test from "node:test";
import assert from "node:assert/strict";
import {encryptSecret,decryptSecret} from "../src/services/delivery-credentials.js";

process.env.DELIVERY_CREDENTIALS_KEY=Buffer.alloc(32,7).toString("base64");

test("delivery credentials use authenticated AES-GCM encryption",()=>{
  const encrypted=encryptSecret("provider-secret");
  assert.equal(decryptSecret(encrypted),"provider-secret");
  assert.notEqual(encrypted,"provider-secret");
  const envelope=JSON.parse(encrypted);
  envelope.data=envelope.data.replace(/.$/,envelope.data.endsWith("A")?"B":"A");
  assert.throws(()=>decryptSecret(JSON.stringify(envelope)),/No se pudo descifrar/);
});