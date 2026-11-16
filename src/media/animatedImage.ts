// SPDX-License-Identifier: AGPL-3.0-only
import {inspectGif,type GifInfo} from './gif';
import {inspectWebP} from './webp';
export async function inspectAnimation(blob:Blob):Promise<GifInfo|undefined>{return await inspectGif(blob)??await inspectWebP(blob);}
