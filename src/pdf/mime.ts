// SPDX-License-Identifier: AGPL-3.0-only
export interface PdfMimeHandler{
 getStreamInfo():Promise<{originalUrl:string;streamUrl:string;tabId:number;embedded:boolean}>;
 getMimeHandlerOptions(type:string):Promise<{enabled?:boolean}>;
 setMimeHandlerOptions(type:string,options:{enabled:boolean}):Promise<void>;
 abortAndFallbackToNativeHandler():Promise<void>;
}
export const pdfMime=()=> (chrome as unknown as {mimeHandler?:PdfMimeHandler}).mimeHandler;
export async function syncPdfHandler(enabled:boolean):Promise<void>{try{await pdfMime()?.setMimeHandlerOptions('application/pdf',{enabled});}catch{/* Older Chrome uses the explicit Open PDF action. */}}
