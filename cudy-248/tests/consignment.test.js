const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const {webcrypto}=require('node:crypto');
const C=require('../app/src/main/assets/consignment-core.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const settings={currency:'USD'},profile={role:'dealer',active:true,rate_bps:400};
const product={sku:'CUDY-001',model:'Fixture Router A',description:'Router',category:'Wi-Fi',price_minor:1250,price_known:true,opening_qty:100,qty:100,source_row:3,source_no:1};
let state={settings,profile,product,holding:{sku:product.sku,model:product.model,qty:0},account:{sales_minor:0,earned_minor:0,paid_minor:0}};
const input={quantity:10,created_at:new Date().toISOString(),request_key:'a'.repeat(64)};
let p=C.plan('transfer',input,state);assert.equal(p.product.qty,90);assert.equal(p.holding.qty,10);assert.equal(p.event.commission_minor,0);assert.equal(p.account,undefined);
state={...state,product:p.product,holding:p.holding};
p=C.plan('sale',{...input,quantity:3,unit_price_minor:1250,reference:'S001'},state);assert.equal(p.event.amount_minor,3750);assert.equal(p.event.commission_minor,150);assert.equal(p.holding.qty,7);
assert.throws(()=>C.plan('sale',{...input,quantity:20,unit_price_minor:1250},state),/остатка/);
assert.throws(()=>C.plan('transfer',{...input,quantity:1000},state),/недостаточно/);
assert.throws(()=>C.rate('2.99'));assert.throws(()=>C.rate('5.01'));assert.equal(C.rate('3,5'),350);assert.equal(C.amount('12,50'),1250);assert.equal(C.amount('0',true),0);
const original={...p.event,quantity:3,unit_price_minor:33,amount_minor:99,rate_bps:500,commission_minor:5,returned_qty:0,reversed_minor:0};
state={...state,profile:{...profile,rate_bps:300},holding:{...state.holding,qty:0},account:{sales_minor:99,earned_minor:5,paid_minor:5},sale:original};
let reversed=0;
for(let i=0;i<3;i++){let r=C.plan('customer_return',{...input,quantity:1,source_event:'sale1'},state);reversed+=r.event.commission_minor;state={...state,holding:r.holding,account:r.account,sale:r.sale};}
assert.equal(reversed,5);assert.equal(state.account.earned_minor,0);assert.equal(state.account.paid_minor,5);assert.equal(state.holding.qty,3);assert.throws(()=>C.plan('customer_return',{...input,quantity:1},state),/проданное/);
assert.throws(()=>C.plan('payment',{amount_minor:1},state),/превышает/);
console.log('Core: transfer without bonus, 3–5% boundaries, stock caps, rounding, historic rate and complete reversal: OK');
async function apiTests(){
 const docs=new Map();let revision=0,actor='owner',loseReply=false;
 function set(path,data){docs.set(path,{...clone(data),id:path.split('/').pop(),_updateTime:String(++revision)})}
 set('/profiles/owner',{role:'admin',active:true,rate_bps:0,name:'Owner'});set('/profiles/d1',{...profile,name:'Dealer 1'});set('/consignment/settings',settings);set('/consignmentItems/CUDY-001',product);
 const S={me:async()=>clone(docs.get('/profiles/'+actor)),admin:async()=>{if(actor!=='owner')throw Error('Только владелец');},get:async(path,optional)=>{if(!docs.has(path)){if(optional)return null;throw Error('NOT_FOUND '+path)}return clone(docs.get(path));},list:async(path)=>Array.from(docs.entries()).filter(([k])=>k.startsWith(path+'/')&&!k.slice(path.length+1).includes('/')).map(([,v])=>clone(v)),write:(path,data,before)=>({path,data,before}),commit:async writes=>{
  for(const w of writes){const old=docs.get(w.path);if(w.before?(!old||old._updateTime!==w.before._updateTime):old)throw Error('FAILED_PRECONDITION');}
  writes.forEach(w=>set(w.path,w.data));if(loseReply){loseReply=false;throw Error('Network reply lost')}
 }};
 const ctx={window:{CudyConsignmentCore:C,CudyCloud:{storage:S}},crypto:webcrypto,TextEncoder,Uint8Array,Date,Number,Array,Object,String,encodeURIComponent,decodeURIComponent,JSON,Error};vm.createContext(ctx);vm.runInContext(fs.readFileSync('app/src/main/assets/consignment-api.js','utf8'),ctx);
 const api=ctx.window.CudyConsignment;
 const transfer={dealer_id:'d1',sku:'CUDY-001',quantity:10,reference:'T1',operation_id:'transfer-00000001'};
 loseReply=true;const retry=await api.action('transfer',transfer);assert.equal(retry.already,true);assert.equal(docs.get('/consignmentItems/CUDY-001').qty,90);assert.equal(docs.get('/consignmentAccounts/d1/stock/CUDY-001').qty,10);assert.equal(docs.has('/consignmentAccounts/d1'),false);
 await api.action('transfer',transfer);assert.equal(docs.get('/consignmentItems/CUDY-001').qty,90);
 await assert.rejects(()=>api.action('transfer',{...transfer,quantity:11}),/другой записью/);
 actor='d1';await assert.rejects(()=>api.action('payment',{dealer_id:'d1',amount_minor:100,operation_id:'payment-00000001'}),/владелец/);
 const report={sku:'CUDY-001',quantity:2,unit_price_minor:1250,reference:'R1',operation_id:'report-00000001'};await api.submitReport(report);assert.equal(docs.get('/consignmentAccounts/d1/stock/CUDY-001').qty,10);assert.equal(docs.has('/consignmentAccounts/d1'),false);
 actor='owner';await api.action('sale',{...report,dealer_id:'d1',report_id:report.operation_id,operation_id:'sale-00000001'});assert.equal(docs.get('/consignmentAccounts/d1/reports/'+report.operation_id).status,'approved');assert.equal(docs.get('/consignmentAccounts/d1/stock/CUDY-001').qty,8);assert.equal(docs.get('/consignmentAccounts/d1').earned_minor,100);
 await assert.rejects(()=>api.action('sale',{...report,dealer_id:'d1',operation_id:'sale-00000002'}),/FAILED_PRECONDITION/);assert.equal(docs.get('/consignmentAccounts/d1').earned_minor,100);
 // A rate change must not alter the reversal of an old 4% sale.
 set('/profiles/d1',{...profile,rate_bps:500,name:'Dealer 1'});
 await api.action('customer_return',{dealer_id:'d1',sku:'CUDY-001',source_event:'sale-00000001',quantity:1,reference:'RET1',operation_id:'return-00000001'});assert.equal(docs.get('/consignmentAccounts/d1').earned_minor,50);assert.equal(docs.get('/consignmentAccounts/d1/stock/CUDY-001').qty,9);
 const payments=await Promise.allSettled([api.action('payment',{dealer_id:'d1',amount_minor:40,operation_id:'payment-00000001'}),api.action('payment',{dealer_id:'d1',amount_minor:40,operation_id:'payment-00000002'})]);assert.equal(payments.filter(p=>p.status==='fulfilled').length,1);assert.equal(docs.get('/consignmentAccounts/d1').paid_minor,40);
 actor='d1';await api.submitReport({...report,reference:'R2',operation_id:'report-00000002'});actor='owner';await api.rejectReport('d1','report-00000002');assert.equal(docs.get('/consignmentAccounts/d1/reports/report-00000002').status,'rejected');assert.equal(docs.get('/consignmentAccounts/d1').earned_minor,50);
 await assert.rejects(()=>api.initialize({schema:'cudy-owner-stock-v1',items:[]},'USD'));
 console.log('API: pending report, owner approval, atomic stock/bonus, rejected report, duplicate invoice, lost response, concurrent payments and role check: OK');
}
apiTests().catch(e=>{console.error(e);process.exitCode=1});
