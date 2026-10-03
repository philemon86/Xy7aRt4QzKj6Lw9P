// One frame in flight. Slow devices drop frames rather than scan stale images.
export function createCameraWorker({onCode=(_code)=>{},onFailure=()=>{},WorkerClass=globalThis.Worker,setTimer=setTimeout,clearTimer=clearTimeout}={}) {
  let worker, stopped=false, ready=false, busy=false, timeout;
  const fail=()=>{if(stopped)return;stopped=true;ready=false;busy=false;clearTimer(timeout);worker?.terminate();onFailure();};
  try {
    if(!WorkerClass) return null;
    worker=new WorkerClass('/pos/barcode-worker-v3.js');
  } catch {return null;}
  timeout=setTimer(fail,15000);
  worker.onerror=fail;
  worker.onmessage=({data})=>{
    if(stopped)return;
    clearTimer(timeout);
    if(data.type==='ready'){ready=true;busy=false;}
    else if(data.type==='result'){busy=false;if(data.code)onCode(data.code);}
    else fail();
  };
  return {
    get ready(){return ready&&!stopped;},
    get busy(){return busy;},
    submit(image){
      if(!ready||stopped||busy)return false;
      busy=true;
      timeout=setTimer(fail,3000);
      try{worker.postMessage({type:'frame',width:image.width,height:image.height,buffer:image.data.buffer},[image.data.buffer]);return true;}
      catch{fail();return false;}
    },
    close(){stopped=true;ready=false;clearTimer(timeout);worker.terminate();},
  };
}
