const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const C=require('../app/src/main/assets/consignment-core.js');
async function test(role){
 const handlers={},root={innerHTML:'',addEventListener:(k,v)=>handlers[k]=v,querySelectorAll:()=>[],querySelector:()=>({textContent:'',hidden:true})};
 const user={id:role==='admin'?'owner':'d1',name:'Fixture dealer',role,active:true,rate_bps:400,username:'fixture@example.test'};
 const data={settings:{currency:'USD'},items:[{sku:'CUDY-001',model:'Fixture <img onerror=bad()>',price_known:true,price_minor:12345,qty:40,category:'Fixture'}],account:{sales_minor:0,earned_minor:0,paid_minor:0},holdings:[],events:[],reports:[]};
 const document={getElementById:()=>root,documentElement:{lang:'ru'}};
 const context={window:{CudyConsignmentCore:C,CudyCloud:{signedIn:()=>true,request:async p=>p==='/api/me'?{user}:{dealers:[{...user,id:'d1',role:'dealer'}]}},CudyConsignment:{load:async()=>data}},document,Intl,Date,Number,Array,Object,String,JSON,Error,console};
 vm.createContext(context);vm.runInContext(fs.readFileSync('app/src/main/assets/wholesale.js','utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(root.innerHTML.includes('USD'));assert.ok(root.innerHTML.includes('&lt;img onerror=bad()&gt;'));assert.ok(!root.innerHTML.includes('<img onerror=bad()>'));
 async function clickTab(tab){await handlers.click({target:{closest:()=>({dataset:{click:'tab',tab}})}});}
 if(role==='admin'){
  await clickTab('people');assert.ok(root.innerHTML.includes('data-action="dealer"'));assert.ok(root.innerHTML.includes('min="3" max="5"'));assert.ok(root.innerHTML.includes('minlength="12"'));
  await clickTab('operations');for(const op of ['transfer','sale','customer_return','payment','receipt','price'])if(op!=='customer_return')assert.ok(root.innerHTML.includes('data-action="'+op+'"'),op);
 }else{
  assert.ok(!root.innerHTML.includes('data-tab="people"'));assert.ok(!root.innerHTML.includes('data-tab="operations"'));await clickTab('reports');assert.ok(root.innerHTML.includes('data-action="report"'));assert.ok(!root.innerHTML.includes('data-action="sale"'));
 }
 document.documentElement.lang='tk';context.window.CudyWholesale.render();assert.ok(root.innerHTML.includes('Şahsy kabinet'));
}
(async()=>{await test('admin');await test('dealer');console.log('UI: owner/dealer controls, price currency, sale confirmation, password/rate fields, escaped product names and RU/TK rendering: OK')})().catch(e=>{console.error(e);process.exitCode=1});
