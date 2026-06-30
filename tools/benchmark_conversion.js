#!/usr/bin/env node
const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');
const PETSCIICore=require('../petscii-core.js');
const ROM=require('../petscii-rom.js');

function run(cmd,args,input){
  const res=spawnSync(cmd,args,{input,maxBuffer:1024*1024*64});
  if(res.status!==0) throw new Error(`${cmd} failed: ${res.stderr.toString()}`);
  return res.stdout;
}
function imageSize(file){
  const out=run('identify',['-format','%w %h',file]).toString().trim().split(/\s+/).map(Number);
  return {width:out[0],height:out[1]};
}
function readRgba(file,width,height){
  const raw=run('convert',[file,'-resize',`${width}x${height}!`,'rgba:-']);
  return new Uint8ClampedArray(raw.buffer,raw.byteOffset,raw.length);
}
function writePng(file,width,height,data){
  run('convert',['-size',`${width}x${height}`,'-depth','8','rgba:-',file],Buffer.from(data));
}
function rgbAt(data,i){return [data[i],data[i+1],data[i+2]];}
function lum(r,g,b){return .299*r+.587*g+.114*b;}
function luma(data,w,h){
  const out=new Float32Array(w*h);
  for(let p=0,i=0;p<out.length;p++,i+=4) out[p]=lum(data[i],data[i+1],data[i+2]);
  return out;
}
function sobel(data,w,h){
  const y=luma(data,w,h),mag=new Float32Array(w*h),gxv=new Float32Array(w*h),gyv=new Float32Array(w*h);
  const get=(x,yy)=>y[Math.max(0,Math.min(h-1,yy))*w+Math.max(0,Math.min(w-1,x))];
  for(let yy=0;yy<h;yy++)for(let x=0;x<w;x++){
    const gx=(get(x+1,yy-1)+2*get(x+1,yy)+get(x+1,yy+1))-(get(x-1,yy-1)+2*get(x-1,yy)+get(x-1,yy+1));
    const gy=(get(x-1,yy+1)+2*get(x,yy+1)+get(x+1,yy+1))-(get(x-1,yy-1)+2*get(x,yy-1)+get(x+1,yy-1));
    const p=yy*w+x;gxv[p]=gx;gyv[p]=gy;mag[p]=Math.sqrt(gx*gx+gy*gy);
  }
  return {mag,gx:gxv,gy:gyv};
}
function percentile(arr,p){
  const a=Array.from(arr).sort((x,y)=>x-y);
  return a[Math.min(a.length-1,Math.max(0,Math.floor((a.length-1)*p/100)))];
}
function meanStd(arr){
  let s=0,s2=0;for(const v of arr){s+=v;s2+=v*v;}
  const m=s/arr.length;return [m,Math.sqrt(Math.max(0,s2/arr.length-m*m))];
}
function crop(data,w,h,roi){
  if(!roi) return {data,w,h};
  const [y0,y1,x0,x1]=roi,ww=x1-x0,hh=y1-y0,out=new Uint8ClampedArray(ww*hh*4);
  for(let y=0;y<hh;y++)for(let x=0;x<ww;x++){
    const si=((y+y0)*w+x+x0)*4,di=(y*ww+x)*4;
    out[di]=data[si];out[di+1]=data[si+1];out[di+2]=data[si+2];out[di+3]=255;
  }
  return {data:out,w:ww,h:hh};
}
function dilate(mask,w,h){
  const out=new Uint8Array(mask.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let v=0;
    for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
      const xx=x+ox,yy=y+oy;if(xx>=0&&yy>=0&&xx<w&&yy<h&&mask[yy*w+xx])v=1;
    }
    out[y*w+x]=v;
  }
  return out;
}
function edgeF1(ref,out,w,h,roi){
  const r=crop(ref,w,h,roi),o=crop(out,w,h,roi);
  const rs=sobel(r.data,r.w,r.h),os=sobel(o.data,o.w,o.h);
  const [rm,rsd]=meanStd(rs.mag),[om,osd]=meanStd(os.mag);
  const rt=Math.max(percentile(rs.mag,72),rm+rsd*.25),ot=Math.max(percentile(os.mag,68),om+osd*.15);
  const re=new Uint8Array(rs.mag.length),oe=new Uint8Array(os.mag.length);
  let rc=0,oc=0;
  for(let i=0;i<re.length;i++){if(rs.mag[i]>rt){re[i]=1;rc++;}if(os.mag[i]>ot){oe[i]=1;oc++;}}
  if(!rc||!oc) return 0;
  const rd=dilate(re,r.w,r.h),od=dilate(oe,o.w,o.h);
  let rec=0,pre=0;
  for(let i=0;i<re.length;i++){if(re[i]&&od[i])rec++;if(oe[i]&&rd[i])pre++;}
  const recall=rec/rc,precision=pre/oc;
  return 2*precision*recall/(precision+recall+1e-9);
}
function orientationSimilarity(ref,out,w,h,roi){
  function hist(data,w,h){
    const s=sobel(data,w,h),[m,sd]=meanStd(s.mag),th=Math.max(percentile(s.mag,72),m+sd*.25),histo=[0,0,0,0];
    for(let i=0;i<s.mag.length;i++){
      if(s.mag[i]<=th) continue;
      let a=((Math.atan2(s.gy[i],s.gx[i])%Math.PI)+Math.PI)%Math.PI;
      const bin=a<Math.PI/8||a>=7*Math.PI/8?0:a<3*Math.PI/8?2:a<5*Math.PI/8?1:3;
      histo[bin]+=s.mag[i];
    }
    const sum=histo.reduce((a,b)=>a+b,0)||1;
    return histo.map(v=>v/sum);
  }
  const r=crop(ref,w,h,roi),o=crop(out,w,h,roi),rh=hist(r.data,r.w,r.h),oh=hist(o.data,o.w,o.h);
  return Math.max(0,1-(Math.abs(rh[0]-oh[0])+Math.abs(rh[1]-oh[1])+Math.abs(rh[2]-oh[2])+Math.abs(rh[3]-oh[3]))/2);
}
function blockSsim(ref,out,w,h){
  const a=luma(ref,w,h),b=luma(out,w,h),vals=[],c1=.0001,c2=.0009;
  for(let y=0;y+8<=h;y+=8)for(let x=0;x+8<=w;x+=8){
    let ma=0,mb=0;for(let yy=0;yy<8;yy++)for(let xx=0;xx<8;xx++){const p=(y+yy)*w+x+xx;ma+=a[p]/255;mb+=b[p]/255;}ma/=64;mb/=64;
    let va=0,vb=0,cov=0;for(let yy=0;yy<8;yy++)for(let xx=0;xx<8;xx++){const p=(y+yy)*w+x+xx,aa=a[p]/255-ma,bb=b[p]/255-mb;va+=aa*aa;vb+=bb*bb;cov+=aa*bb;}va/=64;vb/=64;cov/=64;
    vals.push(((2*ma*mb+c1)*(2*cov+c2))/((ma*ma+mb*mb+c1)*(va+vb+c2)));
  }
  return vals.reduce((a,b)=>a+b,0)/vals.length;
}
function composite(ref,out,w,h,meta,core,roi){
  let detail=1,clutter=0,glyphEdgeRatio=0,detailCells=0,solid=0,quietCells=0,quietClutter=0;
  if(meta&&meta.screenCodes&&meta.screenCodes.length){
    const gm=core.getMeta('set1',true);
    const rs=sobel(ref,w,h);
    for(let cy=0;cy<meta.rows;cy++)for(let cx=0;cx<meta.cols;cx++){
      let mass=0;for(let y=0;y<8;y++)for(let x=0;x<8;x++)mass+=rs.mag[(cy*8+y)*w+cx*8+x];
      mass/=64*255;
      const m=gm[meta.screenCodes[cy*meta.cols+cx]];
      glyphEdgeRatio+=m.edges;
      if(mass>.08){detailCells++;if(m.fill>.96||m.fill<.04||m.edges<.035)solid++;}
      if(mass<.045){
        quietCells++;
        if(m.edges>.20&&m.fill>.08&&m.fill<.88)quietClutter++;
      }
    }
    if(detailCells)detail=1-solid/detailCells;
    glyphEdgeRatio/=meta.screenCodes.length;
    clutter=quietCells?quietClutter/quietCells:0;
  }
  const ssim=blockSsim(ref,out,w,h);
  const edge=edgeF1(ref,out,w,h);
  const face=edgeF1(ref,out,w,h,roi);
  const orient=orientationSimilarity(ref,out,w,h);
  const fidelity=.62*ssim+.20*face+.18*edge;
  const structure=.38*edge+.34*face+.20*orient+.08*detail;
  const readability=Math.max(0,.42*ssim+.22*face+.16*edge+.10*orient+.10*detail-.22*clutter);
  return {
    score:.30*fidelity+.32*structure+.38*readability,
    fidelity,structure,readability,
    ssim,edge_f1:edge,face_edge_f1:face,orientation:orient,
    detail_nonblock:detail,clutter,glyph_edge_ratio:glyphEdgeRatio
  };
}
function colorErr(rgb,c){
  const dl=(lum(rgb[0],rgb[1],rgb[2])-lum(c[0],c[1],c[2]))/255;
  const dr=(rgb[0]-c[0])/255,dg=(rgb[1]-c[1])/255,db=(rgb[2]-c[2])/255;
  return .72*dl*dl+.28*(dr*dr+dg*dg+db*db)/3;
}
function oracle(ref,w,h,cols,rows,pal,bg){
  const out=new Uint8ClampedArray(ref.length);
  for(let cy=0;cy<rows;cy++)for(let cx=0;cx<cols;cx++){
    let bestFg=bg,best=1e99;
    for(let fg=0;fg<16;fg++){
      if(fg===bg)continue;
      let s=0;
      for(let y=0;y<8;y++)for(let x=0;x<8;x++){
        const i=((cy*8+y)*w+cx*8+x)*4,rgb=rgbAt(ref,i);
        s+=Math.min(colorErr(rgb,pal[bg]),colorErr(rgb,pal[fg]));
      }
      if(s<best){best=s;bestFg=fg;}
    }
    for(let y=0;y<8;y++)for(let x=0;x<8;x++){
      const i=((cy*8+y)*w+cx*8+x)*4,rgb=rgbAt(ref,i);
      const c=colorErr(rgb,pal[bestFg])<colorErr(rgb,pal[bg])?pal[bestFg]:pal[bg];
      out[i]=c[0];out[i+1]=c[1];out[i+2]=c[2];out[i+3]=255;
    }
  }
  return out;
}
function parseArgs(){
  const args={image:'/home/g3ol4d0/Downloads/casemiro.webp',cols:40,palette:'pepto',outDir:'/tmp/petsciinator-benchmark'};
  for(let i=2;i<process.argv.length;i++){
    const a=process.argv[i];
    if(a==='--cols')args.cols=+process.argv[++i];
    else if(a==='--palette')args.palette=process.argv[++i];
    else if(a==='--out-dir')args.outDir=process.argv[++i];
    else if(a==='--local-bg')args.localBg=true;
    else args.image=a;
  }
  return args;
}
function main(){
  const args=parseArgs(),src=imageSize(args.image),rows=Math.max(1,Math.round(args.cols*src.height/src.width));
  const width=args.cols*8,height=rows*8,ref=readRgba(args.image,width,height);
  const srcRgba=readRgba(args.image,src.width,src.height);
  const core=PETSCIICore.create({upperRomBase64:ROM.UP_B64,lowerRomBase64:ROM.LOW_B64});
  const common={cols:args.cols,rows,palette:args.palette,mode:'petscii',charset:'set1',useInverse:true,autoMatch:true,charBias:0,edgeWeight:2,shapeWeight:0,orientWeight:0,localBackground:!!args.localBg};
  const legacy=core.convertImageData({data:srcRgba,width:src.width,height:src.height},{...common,algorithm:'legacy'});
  const visual=core.convertImageData({data:srcRgba,width:src.width,height:src.height},{...common,algorithm:'visual'});
  const chung=core.convertImageData({data:srcRgba,width:src.width,height:src.height},{...common,algorithm:'chung'});
  const auto=core.convertImageData({data:srcRgba,width:src.width,height:src.height},{...common,algorithm:'auto'});
  const oracleImg=oracle(ref,width,height,args.cols,rows,PETSCIICore.PALETTES[args.palette],visual.bg);
  const roi=[Math.floor(height*.04),Math.floor(height*.56),Math.floor(width*.28),Math.floor(width*.60)];
  const legacyM=composite(ref,legacy.data,width,height,legacy,core,roi);
  const visualM=composite(ref,visual.data,width,height,visual,core,roi);
  const chungM=composite(ref,chung.data,width,height,chung,core,roi);
  const autoM=composite(ref,auto.data,width,height,auto,core,roi);
  const oracleM=composite(ref,oracleImg,width,height,null,core,roi);
  const normalizedScore=m=>Math.min(100,m.score/oracleM.score*100);
  const scoreBreakdown=m=>({
    aggregate:normalizedScore(m),
    fidelity:Math.min(100,m.fidelity/oracleM.fidelity*100),
    structure:Math.min(100,m.structure/oracleM.structure*100),
    readability:Math.min(100,m.readability/oracleM.readability*100)
  });
  const legacyScore=normalizedScore(legacyM);
  const visualScore=normalizedScore(visualM);
  const chungScore=normalizedScore(chungM);
  const autoScore=normalizedScore(autoM);
  fs.mkdirSync(args.outDir,{recursive:true});
  writePng(path.join(args.outDir,'reference.png'),width,height,ref);
  writePng(path.join(args.outDir,'legacy.png'),width,height,legacy.data);
  writePng(path.join(args.outDir,'visual.png'),width,height,visual.data);
  writePng(path.join(args.outDir,'chung.png'),width,height,chung.data);
  writePng(path.join(args.outDir,'auto.png'),width,height,auto.data);
  writePng(path.join(args.outDir,'oracle.png'),width,height,oracleImg);
  console.log(JSON.stringify({
    image:args.image,cols:args.cols,rows,palette:args.palette,local_background:!!args.localBg,
    score_legacy:legacyScore,
    score_visual:visualScore,
    score_chung:chungScore,
    score_auto:autoScore,
    scores:{
      legacy:scoreBreakdown(legacyM),
      visual:scoreBreakdown(visualM),
      chung:scoreBreakdown(chungM),
      auto:scoreBreakdown(autoM),
      oracle:scoreBreakdown(oracleM)
    },
    score_delta_visual:visualScore-legacyScore,
    score_delta_chung:chungScore-legacyScore,
    score_delta_auto:autoScore-legacyScore,
    background_legacy:legacy.bg,
    background_visual:visual.bg,
    background_chung:chung.bg,
    background_auto:auto.bg,
    metrics_legacy:legacyM,
    metrics_visual:visualM,
    metrics_chung:chungM,
    metrics_auto:autoM,
    metrics_oracle:oracleM,
    previews:{
      reference:path.join(args.outDir,'reference.png'),
      legacy:path.join(args.outDir,'legacy.png'),
      visual:path.join(args.outDir,'visual.png'),
      chung:path.join(args.outDir,'chung.png'),
      auto:path.join(args.outDir,'auto.png'),
      oracle:path.join(args.outDir,'oracle.png')
    }
  },null,2));
}
main();
