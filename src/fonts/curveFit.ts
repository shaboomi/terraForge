import type { CenterlinePoint,CenterlineStroke,FontOutlineCommand } from "../types/fonts";

interface XY { x:number; y:number }
interface Sample extends CenterlinePoint { s:number }
interface Segment { start:XY; a:XY; b:XY; end:XY; first:number; last:number; u:number[]; line:boolean }
export interface CenterlineFitOptions {
  pixelSize:number;
  tolerance?:number;
  /** Original sample indices of shared junctions that must remain connected. */
  anchors?:number[];
  /** Filled source glyph constraint; excludes counters as well as the exterior. */
  contains?:(x:number,y:number) => boolean;
}
const distance = (a:XY,b:XY) => Math.hypot(a.x-b.x,a.y-b.y);
const subtract = (a:XY,b:XY):XY => ({x:a.x-b.x,y:a.y-b.y});
const multiply = (a:XY,k:number):XY => ({x:a.x*k,y:a.y*k});
const add = (a:XY,b:XY):XY => ({x:a.x+b.x,y:a.y+b.y});
const dot = (a:XY,b:XY) => a.x*b.x+a.y*b.y;
const normalize = (a:XY):XY => multiply(a,1/(Math.hypot(a.x,a.y)||1));
const quantize = (value:number) => Math.round(value*1_000_000)/1_000_000;

function storedStroke(points:CenterlinePoint[],commands:FontOutlineCommand[]):CenterlineStroke {
  // Microunit precision is far finer than machine output. Avoid persisting
  // full binary-float tails on hundreds of thousands of width samples.
  return {points:points.map(p=>({x:quantize(p.x),y:quantize(p.y),width:Math.max(0.000001,quantize(p.width))})),
    commands:commands.map(command=>Object.fromEntries(Object.entries(command).map(([key,value])=>[key,typeof value==="number"?quantize(value):value])) as FontOutlineCommand)};
}

export function evaluateCubic(start:XY,a:XY,b:XY,end:XY,t:number):XY {
  const v=1-t;
  return {x:v*v*v*start.x+3*v*v*t*a.x+3*v*t*t*b.x+t*t*t*end.x,
    y:v*v*v*start.y+3*v*v*t*a.y+3*v*t*t*b.y+t*t*t*end.y};
}

function cumulative(points:CenterlinePoint[]):number[] {
  const result=[0];
  for (let i=1;i<points.length;i++) result.push(result[i-1]+distance(points[i-1],points[i]));
  return result;
}
function atDistance(points:CenterlinePoint[],positions:number[],s:number,closed:boolean):CenterlinePoint {
  const total=positions.at(-1)!;
  if (closed) s=((s%total)+total)%total;
  else s=Math.max(0,Math.min(total,s));
  let lo=0,hi=positions.length-1;
  while (hi-lo>1) {const middle=(lo+hi)>>1;if(positions[middle]<=s)lo=middle;else hi=middle;}
  const a=points[lo],b=points[hi],t=(s-positions[lo])/(positions[hi]-positions[lo]||1);
  return {x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y),width:a.width+t*(b.width-a.width)};
}

/** A raster's individual right-angle steps are not corners: measure multi-pixel tangents. */
function findCorners(points:CenterlinePoint[],positions:number[],pixel:number,closed:boolean):number[] {
  const total=positions.at(-1)!;
  const turn=(s:number,radius:number) => {
    const p=atDistance(points,positions,s,closed),a=atDistance(points,positions,s-radius,closed),b=atDistance(points,positions,s+radius,closed);
    const incoming=normalize(subtract(p,a)),outgoing=normalize(subtract(b,p));
    return Math.acos(Math.max(-1,Math.min(1,dot(incoming,outgoing))));
  };
  const candidates:{s:number;angle:number}[]=[];
  for (let i=closed?0:1;i<points.length-1;i++) {
    const s=positions[i];
    if (!closed && (s<3*pixel||total-s<3*pixel)) continue;
    const inner=turn(s,3*pixel),outer=turn(s,7*pixel);
    if (inner>Math.PI*0.32 && outer>Math.PI*0.32 && inner>outer*0.75) candidates.push({s,angle:inner});
  }
  candidates.sort((a,b)=>b.angle-a.angle);
  const kept:number[]=[];
  for (const candidate of candidates) if (!kept.some(s=>Math.min(Math.abs(s-candidate.s),closed?total-Math.abs(s-candidate.s):Infinity)<4*pixel)) kept.push(candidate.s);
  return kept.sort((a,b)=>a-b);
}

function prepare(points:CenterlinePoint[],options:CenterlineFitOptions,closed:boolean) {
  const originalS=cumulative(points),total=originalS.at(-1)!,pixel=options.pixelSize;
  const anchors=(options.anchors??[]).map(i=>originalS[i]).filter(s=>Number.isFinite(s)&&s>=0&&s<=total);
  const corners=findCorners(points,originalS,pixel,closed).filter(s=>!anchors.some(anchor=> {
    const separation=Math.abs(s-anchor),width=atDistance(points,originalS,anchor,closed).width;
    return separation>pixel&&separation<width*0.5;
  }));
  const fixed=new Set([0,total,...anchors,...corners]);
  const count=Math.max(1,Math.ceil(total/pixel));
  if (count>100_000) throw new Error("Centreline curve fitting exceeds the sample limit.");
  const locations=[...new Set([...fixed,...Array.from({length:count-1},(_,i)=>total*(i+1)/count)])].sort((a,b)=>a-b);
  const samples:Sample[]=locations.map(s=> {
    const original=atDistance(points,originalS,s,closed);
    if (fixed.has(s)) return {...original,s};
    let radius=pixel,maximumShift=pixel*0.65;
    for(const anchor of anchors) {
      const width=atDistance(points,originalS,anchor,closed).width;
      const influence=Math.max(0,1-Math.abs(s-anchor)/Math.max(pixel,width*0.75));
      // Medial junctions bend toward neighboring arms. Relax only inside a
      // small part of their measured ink disk, while keeping the shared anchor.
      radius=Math.max(radius,width*0.25*influence*influence);
      maximumShift=Math.max(maximumShift,width*0.15*influence*influence);
    }
    const boundaryBefore=Math.max(0,...corners.filter(c=>c<s)),boundaryAfter=Math.min(total,...corners.filter(c=>c>s));
    let x=0,y=0,weight=0;
    for (let offset=-2;offset<=2;offset++) {
      const w=[1,4,6,4,1][offset+2];
      let sampleS=s+offset*radius;
      if (!closed||corners.length) sampleS=Math.max(boundaryBefore,Math.min(boundaryAfter,sampleS));
      const p=atDistance(points,originalS,sampleS,closed);x+=p.x*w;y+=p.y*w;weight+=w;
    }
    const delta={x:x/weight-original.x,y:y/weight-original.y},shift=Math.hypot(delta.x,delta.y);
    const scale=shift>maximumShift?maximumShift/shift:1;
    const smooth={x:original.x+delta.x*scale,y:original.y+delta.y*scale,width:original.width,s};
    return options.contains&&!options.contains(smooth.x,smooth.y)?{...original,s}:smooth;
  });
  // Periodic smoothing uses the same geometric seam point and width at both ends.
  if (closed) samples[samples.length-1]={...samples[0],s:total};
  const splits=new Set([0,samples.length-1]);
  samples.forEach((p,i)=> {if(fixed.has(p.s))splits.add(i);});
  if (closed) for (const fraction of [0.25,0.5,0.75]) {
    let nearest=0;
    for (let i=1;i<samples.length;i++) if(Math.abs(samples[i].s-total*fraction)<Math.abs(samples[nearest].s-total*fraction))nearest=i;
    splits.add(nearest);
  }
  return {samples,splits:[...splits].sort((a,b)=>a-b),corners:new Set(corners),originalS};
}

function direction(samples:Sample[],index:number,pixel:number,side:-1|1,closed:boolean,corner:boolean,junction=false):XY {
  const last=samples.length-1,total=samples[last].s;
  const reach=junction&&!corner?Math.max(3*pixel,samples[index].width*0.75):3*pixel;
  if (closed&&!corner&&(index===0||index===last)) {
    const before=atDistance(samples,samples.map(p=>p.s),total-3*pixel,true),after=atDistance(samples,samples.map(p=>p.s),3*pixel,true);
    return multiply(normalize(subtract(after,before)),side);
  }
  let before=index,after=index;
  if (!corner||side===1) while(after<last&&samples[after].s-samples[index].s<reach)after++;
  if (!corner||side===-1) while(before>0&&samples[index].s-samples[before].s<reach)before--;
  return multiply(normalize(subtract(samples[after],samples[before])),side);
}

function parameterize(points:Sample[],first:number,last:number):number[] {
  const u=[0];
  for(let i=first+1;i<=last;i++)u.push(u.at(-1)!+distance(points[i-1],points[i]));
  const length=u.at(-1)!||1;
  return u.map(value=>value/length);
}

/** Least-squares handles with fixed endpoint tangents (Schneider's fitting formulation). */
function leastSquares(points:Sample[],first:number,last:number,u:number[],left:XY,right:XY):Segment {
  const start=points[first],end=points[last];
  let aa=0,ab=0,bb=0,ar=0,br=0;
  for(let j=0;j<u.length;j++) {
    const t=u[j],v=1-t,b0=v*v*v,b1=3*t*v*v,b2=3*t*t*v,b3=t*t*t;
    const a=multiply(left,b1),b=multiply(right,b2);
    const residual=subtract(points[first+j],add(multiply(start,b0+b1),multiply(end,b2+b3)));
    aa+=dot(a,a);ab+=dot(a,b);bb+=dot(b,b);ar+=dot(a,residual);br+=dot(b,residual);
  }
  const determinant=aa*bb-ab*ab,chord=distance(start,end),arc=points[last].s-points[first].s;
  let alpha=determinant? (ar*bb-br*ab)/determinant:0,beta=determinant?(br*aa-ar*ab)/determinant:0;
  if(alpha<chord*1e-6||beta<chord*1e-6||!Number.isFinite(alpha+beta)||alpha>arc*1.5||beta>arc*1.5)alpha=beta=chord/3;
  return {start,a:add(start,multiply(left,alpha)),b:add(end,multiply(right,beta)),end,first,last,u,line:false};
}

function reparameterize(points:Sample[],segment:Segment):number[]|null {
  const u=[0];
  for(let i=1;i<segment.u.length-1;i++) {
    const t=segment.u[i],v=1-t,p=evaluateCubic(segment.start,segment.a,segment.b,segment.end,t);
    const derivative=add(add(multiply(subtract(segment.a,segment.start),3*v*v),multiply(subtract(segment.b,segment.a),6*v*t)),multiply(subtract(segment.end,segment.b),3*t*t));
    const second=add(multiply(add(subtract(segment.b,multiply(segment.a,2)),segment.start),6*v),multiply(add(subtract(segment.end,multiply(segment.b,2)),segment.a),6*t));
    const residual=subtract(p,points[segment.first+i]),denominator=dot(derivative,derivative)+dot(residual,second);
    const next=denominator?t-dot(residual,derivative)/denominator:t;
    if(next<=u.at(-1)!||next>=1||!Number.isFinite(next))return null;
    u.push(next);
  }
  u.push(1);return u;
}

function lineDeviation(p:XY,a:XY,b:XY):number {
  const delta=subtract(b,a),length2=dot(delta,delta),t=length2?Math.max(0,Math.min(1,dot(subtract(p,a),delta)/length2)):0;
  return distance(p,add(a,multiply(delta,t)));
}

function safeCurve(segment:Segment,points:Sample[],tolerance:number,options:CenterlineFitOptions):boolean {
  const polygon=distance(segment.start,segment.a)+distance(segment.a,segment.b)+distance(segment.b,segment.end);
  const steps=Math.max(4,Math.min(4096,Math.ceil(polygon/(options.pixelSize*0.5))));
  let bracket=0;
  for(let i=1;i<steps;i++) {
    const t=i/steps,p=evaluateCubic(segment.start,segment.a,segment.b,segment.end,t);
    if(options.contains&&!options.contains(p.x,p.y))return false;
    while(bracket<segment.u.length-2&&segment.u[bracket+1]<t)bracket++;
    let nearest=Infinity;
    for(let j=Math.max(0,bracket-1);j<=Math.min(segment.u.length-2,bracket+1);j++)nearest=Math.min(nearest,lineDeviation(p,points[segment.first+j],points[segment.first+j+1]));
    if(nearest>tolerance*1.6)return false;
  }
  return true;
}

function fitSpan(points:Sample[],first:number,last:number,left:XY,right:XY,tolerance:number,options:CenterlineFitOptions,depth=0):Segment[] {
  const u=parameterize(points,first,last),start=points[first],end=points[last],chord=normalize(subtract(end,start));
  let previousProjection=-Infinity;
  const followsLine=points.slice(first,last+1).every(p=> {
    const projection=dot(subtract(p,start),chord),forward=projection+1e-9>=previousProjection;
    previousProjection=projection;return forward&&lineDeviation(p,start,end)<=tolerance*0.7;
  });
  const straight=distance(start,end)>0&&followsLine&&dot(chord,left)>0.99&&dot(chord,multiply(right,-1))>0.99;
  if(straight||last-first===1) {
    const segment:Segment={start,a:add(start,multiply(subtract(end,start),1/3)),b:add(start,multiply(subtract(end,start),2/3)),end,first,last,u,line:true};
    if(last-first===1||safeCurve(segment,points,tolerance,options))return [segment];
  }
  let segment=leastSquares(points,first,last,u,left,right),split=Math.floor((first+last)/2);
  for(let iteration=0;iteration<5;iteration++) {
    let maximum=0;
    for(let i=1;i<segment.u.length-1;i++) {
      const error=distance(evaluateCubic(segment.start,segment.a,segment.b,segment.end,segment.u[i]),points[first+i]);
      if(error>maximum){maximum=error;split=first+i;}
    }
    if(maximum<=tolerance&&safeCurve(segment,points,tolerance,options))return [segment];
    if(maximum>tolerance*4)break;
    const next=reparameterize(points,segment);if(!next)break;
    segment=leastSquares(points,first,last,next,left,right);
  }
  if(depth>=20) return Array.from({length:last-first},(_,i)=> {
    const a=points[first+i],b=points[first+i+1];return {start:a,a,b,end:b,first:first+i,last:first+i+1,u:[0,1],line:true};
  });
  if(split<=first||split>=last)split=Math.floor((first+last)/2);
  const tangent=normalize(subtract(points[Math.min(last,split+2)],points[Math.max(first,split-2)]));
  return [...fitSpan(points,first,split,left,multiply(tangent,-1),tolerance,options,depth+1),...fitSpan(points,split,last,tangent,right,tolerance,options,depth+1)];
}

function interpolateSourceS(segment:Segment,t:number,points:Sample[]):number {
  let i=0;while(i<segment.u.length-2&&segment.u[i+1]<t)i++;
  const ratio=(t-segment.u[i])/(segment.u[i+1]-segment.u[i]||1);
  return points[segment.first+i].s+ratio*(points[segment.first+i+1].s-points[segment.first+i].s);
}

function widthNearPoint(points:CenterlinePoint[],positions:number[],s:number,p:XY):number {
  let lo=0,hi=positions.length-1;
  while(hi-lo>1){const middle=(lo+hi)>>1;if(positions[middle]<=s)lo=middle;else hi=middle;}
  let best=Infinity,width=points[lo].width;
  for(let i=Math.max(0,lo-3);i<=Math.min(points.length-2,lo+3);i++) {
    const a=points[i],b=points[i+1],delta=subtract(b,a),length2=dot(delta,delta);
    const t=length2?Math.max(0,Math.min(1,dot(subtract(p,a),delta)/length2)):0;
    const deviation=distance(p,add(a,multiply(delta,t)));
    if(deviation<best){best=deviation;width=a.width+t*(b.width-a.width);}
  }
  return width;
}

/** Smooth raster staircases into bounded-error cubic geometry, retaining widths on that geometry. */
export function fitCenterline(points:CenterlinePoint[],options:CenterlineFitOptions):CenterlineStroke {
  if(points.length<2||!Number.isFinite(options.pixelSize)||options.pixelSize<=0)throw new Error("Invalid centreline curve fitting input.");
  if(points.some(p=>![p.x,p.y,p.width].every(Number.isFinite)||p.width<=0))throw new Error("Invalid centreline curve fitting coordinates.");
  const closed=points.length>3&&distance(points[0],points.at(-1)!)<options.pixelSize*1e-6;
  const originalS=cumulative(points),total=originalS.at(-1)!;
  if(total<options.pixelSize*1e-8)return storedStroke(points,[{type:"M",x:points[0].x,y:points[0].y},{type:"L",x:points.at(-1)!.x,y:points.at(-1)!.y}]);
  const prepared=prepare(points,options,closed),samples=prepared.samples,tolerance=options.tolerance??options.pixelSize*0.9;
  const anchorPositions=new Set((options.anchors??[]).map(index=>originalS[index]));
  const segments:Segment[]=[];
  for(let i=1;i<prepared.splits.length;i++) {
    const first=prepared.splits[i-1],last=prepared.splits[i];
    segments.push(...fitSpan(samples,first,last,direction(samples,first,options.pixelSize,1,closed,prepared.corners.has(samples[first].s),anchorPositions.has(samples[first].s)),direction(samples,last,options.pixelSize,-1,closed,prepared.corners.has(samples[last].s),anchorPositions.has(samples[last].s)),tolerance,options));
  }
  for(let i=1;i<segments.length;i++) {
    const previous=segments[i-1],next=segments[i],s=samples[next.first].s;
    if(previous.line||next.line||!anchorPositions.has(s)||prepared.corners.has(s))continue;
    const tangent=direction(samples,next.first,options.pixelSize,1,closed,false,true);
    const handle=Math.min(distance(previous.b,previous.end),distance(next.start,next.a));
    const a={...previous,b:add(previous.end,multiply(tangent,-handle))},b={...next,a:add(next.start,multiply(tangent,handle))};
    if(safeCurve(a,samples,tolerance,options)&&safeCurve(b,samples,tolerance,options)){segments[i-1]=a;segments[i]=b;}
  }
  if(closed&&!prepared.corners.has(0)&&segments.length>1&&!segments[0].line&&!segments.at(-1)!.line) {
    const first=segments[0],last=segments.at(-1)!,tangent=direction(samples,0,options.pixelSize,1,true,false);
    const handle=Math.min(distance(first.start,first.a),distance(last.b,last.end));
    const adjustedFirst={...first,a:add(first.start,multiply(tangent,handle))},adjustedLast={...last,b:add(last.end,multiply(tangent,-handle))};
    if(safeCurve(adjustedFirst,samples,tolerance,options)&&safeCurve(adjustedLast,samples,tolerance,options)){segments[0]=adjustedFirst;segments[segments.length-1]=adjustedLast;}
  }
  const commands:FontOutlineCommand[]=[{type:"M",x:segments[0].start.x,y:segments[0].start.y}];
  const fitted:CenterlinePoint[]=[];
  for(const segment of segments) {
    commands.push(segment.line?{type:"L",x:segment.end.x,y:segment.end.y}:{type:"C",x1:segment.a.x,y1:segment.a.y,x2:segment.b.x,y2:segment.b.y,x:segment.end.x,y:segment.end.y});
    const polygon=distance(segment.start,segment.a)+distance(segment.a,segment.b)+distance(segment.b,segment.end);
    const count=Math.max(1,Math.min(4096,Math.ceil(polygon/(options.pixelSize*1.5))));
    for(let i=fitted.length?1:0;i<=count;i++) {
      const t=i/count,p=evaluateCubic(segment.start,segment.a,segment.b,segment.end,t);
      const width=widthNearPoint(points,originalS,interpolateSourceS(segment,t,samples),p);
      fitted.push({...p,width});
    }
  }
  if(closed){commands.push({type:"Z"});fitted[fitted.length-1]={...fitted[0]};}
  return storedStroke(fitted,commands);
}
