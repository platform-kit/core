/*
 * The saved session: what has been answered, what has been seen, and how the next
 * round is drawn from what has not.
 *
 * S is deliberately one mutable object rather than a store per corpus — it is what
 * gets serialised, and keeping the serialised shape and the in-memory shape the
 * same is what makes the format easy to reason about across versions.
 */
import { STORE as LORO } from '../../lib/store.js';

export let KEY='dl.state.v1', S;
/* Bump whenever scoring changes meaning. Stamped on every stored result (lib/records.js) so old
   snapshots can be told apart from, and re-scored under, a later engine. A site's scorer changes it
   when its meaning changes. */
export let ENGINE_VERSION='1';
export function setEngineVersion(v){ ENGINE_VERSION=String(v); }
/* The booking link is injected by the host. Without one the component renders no
   call to action at all — it has nowhere to send anyone. */
export let COACH=null;
/* the saved session is persisted through Loro like everything else; the facade is
   synchronous, so load() below still runs the moment this module is imported */
export let STORE=LORO;
export function blank(){ return {v:1,ledger:{domain:{},type:{},words:{},books:{}},resp:{domain:[],type:[],words:[],books:[]}}; }
/* Answers saved before ids existed keyed on the sentence itself. Map any of those
   that still match a statement onto its id, once, on load — against the bank the site
   registers (registerBank, from its bank.js); with none there is nothing to map. A sentence
   rewritten since cannot be recovered — which is the whole reason for the change. */
let BANK=[];
export function registerBank(bank){ BANK=bank||[]; migrateIds(); }
export function migrateIds(){
  if(!S||!S.resp||S.idsMigrated||!BANK.length) return;
  var byText={}; BANK.forEach(function(x){ byText[x.t]=x.id; });
  var moved=0;
  (S.resp.domain||[]).forEach(function(r){
    if(r.id&&byText[r.id]){ r.id=byText[r.id]; moved++; } });
  var led=S.ledger&&S.ledger.domain;
  if(led){ var next={};
    Object.keys(led).forEach(function(k){ next[byText[k]||k]=led[k]; });
    S.ledger.domain=next; }
  S.idsMigrated=1;
  if(moved) save();
}
export function load(){
  try{ var r=STORE.get(KEY); S=r?JSON.parse(r):blank(); }catch(e){ S=blank(); }
  if(!S||!S.resp) S=blank();
  /* sessions saved before the teachings test existed */
  if(!S.resp.books) S.resp.books=[];
  if(!S.ledger.books) S.ledger.books={};
  migrateIds();
}
export function save(){ try{ STORE.set(KEY,JSON.stringify(S)); }catch(e){} }
load();
/* The recorder: the host (src/lib/records.js) registers a function that mirrors
   every answer into rows; the engine itself knows nothing about the backend.
   Called with the corpus and the entry, once when the entry is made and again
   whenever a later step amends it. */
export let recorder=null;
export function setRecorder(fn){ recorder=fn; }
export function record(corpus,entry){ if(recorder){ try{ recorder(corpus,entry); }catch(e){} } }
/* A sitting is a run of answering. Rather than tracking a session id, which a reload
   would break, group by when the answers were given: a gap of more than 90 minutes
   starts a new one. Answers saved before stamping existed have no ts and fall into a
   single "earlier" bucket at the front. */
export let SIT_GAP=90*60*1000;
export function sittings(){
  var all=S.resp.domain||[], old=[], ts=[];
  all.forEach(function(r){ (r.ts?ts:old).push(r); });
  ts.sort(function(a,b){return a.ts-b.ts;});
  var out=[];
  if(old.length) out.push({at:null,rows:old});
  var cur=null;
  ts.forEach(function(r){
    if(!cur||r.ts-cur.last>SIT_GAP){ cur={at:r.ts,last:r.ts,rows:[]}; out.push(cur); }
    cur.last=r.ts; cur.rows.push(r); });
  return out;
}
export function seen(corpus,k){ return S.ledger[corpus][k]||0; }
export function mark(corpus,k){ S.ledger[corpus][k]=(S.ledger[corpus][k]||0)+1; }

/* least-seen-first draw: the whole corpus cycles before anything repeats */
export function shuffle(a){var b=a.slice();for(var i=b.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=b[i];b[i]=b[j];b[j]=t;}return b;}
export function draw(corpus,pool,keyFn,n){
  if(!pool.length||n<=0) return [];
  var counts=pool.map(function(x){return seen(corpus,keyFn(x));});
  var lvl=Math.min.apply(null,counts), out=[], guard=0;
  while(out.length<n && guard<12){
    var tier=shuffle(pool.filter(function(x){ return seen(corpus,keyFn(x))===lvl && out.indexOf(x)<0; }));
    out=out.concat(tier.slice(0,n-out.length));
    lvl++; guard++;
  }
  return out;
}

/* Replacing the whole session — what "clear everything" does. It has to happen
   in here: S is a live binding, so reassigning it from another module is not
   possible, but reassigning it here reaches every importer. */
export function setState(next) { S = next }

/* Where answers are kept, and under what key. Set once at mount. */
export function configure(opts) {
  if (opts && opts.key) KEY = opts.key
  if (opts && opts.storage) STORE = opts.storage
}
