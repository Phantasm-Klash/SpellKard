/**
 * 原生客户端弹幕渲染压力 E2E（CDP 探针）。
 *
 * 前置：原生 .exe 的 config.ini 里 `JSDebugMode=1` / `JSDebugPort=5959`，
 * 且进程已启动。用法：node dev/danmaku_render_load.mjs
 *
 * 为什么量「每帧 CPU 耗时」而不是 FPS：conch 的 rAF 在窗口失焦时会被限到
 * ~30fps，后台测出的 FPS 绝对值没有意义。这里在 frameLoop 回调内直接量
 * 位置更新循环的耗时，不受 rAF 限流影响，才是弹幕数量的真实开销。
 *
 * 局限：用共享纹理的自造 Sprite，测的是「逐帧更新 N 个实体」的 CPU 成本，
 * 不含图集帧切片/对象池/剔除，也不含 GPU 提交。作为「密度会不会压垮客户端」
 * 的上界判断够用，不能当完整渲染 profile。
 */
const ws=new WebSocket('ws://127.0.0.1:5959/laya');
const pending=new Map(); let seq=0, ctxId=null;
const send=(m,p={})=>{const id=++seq;ws.send(JSON.stringify({id,method:m,params:p}));return new Promise(r=>pending.set(id,r));};
ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);return;}if(m.method==='Runtime.executionContextCreated')ctxId=m.params.context.id;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function ev(e){const r=await send('Runtime.evaluate',{expression:e,contextId:ctxId,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)return {err:String(r.result.exceptionDetails.exception?.description??'').slice(0,200)};return r.result?.result?.value;}
const probe = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = { texture:'n/a', samples:[] };
  let tex = null;
  try { tex = await Laya.loader.load('resources/tna/ebullet_1.png','image'); out.texture = tex ? 'OK' : 'null'; }
  catch(e) { out.texture = 'ERR '+String(e).slice(0,60); }
  const layer = new Laya.Sprite(); Laya.stage.addChild(layer);
  const sprites = [];
  let tick=0, accum=0, frames=0, costs=[];
  const step = () => {
    const a = performance.now();
    tick += 1;
    for (let i=0;i<sprites.length;i++) {
      const s=sprites[i];
      s.x = 20 + ((i*37 + tick*3)%900);
      s.y = 40 + ((i*53 + tick*2)%680);
    }
    const b = performance.now();
    accum += b-a; frames += 1; costs.push(b-a);
  };
  const measure = async (label,n) => {
    while (sprites.length<n) {
      const s=new Laya.Sprite();
      if(tex){ try{ s.texture=tex; s.size(16,16); }catch(e){} }
      s.pos(20+(sprites.length*37)%900,40+(sprites.length*53)%680);
      layer.addChild(s); sprites.push(s);
    }
    accum=0; frames=0; costs=[];
    const f0=Laya.timer.currFrame, t0=performance.now();
    await sleep(2000);
    const dt=(performance.now()-t0)/1000;
    costs.sort((x,y)=>x-y);
    out.samples.push({ label, sprites:sprites.length, frames,
      avgCostMs:+(accum/(frames||1)).toFixed(3),
      p95CostMs:+(costs.length?costs[Math.floor(costs.length*0.95)]:0).toFixed(3),
      fps:+((Laya.timer.currFrame-f0)/dt).toFixed(1) });
  };
  Laya.timer.frameLoop(1,null,step);
  try { await measure('empty',0); await measure('medium',200); await measure('tna-peak',768); }
  finally { Laya.timer.clear(null,step); layer.removeChildren(); Laya.stage.removeChild(layer); }
  return JSON.stringify(out);
})()`;
ws.onopen=async()=>{await send('Runtime.enable');await sleep(2600);
  console.log(String(await ev(probe)).slice(0,900)); ws.close();};
ws.onerror=e=>console.log('ERR',e.message??e);
setTimeout(()=>process.exit(1),40000);
