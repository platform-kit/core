/*
 * Voice input, opt-in. Three things get measured and none of them is an inference
 * about a feeling: how long before speaking, whether the utterance broke into
 * pieces, and whether the words matched the prompt.
 *
 * The third is the strongest and the least contestable, because it compares what
 * was said against what was asked rather than claiming anything about an inner
 * state. Timing never leaves the device. Recognition does, which is why it is a
 * separate consent from the microphone itself, and why 'timing' is its own mode.
 *
 * Nothing is recorded. The energy envelope is read frame by frame and discarded.
 */

import { S, save } from './session.js';

export let VOICE={mode:'off'};                 /* 'off' | 'timing' | 'full' */
export const VOICEN={off:'Off',timing:'Timing only',full:'On'};
/* the answer to the offer is a preference, so it outlives the round. This has to sit
   after the declaration above, not next to load() — VOICE is hoisted but unassigned
   that early, and the assignment would be thrown away a moment later. */
if(S&&S.voiceMode&&VOICEN[S.voiceMode]) VOICE.mode=S.voiceMode;
export function voiceSupport(){
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  return {mic:!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia), words:!!SR};
}
export function normWords(t){
  return String(t||'').toLowerCase().replace(/[’']/g,"'")
    .replace(/[^a-z0-9\s']/g,' ').replace(/\s+/g,' ').trim().split(' ').filter(Boolean);
}
export function lcsLen(a,b){
  var n=b.length, prev=[], cur=[], i, j;
  for(j=0;j<=n;j++) prev[j]=0;
  for(i=1;i<=a.length;i++){ cur=[0];
    for(j=1;j<=n;j++) cur[j]=(a[i-1]===b[j-1])?prev[j-1]+1:Math.max(prev[j],cur[j-1]);
    prev=cur; }
  return prev[n]||0;
}
/* how much of the prompt actually got said, and how much got added */
export function promptFit(target,said){
  var A=normWords(target), B=normWords(said);
  if(!A.length) return null;
  if(!B.length) return {kept:0,added:0,words:A.length,spoken:0};
  var l=lcsLen(A,B);
  return {kept:l/A.length, added:Math.max(0,B.length-l), words:A.length, spoken:B.length};
}

/* The microphone is armed once, when the offer is accepted, and stays open for the
   round. Two reasons, both about the measurement rather than convenience:

     1. The clock has to start when the sentence appears, not when someone presses
        a button. A tap puts a decision and a hand movement in between, which is
        exactly the interval we are trying to read.
     2. The room's noise floor is calibrated once, up front. Calibrating per item
        would blind the first half-second of every one — the half-second that
        matters most.

   Nothing is recorded. The energy envelope is read frame by frame and discarded. */
export const MIC={stream:null,ctx:null,an:null,buf:null,floor:null,raf:null,take:null,level:0,arming:null,err:null,ok:false};

/* Is there a usable microphone? Answered once, at startup, and silently — if the
   answer is no the option is simply never offered. Four things have to hold: the
   API exists, the page is on a secure origin, the frame we are in permits it (a
   cross-origin iframe without allow="microphone" does not), and the machine
   actually has an input device. enumerateDevices reports the kind of each device
   without labels before permission is granted, which is enough to know one exists
   without prompting anybody. */
export function micUsable(){
  if(!(navigator.mediaDevices&&navigator.mediaDevices.enumerateDevices&&
       navigator.mediaDevices.getUserMedia)) return Promise.resolve(false);
  if(window.isSecureContext===false) return Promise.resolve(false);
  try{ var fp=document.permissionsPolicy||document.featurePolicy;
    if(fp&&fp.allowsFeature&&!fp.allowsFeature('microphone')) return Promise.resolve(false);
  }catch(e){}
  return navigator.mediaDevices.enumerateDevices().then(function(list){
    for(var i=0;i<list.length;i++) if(list[i].kind==='audioinput') return true;
    return false;
  }).catch(function(){ return false; });
}
/* MIC.ok starts false so nothing ever flashes on screen and then disappears */
export function micProbe(){
  micUsable().then(function(ok){
    if(ok===MIC.ok) return;
    MIC.ok=ok;
    if(!ok) VOICE.mode='off';
    if(typeof mode!=='undefined'&&mode==='home'&&typeof home==='function') home();
  });
}
export function micArm(){
  if(MIC.stream) return Promise.resolve(true);
  if(MIC.arming) return MIC.arming;              /* one request, however many callers */
  if(!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia)) return Promise.resolve(false);
  MIC.arming=navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}})
    .then(function(st){
      MIC.stream=st;
      var AC=window.AudioContext||window.webkitAudioContext;
      MIC.ctx=new AC();
      if(MIC.ctx.state==='suspended'){ try{ MIC.ctx.resume(); }catch(e){} }
      var src=MIC.ctx.createMediaStreamSource(st);
      MIC.an=MIC.ctx.createAnalyser(); MIC.an.fftSize=1024; MIC.an.smoothingTimeConstant=0.2;
      src.connect(MIC.an); MIC.buf=new Uint8Array(MIC.an.fftSize);
      micLoop();
      MIC.arming=null;
      return true;
    }).catch(function(e){ MIC.err=(e&&e.name)||'failed'; MIC.ok=false; VOICE.mode='off';
      MIC.arming=null; return false; });
  return MIC.arming;
}
export function micDisarm(){
  if(MIC.raf) cancelAnimationFrame(MIC.raf);
  if(MIC.take) MIC.take.abort('left');
  try{ if(MIC.stream) MIC.stream.getTracks().forEach(function(t){t.stop();}); }catch(e){}
  try{ if(MIC.ctx&&MIC.ctx.close) MIC.ctx.close(); }catch(e){}
  MIC.stream=MIC.ctx=MIC.an=MIC.buf=MIC.raf=MIC.take=null; MIC.floor=null; MIC.level=0;
}
/* one loop for the whole round: keeps the noise floor current between items and
   feeds whichever take is open */
export function micLoop(){
  MIC.raf=requestAnimationFrame(micLoop);
  if(!MIC.an) return;
  MIC.an.getByteTimeDomainData(MIC.buf);
  var sum=0,i,v; for(i=0;i<MIC.buf.length;i++){ v=(MIC.buf[i]-128)/128; sum+=v*v; }
  var rms=Math.sqrt(sum/MIC.buf.length), now=performance.now(), t=MIC.take;
  var thr=Math.max((MIC.floor||0.005)*3.2,0.012);
  MIC.level=Math.min(1,rms/Math.max(thr*2.2,0.03));
  if(!t){                                    /* between items: track the room */
    MIC.floor=MIC.floor===null?rms:(MIC.floor*0.96+rms*0.04);
    return;
  }
  if(t.onLevel) t.onLevel(MIC.level);
  var loud=rms>thr;
  if(loud){
    if(!t.inSeg){ t.inSeg=true; t.segs++; if(t.onset===null) t.onset=now; }
    t.last=now;
  } else if(t.inSeg&&now-t.last>320){ t.inSeg=false; }
  if(t.onset!==null&&now-t.last>1100) t.close('done');
  else if(t.onset===null&&now-t.t0>12000) t.close('silent');
  else if(t.onset!==null&&now-t.onset>20000) t.close('timeout');
}

/* Listen for one statement. t0 is when the sentence became visible, passed in by
   the screen — never when a button was pressed. */
export function micListen(opt){
  var rec=null, text='', closed=false;
  var t={t0:opt.t0,onset:null,last:null,segs:0,inSeg:false,onLevel:opt.onLevel,
    close:function(why){
      if(closed) return; closed=true; MIC.take=null;
      try{ if(rec) rec.stop(); }catch(e){}
      var out={onset:t.onset===null?null:Math.round(t.onset-t.t0),
               dur:(t.onset!==null&&t.last!==null)?Math.round(t.last-t.onset):null,
               breaks:Math.max(0,t.segs-1), text:text.trim(), why:why};
      if(opt.target) out.fit=promptFit(opt.target,out.text);
      opt.onDone(out);
    },
    abort:function(why){ t.close(why); }};
  MIC.take=t;
  if(VOICE.mode==='full'){
    var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(SR){ try{
      rec=new SR(); rec.continuous=false; rec.interimResults=true;
      rec.lang=(navigator.language||'en-US');
      rec.onresult=function(e){ var x='';
        for(var k=0;k<e.results.length;k++) x+=e.results[k][0].transcript+' ';
        text=x; if(opt.onPartial) opt.onPartial(x.trim()); };
      rec.onerror=function(){};              /* timing stands on its own */
      rec.start();
    }catch(e){ rec=null; } }
  }
  return t;
}
