// Reproduce artwork from the distributable; no bitmap is placed under vector output.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {inflateSync,deflateSync} from 'node:zlib';
import {Resvg} from '@resvg/resvg-js';
const output='docs/images/cmyk-circles';await mkdir(output,{recursive:true});
const source=await readFile('docs/examples/cmyk-circles.tf-plugin.js','utf8');
const manifest=JSON.parse(source.match(/terraforge-plugin\s*([\s\S]*?)\*\//)[1]);
const {default:run}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const defaults=Object.fromEntries(manifest.controls.map(c=>[c.key,c.default]));
function decodePng(bytes) {
  let width, height, channels;
  const compressed = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8 || ![2, 6].includes(data[9]) || data[12]) throw new Error('Expected RGB/RGBA8 non-interlaced PNG');
      channels = data[9] === 2 ? 3 : 4;
    }
    if (type === 'IDAT') compressed.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(compressed));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= channels ? pixels[i - channels] : 0;
      const b = y ? pixels[i - stride] : 0;
      const c = y && x >= channels ? pixels[i - stride - channels] : 0;
      if (filter > 4) throw new Error('Invalid PNG filter');
      pixels[i] = raw[y * (stride + 1) + x + 1] + [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data.set(pixels.subarray(i * channels, i * channels + 3), i * 4);
    data[i * 4 + 3] = channels === 4 ? pixels[i * channels + 3] : 255;
  }
  return { width, height, data };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function encodePng({ width, height, data }) {
  const chunk = (name, content) => {
    const body = Buffer.concat([Buffer.from(name), content]);
    const length = Buffer.alloc(4); length.writeUInt32BE(content.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}


function resize(image, width, height) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.min(image.width - 1, (x + 0.5) * image.width / width - 0.5);
    const sy = Math.min(image.height - 1, (y + 0.5) * image.height / height - 0.5);
    const ix = Math.max(0, Math.floor(sx)), iy = Math.max(0, Math.floor(sy));
    const fx = sx - ix, fy = sy - iy;
    for (let channel = 0; channel < 4; channel++) {
      const sample = (xx, yy) => image.data[(yy * image.width + xx) * 4 + channel];
      data[(y * width + x) * 4 + channel] = Math.round(
        sample(ix, iy) * (1 - fx) * (1 - fy) + sample(Math.min(image.width - 1, ix + 1), iy) * fx * (1 - fy) +
        sample(ix, Math.min(image.height - 1, iy + 1)) * (1 - fx) * fy +
        sample(Math.min(image.width - 1, ix + 1), Math.min(image.height - 1, iy + 1)) * fx * fy);
    }
  }
  return { width, height, data };
}

const palette=[{id:'demo-c',name:'Cyan',color:'#00ffff'},{id:'demo-m',name:'Magenta',color:'#ff00ff'},{id:'demo-y',name:'Yellow',color:'#ffff00'},{id:'demo-k',name:'Black',color:'#000000'}];
const pens={cyanPen:'demo-c',magentaPen:'demo-m',yellowPen:'demo-y',blackPen:'demo-k'};
const stats=[];
function pathsSvg(items,width,height,strokeWidth=1,colours=true){return '<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'"><g fill="none" stroke-width="'+strokeWidth+'" stroke-linecap="round" stroke-linejoin="round">'+items.map(item=>'<g stroke="'+(colours?palette.find(p=>p.id===item.penId).color:'#000000')+'">'+item.paths.map(path=>'<path d="'+path.points.map((p,i)=>(i?'L':'M')+p.x.toFixed(4)+' '+p.y.toFixed(4)).join(' ')+'"/>').join('')+'</g>').join('')+'</g></svg>'}
async function render(name,image,changes={}){
  const parameters={...defaults,...pens,...changes};const started=Date.now();
  const input={kind:'bitmap',sourceId:'photo',width:image.width,height:image.height,widthPx:image.width,heightPx:image.height,data:image.data,palette,page:{widthMM:420,heightMM:297},placement:{x:0,y:0,scale:1,rotation:0}};
  const result=run(input,parameters,{runId:name,seed:1,signal:new AbortController().signal,progress(){}});
  const points=result.items.reduce((n,item)=>n+item.paths.reduce((s,p)=>s+p.points.length,0),0), paths=result.items.reduce((n,item)=>n+item.paths.length,0);
  const svg=pathsSvg(result.items,image.width,image.height,parameters.fillSpacing*0.95);
  await writeFile(output+'/'+name+'.svg',svg);
  const rgb=decodePng(new Resvg(svg,{background:'white',fitTo:{mode:'width',value:image.width*2}}).render().asPng());
  await writeFile(output+'/'+name+'-rgb.png',encodePng(rgb));
  // An explicit ideal transparent-ink model made ONLY from the actual paths:
  // render an alpha mask per channel, then multiply their ideal CMY/K transmittances.
  const masks=result.items.map(item=>decodePng(new Resvg(pathsSvg([item],image.width,image.height,parameters.fillSpacing*0.95,false),{fitTo:{mode:'width',value:image.width*2}}).render().asPng()));
  const ideal={width:rgb.width,height:rgb.height,data:new Uint8Array(rgb.data.length)};
  for(let i=0;i<ideal.data.length;i+=4){for(let c=0;c<3;c++)ideal.data[i+c]=Math.round(255*(1-masks[c].data[i+3]/255)*(1-masks[3].data[i+3]/255));ideal.data[i+3]=255;}
  await writeFile(output+'/'+name+'-ideal-ink.png',encodePng(ideal));
  for(const [i,item]of result.items.entries())await writeFile(output+'/'+name+'-'+['c','m','y','k'][i]+'.png',new Resvg(pathsSvg([item],image.width,image.height,parameters.fillSpacing*0.95),{background:'white',fitTo:{mode:'width',value:image.width}}).render().asPng());
  stats.push({name,width:image.width,height:image.height,paths,points,milliseconds:Date.now()-started,parameters,channels:result.items.map(item=>({penId:item.penId,plotOrder:item.plotOrder,paths:item.paths.length}))});
  console.log(name,paths,points);
}
const photo=resize(decodePng(await readFile('docs/images/spiral-sawtooth/portrait-source.png')),384,384);
await writeFile(output+'/photograph-source.png',encodePng(photo));
await render('photograph',photo,{diameter:12,fillSpacing:2.5,tolerance:0.3});
const diagnostics={width:320,height:200,data:new Uint8Array(320*200*4)};
const bands=[[255,255,255],[0,0,0],[0,255,255],[255,0,255],[255,255,0],[255,0,0],[0,255,0],[0,0,255]];
for(let y=0;y<200;y++)for(let x=0;x<320;x++){
  let rgb=y<80?bands[Math.floor(x/40)]:y<140?[x*255/319,x*255/319,x*255/319]:[220,20,120];
  const alpha=x>=156&&x<164?0:y>=140?Math.round((x/319)*255):255;
  diagnostics.data.set([...rgb.map(Math.round),alpha],(y*320+x)*4);
}
await writeFile(output+'/diagnostics-source.png',encodePng(diagnostics));
await render('diagnostics',diagnostics,{diameter:10,fillSpacing:1.5});
await render('diagnostics-outline',diagnostics,{diameter:10,style:'outline'});
await render('diagnostics-equal-size',diagnostics,{diameter:10,toneMode:'number',fillSpacing:1.5});
await writeFile(output+'/statistics.json',JSON.stringify(stats,null,2)+'\n');
