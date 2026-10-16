(function(){
 'use strict';var C=window.CudyConsignmentCore,S=window.CudyCloud.storage;
 function safe(id){if(!/^[A-Za-z0-9_-]{1,120}$/.test(id||''))throw Error('Некорректный код');return id}
 function accountPath(uid){return '/consignmentAccounts/'+safe(uid)}
 async function settings(){return S.get('/consignment/settings',true)}
 async function fingerprint(kind,data){var x=Object.assign({},data);delete x.operation_id;delete x.created_at;var sorted={};Object.keys(x).sort().forEach(function(k){sorted[k]=x[k]});var b=new TextEncoder().encode(kind+'|'+JSON.stringify(sorted));var h=await crypto.subtle.digest('SHA-256',b);return Array.from(new Uint8Array(h),function(v){return v.toString(16).padStart(2,'0')}).join('')}
 async function load(who){
  var me=await S.me();who=me.role==='admin'?who:me.id;
  var set=await settings(),items=await S.list('/consignmentItems');
  if(!who)return {settings:set,items:items,account:null,holdings:[],events:[],reports:[]};
  var path=accountPath(who),data=await Promise.all([S.get(path,true),S.list(path+'/stock'),S.list(path+'/events'),S.list(path+'/reports')]);
  data[2].sort(function(a,b){return b.created_at.localeCompare(a.created_at)});data[3].sort(function(a,b){return b.created_at.localeCompare(a.created_at)});
  return {settings:set,items:items,account:C.account(data[0]),holdings:data[1],events:data[2],reports:data[3]};
 }
 async function initialize(seed,currency){
  await S.admin();if(!['USD','TMT','EUR','CNY','RUB','AED'].includes(currency))throw Error('Выберите валюту исходных цен');
  var items=C.validateSeed(seed);if(seed.currency&&seed.currency!==currency)throw Error('Валюта файла '+seed.currency+' отличается от выбранной. Цены не пересчитываются автоматически.');if(await settings())throw Error('Склад уже настроен. Повторный импорт запрещён, используйте поступления и изменения цен.');
  var writes=[S.write('/consignment/settings',{currency:currency,schema:1,source_name:String(seed.source_name||'').slice(0,100),created_at:new Date().toISOString()},null)];
  items.forEach(function(p){writes.push(S.write('/consignmentItems/'+safe(p.sku),p,null))});
  await S.commit(writes);return {count:items.length,quantity:items.reduce(function(n,p){return n+p.qty},0)};
 }
 async function action(kind,data){
  await S.admin();var op=safe(data.operation_id),who=kind==='receipt'?'':safe(data.dealer_id),path=who?accountPath(who)+'/events/'+op:'/consignmentAdminEvents/'+op;
  var key=await fingerprint(kind,data),oldEvent=await S.get(path,true);
  if(oldEvent){if(oldEvent.request_key!==key)throw Error('Номер операции занят другой записью');return {already:true,event:oldEvent}}
  var set=await settings();if(!set)throw Error('Сначала импортируйте начальный склад');
  var state={settings:set},ap=who?accountPath(who):'';
  if(who)state.profile=await S.get('/profiles/'+who);
  if(kind!=='payment')state.product=await S.get('/consignmentItems/'+safe(data.sku));
  if(who&&kind!=='payment')state.holding=await S.get(ap+'/stock/'+safe(data.sku),true);
  if(['sale','payment','customer_return'].includes(kind))state.account=await S.get(ap,true);
  var sourceId;if(kind==='customer_return'){sourceId=safe(data.source_event);state.sale=await S.get(ap+'/events/'+sourceId)}
  if(kind==='sale'&&!String(data.reference||'').trim())throw Error('Укажите номер документа продажи');
  var input=Object.assign({},data,{created_at:new Date().toISOString(),request_key:key});
  var result=C.plan(kind,input,state),writes=[];
  if(result.product)writes.push(S.write('/consignmentItems/'+safe(data.sku),result.product,state.product));
  if(result.holding)writes.push(S.write(ap+'/stock/'+safe(data.sku),result.holding,state.holding));
  if(result.account)writes.push(S.write(ap,C.clean(result.account),state.account));
  if(result.sale)writes.push(S.write(ap+'/events/'+sourceId,result.sale,state.sale));
  if(kind==='sale'){var refKey=await fingerprint('sale-reference',{reference:String(data.reference).trim().toUpperCase(),sku:data.sku});writes.push(S.write(ap+'/references/'+refKey,{event_id:op},null));}
  if(data.report_id){
   var rp=ap+'/reports/'+safe(data.report_id),report=await S.get(rp);
   if(kind!=='sale'||report.status!=='pending')throw Error('Отчёт уже обработан');
   if(report.sku!==data.sku||report.quantity!==data.quantity||report.unit_price_minor!==data.unit_price_minor)throw Error('Данные продажи отличаются от отчёта');
   var updated=C.clean(report);updated.status='approved';updated.event_id=op;writes.push(S.write(rp,updated,report));
  }
  writes.push(S.write(path,result.event,null));
  try{await S.commit(writes)}catch(e){
   // Recover a commit whose response was lost; never send a second financial event.
   var committed;try{committed=await S.get(path,true)}catch(_){}
   if(committed&&committed.request_key===key)return {already:true,event:committed};throw e;
  }
  return {event:result.event};
 }
 async function submitReport(data){
  var me=await S.me();if(me.role!=='dealer')throw Error('Отчёты отправляются из кабинета оптовика');
  var set=await settings();if(!set)throw Error('Склад ещё не настроен');
  var path=accountPath(me.id)+'/reports/'+safe(data.operation_id),before=await S.get(path,true);
  var key=await fingerprint('report',data);if(before){if(before.request_key!==key)throw Error('Номер отчёта занят');return {already:true}}
  var item=await S.get('/consignmentItems/'+safe(data.sku)),holding=await S.get(accountPath(me.id)+'/stock/'+safe(data.sku),true);
  if(!Number.isSafeInteger(data.quantity)||data.quantity<1||!holding||data.quantity>holding.qty)throw Error('Проверьте количество у вас на остатке');
  if(!Number.isSafeInteger(data.unit_price_minor)||data.unit_price_minor<1||data.unit_price_minor*data.quantity>1000000000)throw Error('Проверьте фактическую цену продажи');
  if(!String(data.reference||'').trim())throw Error('Укажите номер документа продажи');
  var doc={sku:item.sku,model:item.model,quantity:data.quantity,unit_price_minor:data.unit_price_minor,reference:String(data.reference||'').trim().slice(0,80),status:'pending',event_id:'',created_at:new Date().toISOString(),request_key:key};
  await S.commit([S.write(path,doc,null)]);return {ok:true};
 }
 async function rejectReport(dealerId,reportId){await S.admin();var path=accountPath(dealerId)+'/reports/'+safe(reportId),old=await S.get(path);if(old.status!=='pending')throw Error('Отчёт уже обработан');var doc=C.clean(old);doc.status='rejected';await S.commit([S.write(path,doc,old)])}
 async function price(data){
  await S.admin();safe(data.operation_id);var path='/consignmentAdminEvents/'+data.operation_id,key=await fingerprint('price',data),prior=await S.get(path,true);
  if(prior){if(prior.request_key!==key)throw Error('Номер операции занят');return {already:true}}
  var item=await S.get('/consignmentItems/'+safe(data.sku));
  if(!Number.isSafeInteger(data.price_minor)||data.price_minor<0||data.price_minor>1000000000)throw Error('Проверьте цену');
  var doc=C.clean(item);doc.price_minor=data.price_minor;doc.price_known=true;
  await S.commit([S.write('/consignmentItems/'+data.sku,doc,item),S.write(path,{kind:'price',sku:data.sku,old_price_minor:item.price_minor,old_price_known:item.price_known,new_price_minor:data.price_minor,created_at:new Date().toISOString(),request_key:key},null)]);
 }
 window.CudyConsignment={load:load,initialize:initialize,action:action,submitReport:submitReport,rejectReport:rejectReport,price:price};
})();
