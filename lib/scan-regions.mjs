// Find parallel, alternating edges, then align each region by its measured
// direction. This avoids rotating the whole camera frame through a slow queue.
export function barcodeRegions(image) {
 const {width:w,height:h,data}=image,gray=new Uint8Array(w*h);
 for(let i=0;i<gray.length;i++){const p=i*4;gray[i]=(77*data[p]+150*data[p+1]+29*data[p+2])>>8;}
 const size=32,step=16,cols=Math.max(0,Math.floor((w-size-2)/step)+1),rows=Math.max(0,Math.floor((h-size-2)/step)+1),tiles=new Map();
 for(let ty=0;ty<rows;ty++)for(let tx=0;tx<cols;tx++){
  let xx=0,yy=0,xy=0,energy=0;
  for(let y=ty*step+1;y<ty*step+size;y+=2)for(let x=tx*step+1;x<tx*step+size;x+=2){
   const p=y*w+x,gx=gray[p+1]-gray[p-1],gy=gray[p+w]-gray[p-w];xx+=gx*gx;yy+=gy*gy;xy+=gx*gy;energy+=Math.abs(gx)+Math.abs(gy);
  }
  const total=xx+yy,coherence=total?Math.hypot(xx-yy,2*xy)/total:0;
  if(energy<2200||coherence<0.65)continue;
  const angle=Math.atan2(2*xy,xx-yy)/2;
  let changes=0,lastSign=0,lastValue=0;
  const c=Math.cos(angle),s=Math.sin(angle),cx=tx*step+size/2,cy=ty*step+size/2;
  for(let n=-15;n<=15;n++){
   const x=Math.round(cx+n*c),y=Math.round(cy+n*s),value=gray[y*w+x];
   const delta=value-lastValue,sign=delta>5?1:delta<-5?-1:0;
   if(n>-15&&sign){if(lastSign&&lastSign!==sign)changes++;lastSign=sign;}lastValue=value;
  }
  // A screen edge or book outline is coherent but is not alternating bars.
  if(changes<4)continue;
  tiles.set(ty*cols+tx,{tx,ty,angle,score:coherence*energy});
 }
 const regions=[];
 for(const [key,first]of tiles){
  tiles.delete(key);const group=[first];let score=0,cos=0,sin=0,l=w,r=0,t=h,b=0;
  for(let i=0;i<group.length;i++){
   const tile=group[i];score+=tile.score;cos+=Math.cos(2*tile.angle)*tile.score;sin+=Math.sin(2*tile.angle)*tile.score;
   l=Math.min(l,tile.tx*step);r=Math.max(r,tile.tx*step+size);t=Math.min(t,tile.ty*step);b=Math.max(b,tile.ty*step+size);
   for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){
    const nx=tile.tx+dx,ny=tile.ty+dy;if(nx<0||nx>=cols||ny<0||ny>=rows)continue;
    const k=ny*cols+nx,other=tiles.get(k);
    if(other&&Math.cos(2*(other.angle-tile.angle))>0.85){tiles.delete(k);group.push(other);}
   }
  }
  if(group.length<3)continue;
  regions.push({left:Math.max(0,l-24),top:Math.max(0,t-24),right:Math.min(w,r+24),bottom:Math.min(h,b+24),angle:Math.atan2(sin,cos)/2,score});
 }
 return regions.sort((a,b)=>b.score-a.score).slice(0,12);
}

export function alignBarcode(image,region) {
 const {left,top,right,bottom,angle}=region,c=Math.cos(angle),s=Math.sin(angle),rw=right-left,rh=bottom-top;
 const scale=2,width=Math.ceil((Math.abs(c)*rw+Math.abs(s)*rh)*scale),height=Math.ceil((Math.abs(s)*rw+Math.abs(c)*rh)*scale),data=new Uint8ClampedArray(width*height*4);
 const cx=(left+right)/2,cy=(top+bottom)/2;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const dx=(x-width/2)/scale,dy=(y-height/2)/scale,sx=cx+c*dx-s*dy,sy=cy+s*dx+c*dy,p=(y*width+x)*4;
  if(sx<left||sx>=right||sy<top||sy>=bottom){data[p]=data[p+1]=data[p+2]=data[p+3]=255;continue;}
  const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
  const q=(iy*image.width+ix)*4,qx=(iy*image.width+Math.min(image.width-1,ix+1))*4,qy=(Math.min(image.height-1,iy+1)*image.width+ix)*4,qxy=(Math.min(image.height-1,iy+1)*image.width+Math.min(image.width-1,ix+1))*4;
  for(let k=0;k<3;k++)data[p+k]=(image.data[q+k]*(1-fx)+image.data[qx+k]*fx)*(1-fy)+(image.data[qy+k]*(1-fx)+image.data[qxy+k]*fx)*fy;
  data[p+3]=255;
 }
 return {data,width,height};
}
