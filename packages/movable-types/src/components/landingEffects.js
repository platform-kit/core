/*
 * Landing-page effects, lifted verbatim from atlas.html §landing.
 * Everything is opt-out under prefers-reduced-motion, and everything
 * registers a teardown so the tab can be left and re-entered.
 */
/* the marquee's words; a look's skin of the band reads them too (LandingMarquee.vue) */

export function initLanding() {
  var CLEAN = []
  var on = function (t, ev, fn, opt) { t.addEventListener(ev, fn, opt); CLEAN.push(function () { t.removeEventListener(ev, fn, opt) }) }
  var obs = function (o) { CLEAN.push(function () { o.disconnect() }); return o }

var RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var NS = 'http://www.w3.org/2000/svg';
function el(t,a){var e=document.createElementNS(NS,t);for(var k in a)e.setAttribute(k,a[k]);return e;}
function svg(vb){var s=el('svg',{viewBox:vb});return s;}

/* ---------- marquee ---------- */
/* Two kinds of item, strictly alternating: what you get out of it, and a fact
   about the product. Qualifiers render as filled badges, so the band reads as
   two things taking turns rather than one long list. Keep the arrays the same
   length — they are zipped, and a mismatch would drop the tail of the longer one.
   The benefits cover the six areas between them: Growth, Connection,
   Communication, Survival, Success, Spirituality. */
/* the marquee's words are LandingMarquee's props now; it fills the band itself */

/* ---------- chart wheel ---------- */
function wheel(node,size){
  if(!node) return;
  var s=svg('0 0 200 200'), c=100, R=92, R2=72, R3=52;
  var g=el('g',{});
  g.appendChild(el('circle',{cx:c,cy:c,r:R,'class':'lpwring'}));
  g.appendChild(el('circle',{cx:c,cy:c,r:R2,'class':'lpwring'}));
  g.appendChild(el('circle',{cx:c,cy:c,r:R3,'class':'lpwline'}));
  var glyphs=['♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓'];
  for(var i=0;i<12;i++){
    var a=(i*30-90)*Math.PI/180, a2=((i+.5)*30-90)*Math.PI/180;
    g.appendChild(el('line',{x1:c+Math.cos(a)*R2,y1:c+Math.sin(a)*R2,
      x2:c+Math.cos(a)*R,y2:c+Math.sin(a)*R,'class':'lpwring'}));
    var t=el('text',{x:c+Math.cos(a2)*82,y:c+Math.sin(a2)*82+3.4,'class':'lpwtxt','text-anchor':'middle'});
    t.textContent=glyphs[i]; g.appendChild(t);
  }
  s.appendChild(g);
  if(!RM) g.setAttribute('class','lprot');
  /* house spokes */
  var h=el('g',{});
  for(var j=0;j<12;j++){
    var b=(j*30-90+7)*Math.PI/180;
    h.appendChild(el('line',{x1:c,y1:c,x2:c+Math.cos(b)*R3,y2:c+Math.sin(b)*R3,'class':'lpwline'}));
  }
  s.appendChild(h);
  /* planets + aspect lines */
  var pl=[12,58,104,151,196,243,289,335,20,73];
  var pts=pl.map(function(d){var r=(d-90)*Math.PI/180;return [c+Math.cos(r)*62,c+Math.sin(r)*62];});
  var asp=el('g',{});
  [[0,4],[1,6],[2,7],[3,8],[5,9],[0,6]].forEach(function(p){
    asp.appendChild(el('line',{x1:pts[p[0]][0],y1:pts[p[0]][1],x2:pts[p[1]][0],y2:pts[p[1]][1],'class':'lpwacc'}));
  });
  asp.setAttribute('opacity','.55');
  s.appendChild(asp);
  var pg=el('g',{});
  pts.forEach(function(p){ pg.appendChild(el('circle',{cx:p[0],cy:p[1],r:3.1,'class':'lpwdot'})); });
  s.appendChild(pg);
  node.appendChild(s);
}
wheel(document.getElementById('lpwheelArt'));

/* refusal / cross art */
(function(){
  var n=document.getElementById('lpcrossArt'); if(!n) return;
  var s=svg('0 0 200 200');
  s.appendChild(el('circle',{cx:100,cy:100,r:74,'class':'lpwring'}));
  s.appendChild(el('circle',{cx:100,cy:100,r:54,'class':'lpwline'}));
  for(var i=0;i<12;i++){
    var a=(i*30)*Math.PI/180;
    s.appendChild(el('line',{x1:100+Math.cos(a)*54,y1:100+Math.sin(a)*54,
      x2:100+Math.cos(a)*74,y2:100+Math.sin(a)*74,'class':'lpwring'}));
  }
  var g=el('g',{'class':'lpwacc'});
  g.appendChild(el('line',{x1:66,y1:66,x2:134,y2:134}));
  g.appendChild(el('line',{x1:134,y1:66,x2:66,y2:134}));
  g.setAttribute('stroke-width','2.4');
  s.appendChild(g);
  if(!RM) s.querySelector('circle').setAttribute('class','lpwring lprot');
  n.appendChild(s);
})();

/* close-section mandala */
(function(){
  var n=document.getElementById('lpcloseArt'); if(!n) return;
  var s=svg('0 0 200 200'); var g=el('g',{});
  for(var r=22;r<=92;r+=14) g.appendChild(el('circle',{cx:100,cy:100,r:r,'class':'lpwring'}));
  for(var i=0;i<24;i++){
    var a=(i*15)*Math.PI/180;
    g.appendChild(el('line',{x1:100,y1:100,x2:100+Math.cos(a)*92,y2:100+Math.sin(a)*92,'class':'lpwline'}));
  }
  g.appendChild(el('path',{d:'M100 14 L174 143 L26 143 Z','class':'lpwacc'}));
  g.appendChild(el('path',{d:'M100 186 L26 57 L174 57 Z','class':'lpwacc'}));
  if(!RM) g.setAttribute('class','lprot');
  s.appendChild(g); n.appendChild(s);
})();

/* ---------- bento lane art ---------- */
function laneArt(id,draw){var n=document.getElementById(id); if(!n)return; var s=svg('0 0 320 132'); draw(s); n.appendChild(s);}
laneArt('lpartMeasure',function(s){
  var d=[18,20,19,24,26,25,29,32,31,36,39,42], n=d.length;
  var pts=d.map(function(v,i){ return [26+i*(268/(n-1)), 112-(v/50)*86]; });
  var path=pts.map(function(p,i){ return (i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1); }).join(' ');
  var area=path+' L'+pts[n-1][0].toFixed(1)+' 120 L26 120 Z';
  s.appendChild(el('path',{d:area,fill:'var(--accent)',opacity:'.13'}));
  s.appendChild(el('path',{d:path,fill:'none',stroke:'var(--accent)','stroke-width':'2.4',
    'stroke-linecap':'round','stroke-linejoin':'round'}));
  s.appendChild(el('circle',{cx:pts[n-1][0],cy:pts[n-1][1],r:4.6,fill:'var(--accent)'}));
  s.appendChild(el('circle',{cx:pts[0][0],cy:pts[0][1],r:3.2,fill:'var(--accent)',opacity:'.5'}));
});
laneArt('lpartLearn',function(s){
  for(var i=0;i<5;i++){
    s.appendChild(el('rect',{x:40+i*50,y:24+ (i%2?10:0),width:34,height:84,rx:5,
      fill:'none',stroke:'var(--accent)','stroke-width':'1.3',opacity:(1-i*.13)}));
    s.appendChild(el('line',{x1:40+i*50+8,y1:40+(i%2?10:0),x2:40+i*50+26,y2:40+(i%2?10:0),
      stroke:'var(--ink3)','stroke-width':'1.2',opacity:'.5'}));
    s.appendChild(el('line',{x1:40+i*50+8,y1:50+(i%2?10:0),x2:40+i*50+20,y2:50+(i%2?10:0),
      stroke:'var(--ink3)','stroke-width':'1.2',opacity:'.5'}));
  }
});
laneArt('lpartPractice',function(s){
  for(var i=0;i<26;i++){
    var h=18+Math.abs(Math.sin(i*.7))*72;
    s.appendChild(el('rect',{x:22+i*11,y:66-h/2,width:5,height:h,rx:2.5,
      fill:'var(--accent)',opacity:(.35+Math.abs(Math.sin(i*.7))*.5).toFixed(2)}));
  }
});
laneArt('lpartConnect',function(s){
  var pos=[[110,66],[160,44],[210,66],[160,90],[135,55],[185,55],[135,77],[185,77]];
  pos.forEach(function(p,i){
    s.appendChild(el('line',{x1:160,y1:66,x2:p[0],y2:p[1],stroke:'var(--accent)','stroke-width':'1.1',opacity:'.5'}));
  });
  pos.forEach(function(p){ s.appendChild(el('circle',{cx:p[0],cy:p[1],r:7,fill:'none',
    stroke:'var(--accent)','stroke-width':'1.4'})); });
  s.appendChild(el('circle',{cx:160,cy:66,r:11,fill:'var(--accent)',opacity:'.9'}));
});

/* waves */
(function(){
  var w=document.getElementById('lpwaves'); if(!w) return;
  for(var i=0;i<22;i++){
    var b=document.createElement('i');
    b.style.height=(22+Math.abs(Math.sin(i*.6))*100)+'px';
    b.style.animationDelay=(i*.08)+'s';
    w.appendChild(b);
  }
})();

/* ---------- the hero's sky: NOT the theme's ----------
   A slow drift of points behind the hero's words used to be animated here, on a canvas the hero
   itself rendered. It belongs to the SITE, not here: a sky suits one kind of site and suits nothing
   else, and every site built on the kit was wearing it.
   The hero has an empty `behind` slot now, and the site that wants a sky fills it with its own
   canvas and its own effect — src/components/landing/skins/HeroSkin.vue in the site. Nothing of
   the hero is rewritten to do it. */

/* ---------- trend chart ---------- */
(function(){
  var host=document.getElementById('lptrendHost'); if(!host) return;
  var SER=[
    {name:'Survival',   v:'--s1', d:[18,20,19,24,26,25,29,32,31,36,39,42]},
    {name:'Success',    v:'--s2', d:[22,23,22,26,27,30,29,33,34,36,38,41]},
    {name:'Spirituality',v:'--s3',d:[88,89,87,88,88,86,87,88,86,87,86,87]}
  ];
  var N=12, W=760, H=330, L=42, R=126, T=18, B=44;
  var pw=W-L-R, ph=H-T-B;
  var X=function(i){ return L + i*(pw/(N-1)); };
  var Y=function(v){ return T + (1-v/100)*ph; };

  var s=el('svg',{viewBox:'0 0 '+W+' '+H,'class':'lptsvg'});
  s.setAttribute('role','img');
  s.setAttribute('aria-label','Twelve weekly rounds. Survival rises from 18 to 42, Success from 22 to 41, Spirituality stays near 87.');

  [0,25,50,75,100].forEach(function(g){
    s.appendChild(el('line',{x1:L,y1:Y(g),x2:L+pw,y2:Y(g),'class':'lpgl'}));
    var t=el('text',{x:L-10,y:Y(g)+3.5,'class':'lpal','text-anchor':'end'}); t.textContent=g; s.appendChild(t);
  });
  for(var i=0;i<N;i+=2){
    var t2=el('text',{x:X(i),y:H-B+22,'class':'lpal','text-anchor':'middle'});
    t2.textContent='wk '+(i+1); s.appendChild(t2);
  }

  var cross=el('line',{x1:0,y1:T,x2:0,y2:T+ph,'class':'lpcross'}); s.appendChild(cross);

  var paths=[];
  SER.forEach(function(se){
    var d=se.d.map(function(v,i){ return (i?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1); }).join(' ');
    var pth=el('path',{d:d,'class':'lpln',stroke:'var('+se.v+')'});
    s.appendChild(pth); paths.push(pth);
    /* end marker + direct label */
    s.appendChild(el('circle',{cx:X(N-1),cy:Y(se.d[N-1]),r:5,fill:'var('+se.v+')'}));
    var lb=el('text',{x:X(N-1)+13,y:Y(se.d[N-1])+4,'class':'lpdlab',fill:'var('+se.v+')'});
    lb.textContent=se.name+' '+se.d[N-1]; s.appendChild(lb);
  });

  var hd=el('g',{opacity:'0'}); 
  var hdots=SER.map(function(se){
    var c=el('circle',{r:5.5,fill:'var('+se.v+')',stroke:'var(--card2)','stroke-width':'2'});
    hd.appendChild(c); return c;
  });
  s.appendChild(hd);

  var hit=el('rect',{x:L,y:T,width:pw,height:ph,fill:'transparent'});
  s.appendChild(hit);
  host.appendChild(s);

  var tip=document.createElement('div'); tip.className='lptip'; host.appendChild(tip);

  function show(ev){
    var r=s.getBoundingClientRect();
    var px=(ev.clientX-r.left)/r.width*W;
    var i=Math.round((px-L)/(pw/(N-1)));
    i=Math.max(0,Math.min(N-1,i));
    cross.setAttribute('x1',X(i)); cross.setAttribute('x2',X(i));
    cross.style.opacity='1'; hd.setAttribute('opacity','1');
    hdots.forEach(function(c,k){ c.setAttribute('cx',X(i)); c.setAttribute('cy',Y(SER[k].d[i])); });
    tip.innerHTML='<div class="tw">Week '+(i+1)+'</div>'+SER.map(function(se){
      return '<div class="tr"><span><i style="background:var('+se.v+')"></i>'+se.name+
             '</span><b class="num">'+se.d[i]+'</b></div>';
    }).join('');
    var hr=host.getBoundingClientRect();
    var left=(X(i)/W)*hr.width;
    tip.style.opacity='1';
    var tw=tip.offsetWidth;
    tip.style.left=Math.max(4,Math.min(hr.width-tw-4,left-tw/2))+'px';
    tip.style.top='6px';
  }
  function hide(){ cross.style.opacity='0'; hd.setAttribute('opacity','0'); tip.style.opacity='0'; }
  on(hit,'pointermove',show);
  on(hit,'pointerleave',hide);

  /* draw-in on scroll */
  if(!RM){
    paths.forEach(function(pt){
      var len=pt.getTotalLength();
      pt.style.strokeDasharray=len; pt.style.strokeDashoffset=len;
    });
    var dots=s.querySelectorAll('circle'), labs=s.querySelectorAll('.lpdlab');
    Array.prototype.forEach.call(dots,function(n){ n.style.opacity='0'; });
    Array.prototype.forEach.call(labs,function(n){ n.style.opacity='0'; });
    var io2=obs(new IntersectionObserver(function(es){
      es.forEach(function(e){
        if(!e.isIntersecting) return;
        io2.unobserve(e.target);
        paths.forEach(function(pt,k){
          pt.style.transition='stroke-dashoffset 1.5s cubic-bezier(.3,.8,.3,1) '+(k*.18)+'s';
          pt.style.strokeDashoffset='0';
        });
        setTimeout(function(){
          Array.prototype.forEach.call(dots,function(n){ n.style.transition='opacity .5s'; n.style.opacity=''; });
          Array.prototype.forEach.call(labs,function(n){ n.style.transition='opacity .5s'; n.style.opacity=''; });
        },1250);
      });
    },{threshold:.25}));
    io2.observe(host);
  }
})();

/* ---------- reveals ----------
   The blocks are visible until this runs (atlas.css hides .lprv only under
   .lprvwatch), so a page that never gets here loses nothing. What is already on
   screen is marked revealed before the watch begins, in the same frame, so it
   never blinks; everything below fades in as it arrives. */
var io=obs(new IntersectionObserver(function(es){
  es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('lpin'); io.unobserve(e.target); } });
},{rootMargin:'0px 0px -6% 0px',threshold:.1}));
var revs=document.querySelectorAll('.lprv');
if(revs.length&&!RM){
  var vh=window.innerHeight||document.documentElement.clientHeight;
  /* the watch goes on first and the styles are flushed, so the pieces inside a
     block that is already on screen have a hidden state to arrive from — the
     block itself is marked in the same task, before any paint, so it never blinks */
  document.documentElement.classList.add('lprvwatch');
  CLEAN.push(function(){ document.documentElement.classList.remove('lprvwatch'); });
  void document.documentElement.offsetWidth;
  revs.forEach(function(n){ var r=n.getBoundingClientRect();
    if(r.bottom>0&&r.top<vh){ n.classList.add('lpnow'); n.classList.add('lpin'); } });
  revs.forEach(function(n){ if(!n.classList.contains('lpin')) io.observe(n); });
  /* a block that arrives later — a section that came as its own chunk, a tile the ticker doubled —
     is watched as it lands, so nothing stays hidden for having missed the first pass */
  var mo=obs(new MutationObserver(function(ms){
    ms.forEach(function(m){ m.addedNodes.forEach(function(n){ if(n.nodeType!==1) return;
      var list=n.classList&&n.classList.contains('lprv')?[n]:[]; n.querySelectorAll&&n.querySelectorAll('.lprv').forEach(function(x){ list.push(x); });
      list.forEach(function(x){ if(!x.classList.contains('lpin')) io.observe(x); }); }); });
  }));
  var root=document.querySelector('.lproot')||document.body; mo.observe(root,{childList:true,subtree:true});
  /* the foot of the page: a block in the last few percent of the viewport never crosses the margin above, so
     when the page is scrolled to its end whatever is still hidden is shown (the footer's legal line) */
  var onEnd=function(){ var d=document.documentElement; if(window.scrollY+window.innerHeight>=d.scrollHeight-4){ document.querySelectorAll('.lprv:not(.lpin)').forEach(function(n){ var r=n.getBoundingClientRect(); if(r.top<window.innerHeight){ n.classList.add('lpin'); io.unobserve(n); } }); } };
  window.addEventListener('scroll',onEnd,{passive:true}); CLEAN.push(function(){ window.removeEventListener('scroll',onEnd); });
}

/* chart bars */
(function(){
  var p=document.querySelector('#lpresult .lppanel'); if(!p) return;
  var ci=obs(new IntersectionObserver(function(es){
    es.forEach(function(e){
      if(e.isIntersecting){
        e.target.querySelectorAll('.lprow').forEach(function(r,i){
          setTimeout(function(){ r.classList.add('lpin'); }, RM?0:i*80);
        });
        ci.unobserve(e.target);
      }
    });
  /* the same trigger geometry as the card reveals: the card faded in at 10%
     of a very tall panel while the bars waited for 22%, so stopping a scroll
     in between showed a finished card with empty tracks */
  },{rootMargin:'0px 0px -6% 0px',threshold:.05}));
  ci.observe(p);
})();

/* The count-up animation lived here. Its only elements were the stats bar's four
   figures, which went with the bar. */

/* ---------- sticky routing ---------- */
(function(){
  var beats=document.querySelectorAll('#lpbeats .lpbeat');
  var viss=document.querySelectorAll('#lpvis .lpvis');
  if(!beats.length) return;
  function setActive(i){
    beats.forEach(function(b,j){ b.classList.toggle('lpon', j===i); });
    viss.forEach(function(v,j){ v.classList.toggle('lpon', j===i); });
  }
  var bo=obs(new IntersectionObserver(function(es){
    es.forEach(function(e){
      if(e.isIntersecting) setActive(parseInt(e.target.getAttribute('data-vis'),10));
    });
  },{rootMargin:'-45% 0px -45% 0px',threshold:0}));
  beats.forEach(function(b){ bo.observe(b); });
  setActive(0);
})();

/* ---------- pointer glow on area cards ---------- */
document.querySelectorAll('#lpareas .lparea').forEach(function(c){
  on(c,'pointermove',function(ev){
    var r=c.getBoundingClientRect();
    c.style.setProperty('--mx',(ev.clientX-r.left)+'px');
    c.style.setProperty('--my',(ev.clientY-r.top)+'px');
  });
});

/* The parallax and sticky-nav handler lived here. Its only parallax element was
   the tracked-metrics card, and the nav went earlier, so it was a scroll listener
   doing nothing on every frame. */

  return function () { CLEAN.forEach(function (f) { try { f() } catch (e) { /* already gone */ } }); CLEAN = [] }
}
