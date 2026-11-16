// SPDX-License-Identifier: AGPL-3.0-only
/** CDNs may serve valid images as application/octet-stream. Identify supported
 * containers by their bytes; a header alone must never turn HTML into an image. */
export async function verifiedImageBlob(blob:Blob):Promise<Blob>{
  if(blob.size>20_000_000)throw Error('Image payload too large');
  const bytes=new Uint8Array(await blob.slice(0,512).arrayBuffer()),ascii=(start:number,end:number)=>String.fromCharCode(...bytes.subarray(start,end));
  let type:string|undefined;
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)type='image/jpeg';
  else if(bytes[0]===137&&ascii(1,4)==='PNG'&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10)type='image/png';
  else if(['GIF87a','GIF89a'].includes(ascii(0,6)))type='image/gif';
  else if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP')type='image/webp';
  else if(ascii(4,8)==='ftyp'&&/avif|avis/.test(ascii(8,64)))type='image/avif';
  else if(ascii(0,2)==='BM')type='image/bmp';
  else if(/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(new TextDecoder().decode(bytes)))type='image/svg+xml';
  if(!type)throw Error('Unsupported image response');
  return blob.type.split(';')[0].trim().toLowerCase()===type?blob:blob.slice(0,blob.size,type);
}
