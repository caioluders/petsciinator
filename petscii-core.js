(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.PETSCIICore=factory();
})(typeof self!=='undefined'?self:this,function(){
  const CW=8,CH=8;
  const PALETTES={
    pepto:[[0,0,0],[255,255,255],[104,55,43],[112,164,178],[111,61,134],[88,141,67],
      [53,40,121],[184,199,111],[111,79,37],[67,57,0],[154,103,89],[68,68,68],
      [108,108,108],[154,210,132],[108,94,181],[149,149,149]],
    colodore:[[0,0,0],[255,255,255],[129,51,43],[112,190,200],[127,57,151],[86,168,67],
      [42,41,148],[221,232,124],[133,76,17],[88,57,0],[178,98,89],[74,74,74],
      [123,123,123],[154,226,123],[105,103,209],[173,173,173]],
    gray:null
  };
  PALETTES.gray=Array.from({length:16},(_,i)=>{const v=Math.round(i/15*255);return [Math.round(v*.25),v,Math.round(v*.35)];});
  const AUTO_PROFILES={flat:[0,0,0],line:[1,5,30],region:[3,1,6],texture:[0,0,0]};
  const VISUAL_PROFILES={flat:[.35,0,0,2],line:[3.8,4.5,22,18],region:[2.2,1.6,7,9],texture:[1.1,.5,3,4]};
  const CLEAN_PROFILES={flat:[.12,0,0,1.2],line:[2.3,2.8,12,10],region:[.9,.45,2.2,6],texture:[.18,0,0,4]};
  const BAYER4=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];

  const lum=(r,g,b)=>0.299*r+0.587*g+0.114*b;
  const clamp01=v=>v<0?0:v>1?1:v;
  function decodeBase64(b64){
    if(typeof atob==='function') return atob(b64);
    return Buffer.from(b64,'base64').toString('binary');
  }
  function decodeCharset(b64){
    const raw=decodeBase64(b64),bank=[];
    for(let c=0;c<256;c++){
      const m=new Uint8Array(64);
      for(let r=0;r<8;r++){
        const byte=raw.charCodeAt(c*8+r);
        for(let x=0;x<8;x++) m[r*8+x]=(byte>>(7-x))&1;
      }
      bank.push(m);
    }
    return bank;
  }
  function withReverse(bank128){
    const full=bank128.slice(0,128);
    for(let c=0;c<128;c++){
      const inv=new Uint8Array(64);
      for(let p=0;p<64;p++) inv[p]=bank128[c][p]?0:1;
      full.push(inv);
    }
    return full;
  }
  function distTransform(bits){
    const INF=99,d=new Float32Array(64).fill(INF);
    for(let p=0;p<64;p++) if(bits[p]) d[p]=0;
    for(let y=0;y<8;y++)for(let x=0;x<8;x++){const p=y*8+x;
      if(x>0)d[p]=Math.min(d[p],d[p-1]+1);
      if(y>0)d[p]=Math.min(d[p],d[p-8]+1);
      if(x>0&&y>0)d[p]=Math.min(d[p],d[p-9]+1.4);
      if(x<7&&y>0)d[p]=Math.min(d[p],d[p-7]+1.4);}
    for(let y=7;y>=0;y--)for(let x=7;x>=0;x--){const p=y*8+x;
      if(x<7)d[p]=Math.min(d[p],d[p+1]+1);
      if(y<7)d[p]=Math.min(d[p],d[p+8]+1);
      if(x<7&&y<7)d[p]=Math.min(d[p],d[p+9]+1.4);
      if(x>0&&y<7)d[p]=Math.min(d[p],d[p+7]+1.4);}
    return d;
  }
  function orientHist(bits){
    const hg=[0,0,0,0];
    for(let y=0;y<8;y++)for(let x=0;x<8;x++){
      const g=(xx,yy)=>(xx<0||yy<0||xx>7||yy>7)?0:bits[yy*8+xx];
      const gx=(g(x+1,y-1)+2*g(x+1,y)+g(x+1,y+1))-(g(x-1,y-1)+2*g(x-1,y)+g(x-1,y+1));
      const gy=(g(x-1,y+1)+2*g(x,y+1)+g(x+1,y+1))-(g(x-1,y-1)+2*g(x,y-1)+g(x+1,y-1));
      const mag=Math.abs(gx)+Math.abs(gy); if(mag<1) continue;
      let a=((Math.atan2(gy,gx)%Math.PI)+Math.PI)%Math.PI;
      const bin=a<Math.PI/8||a>=7*Math.PI/8?0:a<3*Math.PI/8?2:a<5*Math.PI/8?1:3;
      hg[bin]+=mag;
    }
    const s=hg[0]+hg[1]+hg[2]+hg[3]||1;
    return hg.map(v=>v/s);
  }
  function angleDelta(a,b){
    let d=Math.abs(a-b)%Math.PI;
    return d>Math.PI/2?Math.PI-d:d;
  }
  function pixelOrientations(bits){
    const theta=new Float32Array(64),valid=new Uint8Array(64);
    const g=(x,y)=>(x<0||y<0||x>7||y>7)?0:bits[y*8+x];
    for(let y=0;y<8;y++)for(let x=0;x<8;x++){
      const p=y*8+x;
      if(!bits[p]) continue;
      let vx=0,vy=0,energy=0;
      for(let oy=-2;oy<=2;oy++)for(let ox=-2;ox<=2;ox++){
        const xx=x+ox,yy=y+oy;
        const gx=(g(xx+1,yy-1)+3*g(xx+1,yy)+g(xx+1,yy+1))-(g(xx-1,yy-1)+3*g(xx-1,yy)+g(xx-1,yy+1));
        const gy=(g(xx-1,yy+1)+3*g(xx,yy+1)+g(xx+1,yy+1))-(g(xx-1,yy-1)+3*g(xx,yy-1)+g(xx+1,yy-1));
        vx+=gx*gx-gy*gy;vy+=2*gx*gy;energy+=Math.abs(gx)+Math.abs(gy);
      }
      if(energy>.5){theta[p]=((.5*Math.atan2(vy,vx))%Math.PI+Math.PI)%Math.PI;valid[p]=1;}
    }
    return {theta,valid};
  }
  function chamferDist(aB,aD,bB,bD){
    let s=0,n=0;
    for(let p=0;p<64;p++){if(aB[p]){s+=bD[p];n++;} if(bB[p]){s+=aD[p];n++;}}
    return n?s/n:0;
  }
  function meta(bank){
    return bank.map(bits=>{
      let f=0,edges=0;const q=[0,0,0,0];
      for(let p=0;p<64;p++) if(bits[p]){f++;q[((p>>3)<4?0:2)+((p&7)<4?0:1)]++;}
      for(let y=0;y<8;y++)for(let x=0;x<8;x++){
        const v=bits[y*8+x];
        if(x<7&&v!==bits[y*8+x+1]) edges++;
        if(y<7&&v!==bits[(y+1)*8+x]) edges++;
      }
      const emap=new Uint8Array(64);
      for(let y=0;y<8;y++)for(let x=0;x<8;x++){
        const v=bits[y*8+x];
        if((x<7&&bits[y*8+x+1]!==v)||(x>0&&bits[y*8+x-1]!==v)||
           (y<7&&bits[(y+1)*8+x]!==v)||(y>0&&bits[(y-1)*8+x]!==v)) emap[y*8+x]=1;
      }
      const po=pixelOrientations(bits);
      return {bits,emap,fill:f/64,q:q.map(v=>v/16),edges:edges/112,
              dt:distTransform(bits),edt:distTransform(emap),orient:orientHist(bits),
              theta:po.theta,thetaValid:po.valid};
    });
  }
  function paletteDistance(r,g,b,c){
    const pr=c[0],pg=c[1],pb=c[2],dl=(lum(r,g,b)-lum(pr,pg,pb))/255;
    const dr=(r-pr)/255,dg=(g-pg)/255,db=(b-pb)/255;
    return .72*dl*dl+.28*(dr*dr+dg*dg+db*db)/3;
  }
  function nearest(pal,r,g,b){let bi=0,bd=1e9;for(let i=0;i<pal.length;i++){const d=paletteDistance(r,g,b,pal[i]);if(d<bd){bd=d;bi=i;}}return bi;}
  function colorErr(data,i,c){
    return paletteDistance(data[i],data[i+1],data[i+2],c);
  }
  function paletteContrast(pal,a,b){return Math.abs(lum(...pal[a])-lum(...pal[b]))/255;}
  function pushUnique(a,v){if(v>=0&&!a.includes(v))a.push(v);}
  function topIndex(hist,skip=-1){let bi=-1,bv=-1;for(let i=0;i<hist.length;i++)if(i!==skip&&hist[i]>bv){bv=hist[i];bi=i;}return bi;}
  function orientBinAngle(bin){return bin===0?0:bin===1?Math.PI/2:bin===2?Math.PI/4:3*Math.PI/4;}
  function angleToOrientBin(a){return a<Math.PI/8||a>=7*Math.PI/8?0:a<3*Math.PI/8?2:a<5*Math.PI/8?1:3;}
  function max4(a){return Math.max(a[0],a[1],a[2],a[3]);}
  function resampleImageData(image,w,h){
    if(image.width===w&&image.height===h) return new Uint8ClampedArray(image.data.slice?image.data.slice(0,w*h*4):Array.from(image.data).slice(0,w*h*4));
    const out=new Uint8ClampedArray(w*h*4),src=image.data,sw=image.width,sh=image.height;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const sx0=x*sw/w,sx1=(x+1)*sw/w,sy0=y*sh/h,sy1=(y+1)*sh/h;
      const x0=Math.max(0,Math.floor(sx0)),x1=Math.min(sw,Math.ceil(sx1));
      const y0=Math.max(0,Math.floor(sy0)),y1=Math.min(sh,Math.ceil(sy1));
      const di=(y*w+x)*4;
      let r=0,g=0,b=0,a=0,area=0;
      for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++){
        const px0=xx,px1=xx+1,py0=yy,py1=yy+1;
        const wt=Math.max(0,Math.min(sx1,px1)-Math.max(sx0,px0))*Math.max(0,Math.min(sy1,py1)-Math.max(sy0,py0));
        if(!wt)continue;
        const si=(yy*sw+xx)*4;r+=src[si]*wt;g+=src[si+1]*wt;b+=src[si+2]*wt;a+=src[si+3]*wt;area+=wt;
      }
      area=area||1;out[di]=r/area;out[di+1]=g/area;out[di+2]=b/area;out[di+3]=a/area||255;
    }
    return out;
  }
  function sourceCellBounds(ctx,cx,cy,phaseX=0,phaseY=0){
    const cellW=ctx.width/ctx.cols,cellH=ctx.height/ctx.rows;
    const sx0=cx*cellW+phaseX*cellW,sx1=(cx+1)*cellW+phaseX*cellW;
    const sy0=cy*cellH+phaseY*cellH,sy1=(cy+1)*cellH+phaseY*cellH;
    return {
      sx0,sx1,sy0,sy1,w:Math.max(1e-6,sx1-sx0),h:Math.max(1e-6,sy1-sy0),
      x0:Math.max(0,Math.floor(sx0)),x1:Math.min(ctx.width,Math.max(Math.floor(sx0)+1,Math.ceil(sx1))),
      y0:Math.max(0,Math.floor(sy0)),y1:Math.min(ctx.height,Math.max(Math.floor(sy0)+1,Math.ceil(sy1)))
    };
  }
  function sourceSlot(bounds,xx,yy){
    const x=Math.max(0,Math.min(7,Math.floor(((xx+.5)-bounds.sx0)*8/bounds.w)));
    const y=Math.max(0,Math.min(7,Math.floor(((yy+.5)-bounds.sy0)*8/bounds.h)));
    return y*8+x;
  }
  function normalizePoints(points,minX,maxX,minY,maxY){
    if(points.length<6) return null;
    const bw=Math.max(1,maxX-minX+1),bh=Math.max(1,maxY-minY+1),bits=new Uint8Array(64);
    for(let i=0;i<points.length;i+=2){
      const x=points[i],y=points[i+1];
      const nx=Math.max(0,Math.min(7,Math.floor(((x-minX)+.5)*8/bw)));
      const ny=Math.max(0,Math.min(7,Math.floor(((y-minY)+.5)*8/bh)));
      bits[ny*8+nx]=1;
    }
    let count=0;for(let p=0;p<64;p++)count+=bits[p];
    if(count<2) return null;
    return {bits,dt:distTransform(bits),fill:count/64,count};
  }
  function overlapWeight(bounds,xx,yy){
    return Math.max(0,Math.min(bounds.sx1,xx+1)-Math.max(bounds.sx0,xx))*
           Math.max(0,Math.min(bounds.sy1,yy+1)-Math.max(bounds.sy0,yy));
  }
  function poolFeaturesToTarget(feat,srcW,srcH,w,h){
    if(srcW===w&&srcH===h) return feat;
    const edge=new Float32Array(w*h),orient=new Uint8Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const x0=Math.floor(x*srcW/w),x1=Math.max(x0+1,Math.ceil((x+1)*srcW/w));
      const y0=Math.floor(y*srcH/h),y1=Math.max(y0+1,Math.ceil((y+1)*srcH/h));
      let maxe=0,vx=0,vy=0;
      for(let yy=y0;yy<Math.min(srcH,y1);yy++)for(let xx=x0;xx<Math.min(srcW,x1);xx++){
        const si=yy*srcW+xx,e=feat.edge[si];
        if(e>maxe)maxe=e;
        if(e>.02){const a=orientBinAngle(feat.orient[si]);vx+=Math.cos(2*a)*e;vy+=Math.sin(2*a)*e;}
      }
      const p=y*w+x;
      edge[p]=maxe;
      let a=((.5*Math.atan2(vy,vx))%Math.PI+Math.PI)%Math.PI;
      orient[p]=angleToOrientBin(a);
    }
    return {edge,orient};
  }
  function poolStructureToTarget(st,srcW,srcH,w,h){
    if(srcW===w&&srcH===h) return st;
    const line=new Uint8Array(w*h),value=new Float32Array(w*h),theta=new Float32Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const x0=Math.floor(x*srcW/w),x1=Math.max(x0+1,Math.ceil((x+1)*srcW/w));
      const y0=Math.floor(y*srcH/h),y1=Math.max(y0+1,Math.ceil((y+1)*srcH/h));
      let maxv=0,vx=0,vy=0,on=0;
      for(let yy=y0;yy<Math.min(srcH,y1);yy++)for(let xx=x0;xx<Math.min(srcW,x1);xx++){
        const si=yy*srcW+xx;
        if(!st.line[si])continue;
        const v=st.value[si]||1,a=st.theta[si];
        on=1;if(v>maxv)maxv=v;
        vx+=Math.cos(2*a)*v;vy+=Math.sin(2*a)*v;
      }
      const p=y*w+x;
      if(on){line[p]=1;value[p]=maxv;theta[p]=((.5*Math.atan2(vy,vx))%Math.PI+Math.PI)%Math.PI;}
    }
    return {line,value,theta};
  }
  function sourceFeatures(data,w,h){
    const n=w*h,luma=new Float32Array(n),smooth=new Float32Array(n),edge=new Float32Array(n),orient=new Uint8Array(n);
    for(let i=0,p=0;p<n;p++,i+=4) luma[p]=lum(data[i],data[i+1],data[i+2]);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let s=0,ws=0;
      for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
        const xx=Math.max(0,Math.min(w-1,x+ox)),yy=Math.max(0,Math.min(h-1,y+oy));
        const wt=(ox===0&&oy===0)?4:(ox===0||oy===0)?2:1;
        s+=luma[yy*w+xx]*wt;ws+=wt;
      }
      smooth[y*w+x]=s/ws;
    }
    let mean=0,mean2=0;const mags=new Float32Array(n);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const p=y*w+x,g=(xx,yy)=>smooth[Math.max(0,Math.min(h-1,yy))*w+Math.max(0,Math.min(w-1,xx))];
      const gx=(g(x+1,y-1)+2*g(x+1,y)+g(x+1,y+1))-(g(x-1,y-1)+2*g(x-1,y)+g(x-1,y+1));
      const gy=(g(x-1,y+1)+2*g(x,y+1)+g(x+1,y+1))-(g(x-1,y-1)+2*g(x,y-1)+g(x+1,y-1));
      const mag=Math.sqrt(gx*gx+gy*gy);mags[p]=mag;mean+=mag;mean2+=mag*mag;
      let a=((Math.atan2(gy,gx)%Math.PI)+Math.PI)%Math.PI;
      orient[p]=a<Math.PI/8||a>=7*Math.PI/8?0:a<3*Math.PI/8?2:a<5*Math.PI/8?1:3;
    }
    mean/=n;const sd=Math.sqrt(Math.max(0,mean2/n-mean*mean)),lo=mean+sd*.15,scale=1/(sd*1.9+20);
    for(let p=0;p<n;p++) edge[p]=clamp01((mags[p]-lo)*scale);
    return {edge,orient};
  }
  function chooseAutoAlgorithm(data,feat,w,h){
    let edgeMass=0,strong=0,vx=0,vy=0,l=0,l2=0;
    const n=w*h;
    for(let p=0,i=0;p<n;p++,i+=4){
      const e=feat.edge[p],a=orientBinAngle(feat.orient[p]),yy=lum(data[i],data[i+1],data[i+2]);
      edgeMass+=e;if(e>.16)strong++;
      vx+=Math.cos(2*a)*e;vy+=Math.sin(2*a)*e;
      l+=yy;l2+=yy*yy;
    }
    edgeMass/=n;
    const coherence=Math.sqrt(vx*vx+vy*vy)/(edgeMass*n+1e-6),strongRatio=strong/n;
    const mean=l/n,lumaSd=Math.sqrt(Math.max(0,l2/n-mean*mean));
    return edgeMass>.035&&strongRatio<.18&&coherence>.58&&lumaSd<62?'chung':'visual';
  }
  function structureTensorFeatures(data,w,h){
    const n=w*h,luma=new Float32Array(n),blur=new Float32Array(n);
    for(let i=0,p=0;p<n;p++,i+=4) luma[p]=lum(data[i],data[i+1],data[i+2]);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const get=(xx,yy)=>luma[Math.max(0,Math.min(h-1,yy))*w+Math.max(0,Math.min(w-1,xx))];
      blur[y*w+x]=(get(x-1,y-1)+2*get(x,y-1)+get(x+1,y-1)+2*get(x-1,y)+4*get(x,y)+2*get(x+1,y)+get(x-1,y+1)+2*get(x,y+1)+get(x+1,y+1))/16;
    }
    const gxv=new Float32Array(n),gyv=new Float32Array(n),mag=new Float32Array(n),theta=new Float32Array(n);
    const get=(x,y)=>blur[Math.max(0,Math.min(h-1,y))*w+Math.max(0,Math.min(w-1,x))];
    let mean=0,mean2=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const p=y*w+x;
      const gx=3*(get(x+1,y-1)-get(x-1,y-1))+10*(get(x+1,y)-get(x-1,y))+3*(get(x+1,y+1)-get(x-1,y+1));
      const gy=3*(get(x-1,y+1)-get(x-1,y-1))+10*(get(x,y+1)-get(x,y-1))+3*(get(x+1,y+1)-get(x+1,y-1));
      gxv[p]=gx;gyv[p]=gy;const m=Math.sqrt(gx*gx+gy*gy);mag[p]=m;mean+=m;mean2+=m*m;
    }
    mean/=n;const sd=Math.sqrt(Math.max(0,mean2/n-mean*mean));
    const line=new Uint8Array(n),value=new Float32Array(n);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let vx=0,vy=0;
      for(let oy=-2;oy<=2;oy++)for(let ox=-2;ox<=2;ox++){
        const xx=Math.max(0,Math.min(w-1,x+ox)),yy=Math.max(0,Math.min(h-1,y+oy)),p=yy*w+xx,gx=gxv[p],gy=gyv[p];
        vx+=gx*gx-gy*gy;vy+=2*gx*gy;
      }
      const p=y*w+x;
      theta[p]=((.5*Math.atan2(vy,vx))%Math.PI+Math.PI)%Math.PI;
    }
    const high=mean+sd*.52,low=mean+sd*.18;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const p=y*w+x,m=mag[p];
      let keep=m>high;
      if(!keep&&m>low){
        let linked=false;
        for(let oy=-1;oy<=1&&!linked;oy++)for(let ox=-1;ox<=1;ox++){
          const xx=x+ox,yy=y+oy;if(xx<0||yy<0||xx>=w||yy>=h)continue;
          if(mag[yy*w+xx]>high) linked=true;
        }
        keep=linked;
      }
      if(!keep) continue;
      const a=((Math.atan2(gyv[p],gxv[p])%Math.PI)+Math.PI)%Math.PI;
      const dx=Math.abs(Math.cos(a))>=Math.abs(Math.sin(a))?1:0,dy=dx?0:1;
      if(dx?m>=mag[y*w+Math.max(0,x-1)]&&m>=mag[y*w+Math.min(w-1,x+1)]:m>=mag[Math.max(0,y-1)*w+x]&&m>=mag[Math.min(h-1,y+1)*w+x]){
        line[p]=1;value[p]=clamp01((m-low)/(sd*2+1));
      }
    }
    preThin(line,w,h);
    thinLines(line,w,h);
    for(let p=0;p<n;p++) if(line[p]&&!value[p]) value[p]=1;
    return {line,value,theta};
  }
  function preThin(line,w,h){
    const copy=new Uint8Array(line);
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const p=y*w+x;if(!copy[p])continue;
      const odd=copy[(y-1)*w+x]+copy[y*w+x+1]+copy[(y+1)*w+x]+copy[y*w+x-1];
      if(odd<2)line[p]=0;else if(odd>2)line[p]=1;
    }
  }
  function thinLines(line,w,h){
    let changed=true,iter=0;
    while(changed&&iter++<18){
      changed=false;
      for(let step=0;step<2;step++){
        const del=[];
        for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
          const p=y*w+x;if(!line[p])continue;
          const p2=line[(y-1)*w+x],p3=line[(y-1)*w+x+1],p4=line[y*w+x+1],p5=line[(y+1)*w+x+1],
                p6=line[(y+1)*w+x],p7=line[(y+1)*w+x-1],p8=line[y*w+x-1],p9=line[(y-1)*w+x-1];
          const n=p2+p3+p4+p5+p6+p7+p8+p9;
          if(n<2||n>6)continue;
          const seq=[p2,p3,p4,p5,p6,p7,p8,p9,p2];
          let a=0;for(let i=0;i<8;i++)if(!seq[i]&&seq[i+1])a++;
          if(a!==1)continue;
          if(step===0){if(p2*p4*p6||p4*p6*p8)continue;}
          else if(p2*p4*p8||p2*p6*p8)continue;
          del.push(p);
        }
        if(del.length){changed=true;for(const p of del)line[p]=0;}
      }
    }
  }
  function cellStructure(feat,sw,cx,cy){
    const e=new Float32Array(64),edgeBits=new Uint8Array(64),oh=[0,0,0,0];
    let sum=0,sum2=0,maxe=0;
    for(let p=0;p<64;p++){const si=(cy*CH+(p>>3))*sw+(cx*CW+(p&7)),v=feat.edge[si];e[p]=v;sum+=v;sum2+=v*v;if(v>maxe)maxe=v;}
    const mean=sum/64,sd=Math.sqrt(Math.max(0,sum2/64-mean*mean)),threshold=Math.max(.18,Math.min(.72,mean+sd*.45));
    let count=0;
    for(let p=0;p<64;p++) if(e[p]>=threshold&&e[p]>.12){edgeBits[p]=1;count++;oh[feat.orient[(cy*CH+(p>>3))*sw+(cx*CW+(p&7))]]+=e[p]+.2;}
    const os=oh[0]+oh[1]+oh[2]+oh[3]||1;for(let i=0;i<4;i++)oh[i]/=os;
    return {edge:e,edgeBits,edgeDT:distTransform(edgeBits),orient:oh,edgeMass:sum/64,edgeCount:count,maxEdge:maxe};
  }
  function makeCandidates(hist,edgeHist,bgI,pal,meanRGB){
    const cand=[],addTop=(h,n)=>{const used=new Set([bgI]);for(let k=0;k<n;k++){let bi=-1,bv=-1;for(let i=0;i<h.length;i++)if(!used.has(i)&&h[i]>bv){bv=h[i];bi=i;}if(bi<0||bv<=0)break;used.add(bi);pushUnique(cand,bi);}};
    addTop(hist,6);addTop(edgeHist,4);pushUnique(cand,nearest(pal,meanRGB[0],meanRGB[1],meanRGB[2]));
    let contrastBest=-1,contrastScore=-1;
    for(let i=0;i<16;i++){if(i===bgI)continue;const score=(hist[i]+edgeHist[i]*2+1)*(.25+paletteContrast(pal,i,bgI));if(score>contrastScore){contrastScore=score;contrastBest=i;}}
    pushUnique(cand,contrastBest);
    const fill=new Set([bgI,...cand]);
    while(cand.length<10){let bi=-1,bv=-1;for(let i=0;i<16;i++)if(!fill.has(i)&&hist[i]>bv){bv=hist[i];bi=i;}if(bi<0)break;fill.add(bi);pushUnique(cand,bi);}
    if(!cand.length)pushUnique(cand,bgI===1?0:1);
    return cand.slice(0,10);
  }
  function scanCell(data,feat,pal,sw,cx,cy,bgI){
    const hist=new Uint16Array(16),edgeHist=new Float32Array(16),st=cellStructure(feat,sw,cx,cy);
    let mr=0,mg=0,mb=0,mt=0;
    for(let p=0;p<64;p++){
      const i=((cy*CH+(p>>3))*sw+(cx*CW+(p&7)))*4,qi=nearest(pal,data[i],data[i+1],data[i+2]),wt=1+st.edge[p]*2.5;
      hist[qi]++;edgeHist[qi]+=st.edge[p];mr+=data[i]*wt;mg+=data[i+1]*wt;mb+=data[i+2]*wt;mt+=wt;
    }
    const meanRGB=[mr/mt,mg/mt,mb/mt];
    return {hist,edgeHist,meanRGB,structure:st,candidates:makeCandidates(hist,edgeHist,bgI,pal,meanRGB)};
  }
  function scanSourceCell(ctx,pal,cx,cy,bgI,phaseX=0,phaseY=0){
    const cacheKey=bgI+','+cy+','+cx+','+phaseX+','+phaseY;
    if(ctx.cellCache&&ctx.cellCache.has(cacheKey)) return ctx.cellCache.get(cacheKey);
    const b=sourceCellBounds(ctx,cx,cy,phaseX,phaseY),hist=new Float32Array(16),edgeHist=new Float32Array(16);
    const slotWt=new Float32Array(64),edgeSum=new Float32Array(64),edgeMax=new Float32Array(64),
          vxSlot=new Float32Array(64),vySlot=new Float32Array(64);
    let mr=0,mg=0,mb=0,mt=0,samples=0,minL=255,maxL=0,darkL=1e9,brightL=-1,lSum=0,lSum2=0,rawEdgeSum=0,rawEdgeSum2=0;
    const darkRGB=[0,0,0],brightRGB=[0,0,0];
    for(let yy=b.y0;yy<b.y1;yy++)for(let xx=b.x0;xx<b.x1;xx++){
      const base=overlapWeight(b,xx,yy);if(!base)continue;
      const si=yy*ctx.width+xx,i=si*4,e=ctx.feat.edge[si],p=sourceSlot(b,xx,yy),wt=base*(1+e*2.5);
      const r=ctx.data[i],g=ctx.data[i+1],bb=ctx.data[i+2],l=lum(r,g,bb),qi=nearest(pal,r,g,bb);
      hist[qi]+=base;edgeHist[qi]+=e*base;slotWt[p]+=base;edgeSum[p]+=e*base;
      if(e>edgeMax[p])edgeMax[p]=e;
      if(e>.02){const a=orientBinAngle(ctx.feat.orient[si]);vxSlot[p]+=Math.cos(2*a)*e*base;vySlot[p]+=Math.sin(2*a)*e*base;}
      mr+=r*wt;mg+=g*wt;mb+=bb*wt;mt+=wt;samples+=base;lSum+=l*base;lSum2+=l*l*base;rawEdgeSum+=e*base;rawEdgeSum2+=e*e*base;
      if(l<minL)minL=l;if(l>maxL)maxL=l;
      if(l<darkL){darkL=l;darkRGB[0]=r;darkRGB[1]=g;darkRGB[2]=bb;}
      if(l>brightL){brightL=l;brightRGB[0]=r;brightRGB[1]=g;brightRGB[2]=bb;}
    }
    mt=mt||1;samples=samples||1;
    const edge=new Float32Array(64),edgeBits=new Uint8Array(64),oh=[0,0,0,0];
    let es=0,es2=0,maxe=0;
    for(let p=0;p<64;p++){
      if(slotWt[p]){
        edge[p]=.55*(edgeSum[p]/slotWt[p])+.45*edgeMax[p];
      }
      es+=edge[p];es2+=edge[p]*edge[p];if(edge[p]>maxe)maxe=edge[p];
      if(edge[p]>.02){
        const a=((.5*Math.atan2(vySlot[p],vxSlot[p]))%Math.PI+Math.PI)%Math.PI,bin=angleToOrientBin(a);
        oh[bin]+=edge[p]+.08;
      }
    }
    const em=es/64,esd=Math.sqrt(Math.max(0,es2/64-em*em)),threshold=Math.max(.14,Math.min(.70,em+esd*.32));
    let count=0;
    for(let p=0;p<64;p++) if(edge[p]>=threshold&&edge[p]>.095){edgeBits[p]=1;count++;}
    const os=oh[0]+oh[1]+oh[2]+oh[3]||1;for(let i=0;i<4;i++)oh[i]/=os;
    const mean=lSum/samples,sd=Math.sqrt(Math.max(0,lSum2/samples-mean*mean));
    const rawEdgeMean=rawEdgeSum/samples,rawEdgeSd=Math.sqrt(Math.max(0,rawEdgeSum2/samples-rawEdgeMean*rawEdgeMean));
    const detailPts=[];let minDX=1e9,minDY=1e9,maxDX=-1,maxDY=-1;
    const edgeThr=Math.max(.035,rawEdgeMean+rawEdgeSd*.35),lumaThr=Math.max(5,sd*.42);
    for(let yy=b.y0;yy<b.y1;yy++)for(let xx=b.x0;xx<b.x1;xx++){
      const base=overlapWeight(b,xx,yy);if(!base)continue;
      const si=yy*ctx.width+xx,i=si*4,l=lum(ctx.data[i],ctx.data[i+1],ctx.data[i+2]),e=ctx.feat.edge[si];
      if(e<=edgeThr&&Math.abs(l-mean)<=lumaThr)continue;
      detailPts.push(xx,yy);if(xx<minDX)minDX=xx;if(xx>maxDX)maxDX=xx;if(yy<minDY)minDY=yy;if(yy>maxDY)maxDY=yy;
    }
    const meanRGB=[mr/mt,mg/mt,mb/mt],structure={edge,edgeBits,edgeDT:distTransform(edgeBits),orient:oh,edgeMass:es/64,edgeCount:count,maxEdge:maxe};
    const candidates=makeCandidates(hist,edgeHist,bgI,pal,meanRGB),contrast=(maxL-minL)/255;
    if(contrast>.045){
      pushUnique(candidates,nearest(pal,darkRGB[0],darkRGB[1],darkRGB[2]));
      pushUnique(candidates,nearest(pal,brightRGB[0],brightRGB[1],brightRGB[2]));
    }
    const detailPointCount=detailPts.length/2;
    const detailNorm=detailPointCount>2&&detailPointCount<samples*.55?normalizePoints(detailPts,minDX,maxDX,minDY,maxDY):null;
    const result={bounds:b,hist,edgeHist,meanRGB,structure,candidates:candidates.slice(0,12),samples,contrast,detailNorm,phaseX,phaseY};
    if(ctx.cellCache) ctx.cellCache.set(cacheKey,result);
    return result;
  }
  function sourceEvidenceVariants(ctx,pal,cx,cy,bgI,base,enablePhase){
    if(!ctx||!base)return [];
    if(!enablePhase)return [base];
    const compact=isCompactSymbolCell(base);
    if(!compact)return [base];
    const variants=[base],offsets=[[-.33,0],[.33,0],[0,-.33],[0,.33]];
    for(const [px,py] of offsets){
      const c=scanSourceCell(ctx,pal,cx,cy,bgI,px,py);
      if(c.samples>=8&&(c.detailNorm||c.contrast>.045||c.structure.edgeCount>1))variants.push(c);
    }
    return variants;
  }
  function isCompactSymbolCell(cell){
    return !!(cell&&cell.detailNorm&&cell.detailNorm.fill>.035&&cell.detailNorm.fill<.48&&
      cell.detailNorm.count>=3&&cell.detailNorm.count<=18&&cell.contrast>.10&&cell.structure.maxEdge>.14);
  }
  function sourceFitArrays(ctx,cell,pal,cx,cy,bgI,fgI,dq){
    const b=cell.bounds,BG=pal[bgI],FG=pal[fgI],onErr=new Float32Array(64),offErr=new Float32Array(64),weights=new Float32Array(64),want=new Uint8Array(64);
    let offBase=0,wtTotal=0;
    for(let yy=b.y0;yy<b.y1;yy++)for(let xx=b.x0;xx<b.x1;xx++){
      const base=overlapWeight(b,xx,yy);if(!base)continue;
      const si=yy*ctx.width+xx,i=si*4,e=ctx.feat.edge[si],p=sourceSlot(b,xx,yy),wt=base*(1+e*3.2);
      const oe=colorErr(ctx.data,i,FG)*wt,be=colorErr(ctx.data,i,BG)*wt;
      onErr[p]+=oe;offErr[p]+=be;weights[p]+=wt;offBase+=be;wtTotal+=wt;
    }
    const norm=64/(wtTotal||1);
    offBase*=norm;
    for(let p=0;p<64;p++){
      onErr[p]*=norm;offErr[p]*=norm;weights[p]*=norm;
      if(weights[p]<=0)continue;
      if(dq<=0){want[p]=onErr[p]<offErr[p]?1:0;continue;}
      const oe=onErr[p]/weights[p],be=offErr[p]/weights[p],t=be/(oe+be+1e-6),bx=(cx*CW+(p&7))&3,by=(cy*CH+(p>>3))&3,thr=(BAYER4[by*4+bx]+.5)/16;
      want[p]=t>(.5*(1-dq)+thr*dq)?1:0;
    }
    return {onErr,offErr,weights,want,offBase};
  }
  function idealTwoColorScore(data,feat,pal,sw,cx,cy,bgI,fgI){
    const BG=pal[bgI],FG=pal[fgI];let s=0,edgeMass=0;
    for(let p=0;p<64;p++){const si=(cy*CH+(p>>3))*sw+(cx*CW+(p&7)),i=si*4,ew=feat.edge[si],wt=1+ew*2.8;s+=Math.min(colorErr(data,i,BG),colorErr(data,i,FG))*wt;edgeMass+=ew;}
    return s-edgeMass*paletteContrast(pal,bgI,fgI)*.04;
  }
  function chooseCellBackground(data,feat,pal,sw,cx,cy,sourceCtx){
    if(sourceCtx){
      const cell=scanSourceCell(sourceCtx,pal,cx,cy,0);
      let best=0,bestScore=-1;
      for(let i=0;i<16;i++){
        const score=cell.hist[i]-cell.edgeHist[i]*.25;
        if(score>bestScore){bestScore=score;best=i;}
      }
      return best;
    }
    const hist=new Float32Array(16),edgeHist=new Float32Array(16);
    for(let p=0;p<64;p++){
      const si=(cy*CH+(p>>3))*sw+(cx*CW+(p&7)),i=si*4,qi=nearest(pal,data[i],data[i+1],data[i+2]),ew=feat.edge[si];
      hist[qi]++;edgeHist[qi]+=ew;
    }
    let best=0,bestScore=-1;
    for(let i=0;i<16;i++){
      const score=hist[i]-edgeHist[i]*.25;
      if(score>bestScore){bestScore=score;best=i;}
    }
    return best;
  }
  function chooseGlobalBackground(pal,data,feat,sw,cols,rows){
    let best=0,bestScore=1e99;
    for(let bg=0;bg<16;bg++){
      let score=0,cellWins=0;
      for(let cy=0;cy<rows;cy++)for(let cx=0;cx<cols;cx++){
        const cell=scanCell(data,feat,pal,sw,cx,cy,bg);let cs=1e99;
        for(const fg of cell.candidates) if(fg!==bg) cs=Math.min(cs,idealTwoColorScore(data,feat,pal,sw,cx,cy,bg,fg));
        score+=cs;if(topIndex(cell.hist)===bg)cellWins++;
      }
      score-=cellWins*.015;if(score<bestScore){bestScore=score;best=bg;}
    }
    return best;
  }
  function classifyCell(want,wedge){
    let on=0,edges=0,trans=0;for(let p=0;p<64;p++){on+=want[p];edges+=wedge[p];}
    const fill=on/64;if(fill<.06||fill>.94)return'flat';
    for(let y=0;y<8;y++)for(let x=0;x<8;x++){const v=want[y*8+x];if(x<7&&want[y*8+x+1]!==v)trans++;if(y<7&&want[(y+1)*8+x]!==v)trans++;}
    const o=orientHist(want),thin=edges/Math.max(1,on);
    if(thin>1.4&&Math.max(o[0],o[1],o[2],o[3])>.45)return'line';
    if(trans/112>.34)return'texture';
    return'region';
  }
  function classifyVisualCell(want,wedge,st){
    let on=0,trans=0;for(let p=0;p<64;p++)on+=want[p];
    for(let y=0;y<8;y++)for(let x=0;x<8;x++){const v=want[y*8+x];if(x<7&&want[y*8+x+1]!==v)trans++;if(y<7&&want[(y+1)*8+x]!==v)trans++;}
    const fill=on/64,conc=Math.max(st.orient[0],st.orient[1],st.orient[2],st.orient[3]),detail=st.edgeMass+st.maxEdge*.35;
    if(st.edgeCount<3&&(fill<.08||fill>.92))return'flat';
    if(st.edgeCount>=4&&conc>.46&&st.edgeMass>.045)return'line';
    if(trans/112>.36&&st.edgeMass>.08)return'texture';
    return'region';
  }
  function edgeMapFromWant(want){
    const wedge=new Uint8Array(64);
    for(let y=0;y<8;y++)for(let x=0;x<8;x++){const p=y*8+x,v=want[p];if((x<7&&want[p+1]!==v)||(x>0&&want[p-1]!==v)||(y<7&&want[p+8]!==v)||(y>0&&want[p-8]!==v))wedge[p]=1;}
    return wedge;
  }
  function fitCell(data,feat,pal,sw,cx,cy,bgI,glyphMeta,opt,sourceCtx){
    const cell=scanCell(data,feat,pal,sw,cx,cy,bgI),srcCell=sourceCtx?scanSourceCell(sourceCtx,pal,cx,cy,bgI):null,BG=pal[bgI];
    const sourceCells=sourceEvidenceVariants(sourceCtx,pal,cx,cy,bgI,srcCell,opt.phaseMatch);
    const candidates=cell.candidates.slice();
    for(const sc of sourceCells) for(const c of sc.candidates) pushUnique(candidates,c);
    let best={cost:1e99,code:32,fg:bgI,cls:'flat'};
    for(const fgI of candidates){
      if(fgI===bgI)continue;
      const FG=pal[fgI],dq=opt.charBias/30,evidence=sourceCells.length?sourceCells:[null];
      for(const sc of evidence){
        const hi=sc&&sc.samples>=8?sourceFitArrays(sourceCtx,sc,pal,cx,cy,bgI,fgI,dq):null;
        let want,onErr,offErr,weights,offBase,st=sc?sc.structure:cell.structure;
        if(hi){
          want=hi.want;onErr=hi.onErr;offErr=hi.offErr;weights=hi.weights;offBase=hi.offBase;
        }else{
        want=new Uint8Array(64);onErr=new Float32Array(64);offErr=new Float32Array(64);weights=new Float32Array(64);offBase=0;st=cell.structure;
        for(let p=0;p<64;p++){
          const i=((cy*CH+(p>>3))*sw+(cx*CW+(p&7)))*4,oe=colorErr(data,i,FG),be=colorErr(data,i,BG),wt=1+st.edge[p]*3.4+(st.edgeBits[p]?1.2:0);
          weights[p]=wt;onErr[p]=oe*wt;offErr[p]=be*wt;offBase+=offErr[p];
          if(dq<=0){want[p]=oe<be?1:0;continue;}
          const t=be/(oe+be+1e-6),bx=(cx*CW+(p&7))&3,by=(cy*CH+(p>>3))&3,thr=(BAYER4[by*4+bx]+.5)/16;
          want[p]=t>(.5*(1-dq)+thr*dq)?1:0;
        }
        }
      const wedge=edgeMapFromWant(want);
      let cls=opt.autoMatch?classifyVisualCell(want,wedge,st):'region';
      const profileSet=opt.cleanMatch?CLEAN_PROFILES:VISUAL_PROFILES;
      const prof=opt.autoMatch?profileSet[cls]:[opt.edgeWeight,opt.shapeWeight*.75,opt.orientWeight*.55,6];
      const wDT=prof[1]>0?distTransform(want):null,wOR=prof[2]>0?orientHist(want):null;
      let wantFill=0;for(let p=0;p<64;p++)wantFill+=want[p];wantFill/=64;
      const detail=st.edgeMass+st.edgeCount/96,coherence=max4(st.orient);
      const compact=sc&&sc.detailNorm&&sc.detailNorm.fill>.035&&sc.detailNorm.fill<.48&&sc.detailNorm.count>=3;
      const symbolLike=!!(compact&&sc.contrast>.075&&st.maxEdge>.12&&sc.detailNorm.count<Math.max(40,sc.samples*.44));
      const clutterWeight=opt.cleanMatch&&!symbolLike?(cls==='line'?1.1:cls==='region'?5.2:8.5):0;
      const edgeBudget=st.edgeMass*.95+st.edgeCount/150+(symbolLike ? .18 : .055);
      for(let gi=0;gi<glyphMeta.length;gi++){
        const GM=glyphMeta[gi],M=GM.bits,E=GM.emap;let cost=offBase,maskMiss=0,edgeMiss=0,edgeFalse=0;
        for(let p=0;p<64;p++){if(M[p])cost+=onErr[p]-offErr[p];if(M[p]!==want[p])maskMiss+=weights[p];if(st.edgeBits[p]&&!E[p])edgeMiss+=1+st.edge[p]*2;else if(!st.edgeBits[p]&&E[p])edgeFalse+=.35;}
        cost+=maskMiss*.22+prof[0]*(edgeMiss*.42+edgeFalse*.10);
        if(prof[1]>0)cost+=prof[1]*(chamferDist(st.edgeBits,st.edgeDT,E,GM.edt)*.75+chamferDist(want,wDT,M,GM.dt)*.18);
        if(prof[2]>0){const O=GM.orient;cost+=prof[2]*(Math.abs(st.orient[0]-O[0])+Math.abs(st.orient[1]-O[1])+Math.abs(st.orient[2]-O[2])+Math.abs(st.orient[3]-O[3]))*.18;if(wOR)cost+=prof[2]*(Math.abs(wOR[0]-O[0])+Math.abs(wOR[1]-O[1])+Math.abs(wOR[2]-O[2])+Math.abs(wOR[3]-O[3]))*.05;}
        if(opt.cleanMatch){
          cost+=Math.abs(GM.fill-wantFill)*(cls==='flat'?7:3.2);
          const excessEdges=Math.max(0,GM.edges-edgeBudget);
          cost+=excessEdges*clutterWeight*(1.18-Math.min(.85,coherence));
          if(cls!=='line'&&GM.edges>.38&&!symbolLike)cost+=(GM.edges-.38)*5;
          if(symbolLike&&sc.detailNorm){
            const symShape=chamferDist(sc.detailNorm.bits,sc.detailNorm.dt,M,GM.dt);
            cost=cost*.48+symShape*2.4+Math.abs(GM.fill-sc.detailNorm.fill)*.35+
              Math.max(0,.12-GM.edges)*4.2-Math.min(1.45,GM.edges*3.1);
          }
          if(sc&&(Math.abs(sc.phaseX)+Math.abs(sc.phaseY))>0)cost+=(Math.abs(sc.phaseX)+Math.abs(sc.phaseY))*(symbolLike ? .18 : .65);
        }
        const tooSolid=GM.fill>.96||GM.fill<.04||GM.edges<.035;
        if(detail>.12&&tooSolid)cost+=prof[3]*(1+detail*8);
        if(detail>.18&&(GM.fill>.86||GM.fill<.14)&&GM.edges<.16)cost+=prof[3]*detail*3;
        if(cost<best.cost)best={cost,code:gi,fg:fgI,cls};
      }
      }
    }
    return best;
  }
  function fitTonalCell(data,feat,pal,sw,cx,cy,bgI,glyphMeta,opt,sourceCtx){
    const cell=scanCell(data,feat,pal,sw,cx,cy,bgI),srcCell=sourceCtx?scanSourceCell(sourceCtx,pal,cx,cy,bgI):null,candidates=cell.candidates.slice();
    if(srcCell)for(const c of srcCell.candidates)pushUnique(candidates,c);
    let best={cost:1e99,code:32,fg:bgI,cls:'tonal'};
    for(const fgI of candidates){
      if(fgI===bgI)continue;
      const FG=pal[fgI],BG=pal[bgI],dq=opt.charBias/30;
      const hi=srcCell&&srcCell.samples>=8?sourceFitArrays(sourceCtx,srcCell,pal,cx,cy,bgI,fgI,dq):null;
      let want,onErr,offErr,weights,offBase,st=srcCell?srcCell.structure:cell.structure;
      if(hi){
        want=hi.want;onErr=hi.onErr;offErr=hi.offErr;weights=hi.weights;offBase=hi.offBase;
      }else{
        want=new Uint8Array(64);onErr=new Float32Array(64);offErr=new Float32Array(64);weights=new Float32Array(64);offBase=0;st=cell.structure;
        for(let p=0;p<64;p++){
          const i=((cy*CH+(p>>3))*sw+(cx*CW+(p&7)))*4,oe=colorErr(data,i,FG),be=colorErr(data,i,BG),wt=1+st.edge[p]*1.15;
          weights[p]=wt;onErr[p]=oe*wt;offErr[p]=be*wt;offBase+=offErr[p];
          if(dq<=0){want[p]=oe<be?1:0;continue;}
          const t=be/(oe+be+1e-6),bx=(cx*CW+(p&7))&3,by=(cy*CH+(p>>3))&3,thr=(BAYER4[by*4+bx]+.5)/16;
          want[p]=t>(.5*(1-dq)+thr*dq)?1:0;
        }
      }
      let wantFill=0;for(let p=0;p<64;p++)wantFill+=want[p];wantFill/=64;
      const edgeBudget=st.edgeMass*.55+st.edgeCount/220+.065;
      for(let gi=0;gi<glyphMeta.length;gi++){
        const GM=glyphMeta[gi],M=GM.bits;let cost=offBase,maskMiss=0;
        for(let p=0;p<64;p++){if(M[p])cost+=onErr[p]-offErr[p];if(M[p]!==want[p])maskMiss+=weights[p];}
        cost+=maskMiss*.10+Math.abs(GM.fill-wantFill)*1.15+Math.max(0,GM.edges-edgeBudget)*1.8;
        if(st.edgeMass<.035&&GM.edges>.14)cost+=(GM.edges-.14)*2.4;
        if(cost<best.cost)best={cost,code:gi,fg:fgI,cls:'tonal'};
      }
    }
    return best;
  }
  function fitLegacyCell(data,pal,sw,cx,cy,bgI,glyphMeta,opt,sourceCtx){
    const srcCell=sourceCtx?scanSourceCell(sourceCtx,pal,cx,cy,bgI):null,BG=pal[bgI],dq=opt.charBias/30;
    let fgI=bgI,fv=-1,want;
    if(srcCell){
      for(let k=0;k<16;k++)if(k!==bgI&&srcCell.hist[k]>fv){fv=srcCell.hist[k];fgI=k;}
      if(fv<=0)fgI=bgI;
      want=sourceFitArrays(sourceCtx,srcCell,pal,cx,cy,bgI,fgI,dq).want;
    }else{
      const fhist=new Uint16Array(16);
      for(let p=0;p<64;p++){const i=((cy*CH+(p>>3))*sw+(cx*CW+(p&7)))*4;fhist[nearest(pal,data[i],data[i+1],data[i+2])]++;}
      for(let k=0;k<16;k++)if(k!==bgI&&fhist[k]>fv){fv=fhist[k];fgI=k;}if(fv<=0)fgI=bgI;
      const FG=pal[fgI];want=new Uint8Array(64);
      for(let p=0;p<64;p++){
        const i=((cy*CH+(p>>3))*sw+(cx*CW+(p&7)))*4,df=(data[i]-FG[0])**2+(data[i+1]-FG[1])**2+(data[i+2]-FG[2])**2,db=(data[i]-BG[0])**2+(data[i+1]-BG[1])**2+(data[i+2]-BG[2])**2;
        if(dq<=0){want[p]=df<db?1:0;continue;}
        const t=db/(df+db+1e-6),bx=(cx*CW+(p&7))&3,by=(cy*CH+(p>>3))&3,thr=(BAYER4[by*4+bx]+.5)/16;
        want[p]=t>(.5*(1-dq)+thr*dq)?1:0;
      }
    }
    const wedge=edgeMapFromWant(want);let ew=opt.edgeWeight,swE=opt.shapeWeight,ow=opt.orientWeight;
    if(opt.autoMatch){const prof=AUTO_PROFILES[classifyCell(want,wedge)];ew=prof[0];swE=prof[1];ow=prof[2];}
    const wDT=swE>0?distTransform(want):null,wOR=ow>0?orientHist(want):null;
    let best=0,bd=1e9;
    for(let gi=0;gi<glyphMeta.length;gi++){
      const GM=glyphMeta[gi],M=GM.bits,E=GM.emap;let dd=0,ed=0;
      for(let p=0;p<64;p++){if(M[p]!==want[p])dd++;if(ew>0&&E[p]!==wedge[p])ed++;}
      let cost=dd+ew*ed;if(swE>0)cost+=swE*chamferDist(want,wDT,M,GM.dt);
      if(ow>0){const O=GM.orient;cost+=ow*(Math.abs(wOR[0]-O[0])+Math.abs(wOR[1]-O[1])+Math.abs(wOR[2]-O[2])+Math.abs(wOR[3]-O[3]));}
      if(cost<bd){bd=cost;best=gi;}
    }
    return {code:best,fg:fgI};
  }
  function lineSample(st,sw,sh,cx,cy,p,dx,dy){
    const x=cx*CW+(p&7)+dx,y=cy*CH+(p>>3)+dy;
    if(x<0||y<0||x>=sw||y>=sh) return {on:0,val:0,theta:0};
    const si=y*sw+x;
    return {on:st.line[si],val:st.value[si]||st.line[si],theta:st.theta[si]};
  }
  function fitChungCell(data,feat,structure,pal,sw,sh,cx,cy,bgI,glyphMeta,opt,sourceCtx){
    const cell=scanCell(data,feat,pal,sw,cx,cy,bgI),srcCell=sourceCtx?scanSourceCell(sourceCtx,pal,cx,cy,bgI):null;
    let lineCount=0,lineMass=0;
    for(let p=0;p<64;p++){const s=lineSample(structure,sw,sh,cx,cy,p,0,0);lineCount+=s.on;lineMass+=s.val;}
    if(lineCount<2) return fitCell(data,feat,pal,sw,cx,cy,bgI,glyphMeta,opt,sourceCtx);
    const cand=cell.candidates.slice();if(srcCell)for(const c of srcCell.candidates)pushUnique(cand,c);
    const wu=.65,wm=1;
    let best={cost:1e99,code:32,fg:bgI,cls:'chung'};
    for(const fgI of cand){
      if(fgI===bgI)continue;
      const FG=pal[fgI],BG=pal[bgI],contrast=paletteContrast(pal,fgI,bgI);
      for(let gi=0;gi<glyphMeta.length;gi++){
        const GM=glyphMeta[gi],M=GM.bits;
        if(lineMass>3&&(GM.fill>.92||GM.fill<.03)) continue;
        let bestGlyph=1e99;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          let match=0,mismatch=0,missed=0,falseInk=0,tone=0;
          for(let p=0;p<64;p++){
            const s=lineSample(structure,sw,sh,cx,cy,p,dx,dy);
            const i=((cy*CH+(p>>3))*sw+(cx*CW+(p&7)))*4;
            const ink=M[p];
            tone+=ink?colorErr(data,i,FG):colorErr(data,i,BG);
            if(ink){
              if(s.on){
                const av=GM.thetaValid[p],sim=av?(Math.cos(angleDelta(s.theta,GM.theta[p]))+1)/2:.55;
                match+=s.val*(1+sim);
                mismatch+=(1-s.val)*(1-sim)*.35;
              }else{
                mismatch+=1.35;
                falseInk++;
              }
            }else if(s.on){
              missed+=s.val;
            }
          }
          const densityPenalty=Math.max(0,GM.fill-.62)*lineMass*.7+Math.max(0,.04-GM.fill)*lineMass;
          const cost=wu*(mismatch+missed*1.55+falseInk*.16+densityPenalty)-wm*match+tone*(.08+.08*(1-contrast));
          if(cost<bestGlyph)bestGlyph=cost;
        }
        if(bestGlyph<best.cost)best={cost:bestGlyph,code:gi,fg:fgI,cls:'chung'};
      }
    }
    return best;
  }
  function fitAutoCell(data,feat,structure,pal,sw,sh,cx,cy,bgI,glyphMeta,opt,sourceCtx){
    const cleanOpt=opt.cleanMatch?opt:{...opt,cleanMatch:true};
    const srcCell=sourceCtx?scanSourceCell(sourceCtx,pal,cx,cy,bgI):null;
    let lineCount=0,lineMass=0,vx=0,vy=0;
    for(let p=0;p<64;p++){
      const s=lineSample(structure,sw,sh,cx,cy,p,0,0);
      if(!s.on)continue;
      lineCount++;lineMass+=s.val;vx+=Math.cos(2*s.theta)*s.val;vy+=Math.sin(2*s.theta)*s.val;
    }
    const coherence=lineMass?Math.sqrt(vx*vx+vy*vy)/lineMass:0;
    if(opt.phaseMatch&&lineCount>=3&&lineCount<=18&&lineMass>2.4&&coherence>.62){
      return fitChungCell(data,feat,structure,pal,sw,sh,cx,cy,bgI,glyphMeta,cleanOpt,sourceCtx);
    }
    if(opt.phaseMatch&&isCompactSymbolCell(srcCell)){
      return fitCell(data,feat,pal,sw,cx,cy,bgI,glyphMeta,cleanOpt,sourceCtx);
    }
    return fitLegacyCell(data,pal,sw,cx,cy,bgI,glyphMeta,opt,sourceCtx);
  }
  function create(opts){
    const SETS={set1:withReverse(decodeCharset(opts.upperRomBase64)),set2:withReverse(decodeCharset(opts.lowerRomBase64))};
    const cache={};
    function getGlyphs(charset='set1',useInverse=true){const base=SETS[charset]||SETS.set1;return useInverse?base:base.slice(0,128);}
    function getMeta(charset='set1',useInverse=true){const key=charset+':'+(useInverse?1:0);if(!cache[key])cache[key]=meta(getGlyphs(charset,useInverse));return cache[key];}
    function convertImageData(image,opt={}){
      const cols=opt.cols||Math.floor(image.width/CW),rows=opt.rows||Math.floor(image.height/CH),sw=cols*CW,sh=rows*CH;
      const pal=PALETTES[opt.palette||'pepto'],mode=opt.mode||'petscii';
      const requestedAlgorithm=opt.algorithm||'auto',algorithm=requestedAlgorithm==='auto'?'auto':requestedAlgorithm;
      const cfg={charBias:+(opt.charBias||0),edgeWeight:+(opt.edgeWeight||0),shapeWeight:+(opt.shapeWeight||0),orientWeight:+(opt.orientWeight||0),autoMatch:opt.autoMatch!==false,phaseMatch:opt.phaseMatch===true,localBackground:opt.localBackground===true,cleanMatch:opt.cleanMatch===true||algorithm==='auto'||algorithm==='clean'};
      const srcW=image.width,srcH=image.height,srcData=new Uint8ClampedArray(image.data.slice?image.data.slice(0,srcW*srcH*4):Array.from(image.data).slice(0,srcW*srcH*4));
      const d=resampleImageData({data:srcData,width:srcW,height:srcH},sw,sh);
      const br=+(opt.brightness||0),con=+(opt.contrast==null?1:opt.contrast);
      for(let i=0;i<d.length;i+=4)for(let k=0;k<3;k++){let v=(d[i+k]-128)*con+128+br;d[i+k]=v<0?0:v>255?255:v;}
      const highData=new Uint8ClampedArray(srcData);
      for(let i=0;i<highData.length;i+=4)for(let k=0;k<3;k++){let v=(highData[i+k]-128)*con+128+br;highData[i+k]=v<0?0:v>255?255:v;}
      const highFeat=sourceFeatures(highData,srcW,srcH);
      const sourceData=new Uint8ClampedArray(d),feat=poolFeaturesToTarget(highFeat,srcW,srcH,sw,sh);
      const sourceCtx={data:highData,feat:highFeat,width:srcW,height:srcH,cols,rows,cellCache:new Map()};
      if(opt.dither==='fs'){
        for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){const i=(y*sw+x)*4,oldc=[d[i],d[i+1],d[i+2]],ni=nearest(pal,...oldc),nc=pal[ni];
          for(let k=0;k<3;k++){const e=oldc[k]-nc[k];d[i+k]=nc[k];const push=(xx,yy,f)=>{if(xx<0||yy<0||xx>=sw||yy>=sh)return;const j=(yy*sw+xx)*4+k;d[j]=Math.max(0,Math.min(255,d[j]+e*f));};push(x+1,y,7/16);push(x-1,y+1,3/16);push(x,y+1,5/16);push(x+1,y+1,1/16);}}
      }
      const fitData=opt.dither==='fs'?d:sourceData,out=new Uint8ClampedArray(sw*sh*4),screenCodes=[],colorRAM=[],bgRAM=[],textGrid=[];
      let globalBg=opt.background;
      if(mode==='blocks'){
        for(let cy=0;cy<rows;cy++)for(let cx=0;cx<cols;cx++){const sub=[[0,0],[4,0],[0,4],[4,4]];for(const [ox,oy] of sub){let r=0,g=0,b=0;for(let y=0;y<4;y++)for(let x=0;x<4;x++){const i=((cy*CH+oy+y)*sw+(cx*CW+ox+x))*4;r+=d[i];g+=d[i+1];b+=d[i+2];}const c=pal[nearest(pal,r/16,g/16,b/16)];for(let y=0;y<4;y++)for(let x=0;x<4;x++){const o=((cy*CH+oy+y)*sw+(cx*CW+ox+x))*4;out[o]=c[0];out[o+1]=c[1];out[o+2]=c[2];out[o+3]=255;}}}
        return {data:out,width:sw,height:sh,cols,rows,mode,bg:0,border:0,screenCodes,colorRAM,bgRAM,textGrid,algorithm,sourceWidth:srcW,sourceHeight:srcH,pixelsPerCellX:srcW/cols,pixelsPerCellY:srcH/rows};
      }
      const glyphMeta=getMeta(opt.charset||'set1',opt.useInverse!==false);
      const structure=(algorithm==='chung'||algorithm==='auto')?poolStructureToTarget(structureTensorFeatures(highData,srcW,srcH),srcW,srcH,sw,sh):null;
      if(globalBg==null){
        if(algorithm==='legacy'){
          const bgHist=new Uint32Array(16);
          for(let cy=0;cy<rows;cy++)for(let cx=0;cx<cols;cx++){const h=new Uint16Array(16);for(let p=0;p<64;p++){const i=((cy*CH+(p>>3))*sw+(cx*CW+(p&7)))*4;h[nearest(pal,d[i],d[i+1],d[i+2])]++;}bgHist[topIndex(h)]++;}
          globalBg=topIndex(bgHist);
        }else globalBg=chooseGlobalBackground(pal,fitData,feat,sw,cols,rows);
      }
      for(let cy=0;cy<rows;cy++){
        let line='';
        for(let cx=0;cx<cols;cx++){
          const cellBg=cfg.localBackground?chooseCellBackground(fitData,feat,pal,sw,cx,cy,sourceCtx):globalBg;
          const fit=algorithm==='legacy'
            ?fitLegacyCell(fitData,pal,sw,cx,cy,cellBg,glyphMeta,cfg,sourceCtx)
            :algorithm==='chung'
              ?fitChungCell(fitData,feat,structure,pal,sw,sh,cx,cy,cellBg,glyphMeta,cfg,sourceCtx)
              :algorithm==='auto'
                ?fitAutoCell(fitData,feat,structure,pal,sw,sh,cx,cy,cellBg,glyphMeta,cfg,sourceCtx)
              :fitCell(fitData,feat,pal,sw,cx,cy,cellBg,glyphMeta,cfg,sourceCtx);
          const BG=pal[cellBg],FG=pal[fit.fg],G=glyphMeta[fit.code].bits;
          for(let p=0;p<64;p++){const o=((cy*CH+(p>>3))*sw+(cx*CW+(p&7)))*4,c=G[p]?FG:BG;out[o]=c[0];out[o+1]=c[1];out[o+2]=c[2];out[o+3]=255;}
          screenCodes.push(fit.code);colorRAM.push(fit.fg);bgRAM.push(cellBg);line+=String.fromCharCode(32+(fit.code&63));
        }
        textGrid.push(line);
      }
      return {data:out,width:sw,height:sh,cols,rows,mode,bg:globalBg,border:globalBg,screenCodes,colorRAM,bgRAM,textGrid,algorithm,sourceWidth:srcW,sourceHeight:srcH,pixelsPerCellX:srcW/cols,pixelsPerCellY:srcH/rows};
    }
    return {convertImageData,getGlyphs,getMeta,PALETTES,CW,CH,rowsForImage:(cols,w,h)=>Math.max(1,Math.round(cols*h/w))};
  }
  return {create,PALETTES,CW,CH};
});
