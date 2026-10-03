import { prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader';
import { scanContrast } from '../lib/scan-contrast.mjs';
import { barcodeRegions, alignBarcode } from '../lib/scan-regions.mjs';

const options: ReaderOptions = {
  formats: ['EAN13','EAN8','Code128','Code39','UPCA','UPCE','ITF'],
  tryRotate:true, tryHarder:true, tryInvert:false, maxNumberOfSymbols:1,
  minLineCount:2, returnErrors:false,
};
type WorkerMessage =
  | {type:'ready'}
  | {type:'failed'}
  | {type:'result';code:string|null;ms:number};
type FrameMessage = {type:string;buffer?:ArrayBuffer;width?:number;height?:number};
const scope = self as unknown as {
  location:Location;
  postMessage:(data:WorkerMessage)=>void;
  onmessage:((event:MessageEvent<FrameMessage>)=>void)|null;
};
// Self-hosted immutable assets: no CDN or deployment-specific late imports.
const ready = prepareZXingModule({fireImmediately:true,overrides:{
  locateFile: () => new URL('./barcode-reader-v3.wasm', scope.location.href).href,
}});
ready.then(() => scope.postMessage({type:'ready'})).catch(() => scope.postMessage({type:'failed'}));
let working=false;
scope.onmessage = async ({data}) => {
  if(data.type!=='frame'||working)return;
  working=true;
  const start=performance.now();
  try {
    await ready;
    const image = new ImageData(new Uint8ClampedArray(data.buffer),data.width,data.height);
    let code:string|null=null;
    const read = async (frame:ImageData) => (await readBarcodes(frame,options)).find(r=>!r.error)?.text || null;
    // Measure parallel bar edges across the frame and deskew only candidates.
    // Angle is continuous, not limited to a list of preset rotations.
    for(const region of barcodeRegions(image)) {
      // Pixel gradients on a low-resolution webcam have an angular bias. Check
      // nearby directions on this small crop rather than resampling the frame.
      // The edge map estimates a continuous angle. Try that first, then a
      // small correction band for noisy webcam pixels before returning to the
      // next live frame. This keeps failed frames from monopolizing the worker.
      for(const offset of [0,-4,4,-8,8,-14,14]) {
        const aligned=alignBarcode(image,{...region,angle:region.angle+offset*Math.PI/180});
        const raw=new ImageData(aligned.data,aligned.width,aligned.height);
        code=await read(raw);
        if(!code){const corrected=scanContrast(raw);code=await read(new ImageData(corrected.data,corrected.width,corrected.height));}
        if(code||performance.now()-start>55)break;
      }
      if(code||performance.now()-start>55)break;
    }
    if(!code&&performance.now()-start<55)code=await read(image);
    scope.postMessage({type:'result',code,ms:performance.now()-start});
  } catch {
    scope.postMessage({type:'failed'});
  } finally { working=false; }
};
