const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../app/src/main/assets/consignment-core.js');
(async()=>{
 let lastAuth='',created=false;const saved=new Map();
 const fields=x=>Object.fromEntries(Object.entries(x).map(([k,v])=>[k,typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(v)}:{stringValue:v}]));
 const owner={name:'projects/test-cudy/databases/(default)/documents/profiles/owner',updateTime:'1',fields:fields({username:'owner@example.test',name:'Owner',role:'admin',rate_bps:0,active:true})};
 const context={window:{CUDY_FIREBASE_CONFIG:{projectId:'test-cudy',apiKey:'public-test-key-123456'},CudyConsignmentCore:C},sessionStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},fetch:async(url,opts)=>{
  lastAuth=opts.headers.Authorization;
  let data;
  if(url.includes('accounts:signInWithPassword'))data={idToken:'OWNER-TOKEN',refreshToken:'owner-refresh',localId:'owner',expiresIn:'3600'};
  else if(url.includes('accounts:signUp'))data={idToken:'DEALER-TOKEN',refreshToken:'dealer-refresh',localId:'dealer',expiresIn:'3600'};
  else if(url.endsWith('/profiles/owner'))data=owner;
  else if(url.endsWith('/profiles?pageSize=100'))data={documents:[owner]};
  else if(url.endsWith('/documents:commit')){created=true;assert.equal(lastAuth,'Bearer OWNER-TOKEN');assert.equal(JSON.parse(opts.body).writes[0].update.fields.role.stringValue,'dealer');data={writeResults:[{}]};}
  else throw Error(url);
  return {ok:true,status:200,json:async()=>data};
 },crypto:require('node:crypto').webcrypto,Uint8Array,Date,Number,Array,Object,String,Error,encodeURIComponent,JSON};
 vm.createContext(context);vm.runInContext(fs.readFileSync('app/src/main/assets/firebase-adapter.js','utf8'),context);
 const api=context.window.CudyCloud;
 assert.equal((await api.request('/api/session','POST',{username:'owner@example.test',password:'fixture-password'})).user.role,'admin');
 await api.request('/api/dealers','POST',{username:'dealer@example.test',password:'fixture-password-123',name:'Dealer',code:'OP01',rate_bps:400});
 assert.equal(created,true);assert.equal(saved.get('cudy-firebase-uid'),'owner');
 await api.request('/api/session','DELETE');assert.equal(api.signedIn(),false);assert.equal(saved.size,0);
 console.log('Auth: password login, owner token preserved during dealer creation, logout clears session: OK');
})().catch(e=>{console.error(e);process.exitCode=1});
