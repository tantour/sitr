// SPDX-License-Identifier: AGPL-3.0-only
/** getRandomValues remains available on HTTP; randomUUID is secure-context only. */
export function uniqueId():string{
  if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
  const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const text=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return `${text.slice(0,8)}-${text.slice(8,12)}-${text.slice(12,16)}-${text.slice(16,20)}-${text.slice(20)}`;
}
