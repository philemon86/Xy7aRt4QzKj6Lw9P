// Local illumination correction preserves narrow dark bars across reflections.
export function scanContrast(image, radius = 16, bias = 4) {
  const {width:w,height:h,data}=image;
  const stride=w+1, sum=new Float64Array(stride*(h+1));
  const gray=new Uint8Array(w*h);
  for(let y=0;y<h;y++) {
    let row=0;
    for(let x=0;x<w;x++) {
      const p=(y*w+x)*4, v=(data[p]*77+data[p+1]*150+data[p+2]*29)>>8;
      gray[y*w+x]=v; row+=v;
      sum[(y+1)*stride+x+1]=sum[y*stride+x+1]+row;
    }
  }
  const output=new Uint8ClampedArray(data.length);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const l=Math.max(0,x-radius),r=Math.min(w,x+radius+1),t=Math.max(0,y-radius),b=Math.min(h,y+radius+1);
    const mean=(sum[b*stride+r]-sum[t*stride+r]-sum[b*stride+l]+sum[t*stride+l])/((r-l)*(b-t));
    const v=gray[y*w+x]<mean-bias?0:255,p=(y*w+x)*4;
    output[p]=output[p+1]=output[p+2]=v;output[p+3]=255;
  }
  return {data:output,width:w,height:h};
}
