(function(root,factory){'use strict';var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CudyConsignmentCore=api;})(typeof window==='object'?window:this,function(){
 'use strict';
 var LIMIT=1000000000;
 function fail(s){throw Error(s)}
 function integer(n,min,max,label){if(!Number.isSafeInteger(n)||n<min||n>max)fail(label);return n}
 function amount(value,allowZero){var s=String(value).trim().replace(',','.');if(!/^\d+(\.\d{1,2})?$/.test(s))fail('Введите сумму с точностью до 0,01');var p=s.split('.');return integer(Number(p[0])*100+Number((p[1]||'').padEnd(2,'0')),allowZero?0:1,LIMIT,'Сумма вне допустимого диапазона')}
 function rate(value){var s=String(value).trim().replace(',','.');if(!/^\d+(\.\d{1,2})?$/.test(s))fail('Ставка от 3 до 5%');return integer(Math.round(Number(s)*100),300,500,'Ставка от 3 до 5%')}
 function roundBonus(total,bps){return Math.floor((total*bps+5000)/10000)}
 function account(x){return Object.assign({sales_minor:0,earned_minor:0,paid_minor:0},x||{})}
 function clean(x){var y={};Object.keys(x||{}).forEach(function(k){if(k!=='id'&&k!=='_updateTime')y[k]=x[k]});return y}
 function plan(kind,input,state){
  var a=account(state.account),p=clean(state.product),h=Object.assign({sku:p.sku,model:p.model,qty:0},clean(state.holding));
  if(!state.settings||!['USD','TMT','EUR','CNY','RUB','AED'].includes(state.settings.currency))fail('Владелец должен выбрать валюту учёта');
  var q=kind==='payment'?0:integer(input.quantity,1,100000,'Количество должно быть целым и больше нуля');
  var profile=state.profile;
  if(kind!=='receipt'&&(!profile||profile.role!=='dealer'||(['transfer','sale'].includes(kind)&&!profile.active)))fail('Кабинет оптовика отключён');
  var e={kind:kind,sku:p.sku||'',model:p.model||'',quantity:q,unit_price_minor:0,amount_minor:0,rate_bps:0,commission_minor:0,currency:state.settings.currency,reference:String(input.reference||'').trim().slice(0,80),note:String(input.note||'').trim().slice(0,160),source_event:String(input.source_event||''),created_at:input.created_at,returned_qty:0,reversed_minor:0,request_key:input.request_key};
  var result={event:e};
  if(kind==='transfer'){
   if(p.qty<q)fail('На центральном складе недостаточно товара');p.qty-=q;h.qty+=q;result.product=p;result.holding=h;
  }else if(kind==='dealer_return'){
   if(h.qty<q)fail('У оптовика недостаточно товара');h.qty-=q;p.qty+=q;result.product=p;result.holding=h;
  }else if(kind==='receipt'){
   p.qty=integer(p.qty+q,0,LIMIT,'Слишком большой остаток');result.product=p;
  }else if(kind==='sale'){
   if(h.qty<q)fail('Нельзя продать больше остатка у оптовика');
   var unit=integer(input.unit_price_minor,1,LIMIT,'Укажите фактическую цену продажи покупателю');
   var total=integer(unit*q,1,LIMIT,'Сумма продажи слишком велика');
   var bps=integer(profile.rate_bps,300,500,'Установите оптовику ставку от 3 до 5%');
   var bonus=roundBonus(total,bps);
   Object.assign(e,{unit_price_minor:unit,amount_minor:total,rate_bps:bps,commission_minor:bonus});
   h.qty-=q;a.sales_minor+=total;a.earned_minor+=bonus;result.holding=h;result.account=a;
  }else if(kind==='customer_return'){
   var sale=clean(state.sale);
   if(!sale||sale.kind!=='sale'||sale.sku!==p.sku)fail('Выберите исходную продажу этого товара');
   if(sale.currency!==state.settings.currency)fail('Валюта исходной продажи отличается');
   if(q>sale.quantity-sale.returned_qty)fail('Возврат превышает проданное количество');
   var returned=sale.returned_qty+q,reverse;
   // Proportional cumulative reversal: full return must reverse the exact original rounded bonus.
   reverse=Math.floor((sale.commission_minor*returned+Math.floor(sale.quantity/2))/sale.quantity)-sale.reversed_minor;
   Object.assign(e,{unit_price_minor:sale.unit_price_minor,amount_minor:q*sale.unit_price_minor,rate_bps:sale.rate_bps,commission_minor:reverse});
   h.qty+=q;a.sales_minor-=e.amount_minor;a.earned_minor-=reverse;
   sale.returned_qty=returned;sale.reversed_minor+=reverse;
   result.holding=h;result.account=a;result.sale=sale;
  }else if(kind==='payment'){
   var payment=integer(input.amount_minor,1,LIMIT,'Укажите сумму выплаты');
   if(payment>a.earned_minor-a.paid_minor)fail('Выплата превышает доступные начисления');
   a.paid_minor+=payment;e.amount_minor=payment;result.account=a;
  }else fail('Неизвестная операция');
  for(var k of ['sales_minor','earned_minor','paid_minor'])integer(a[k],0,Number.MAX_SAFE_INTEGER,'Некорректный итог '+k);
  if(result.product)integer(result.product.qty,0,LIMIT,'Некорректный остаток склада');
  if(result.holding)integer(result.holding.qty,0,LIMIT,'Некорректный остаток у оптовика');
  return result;
 }
 function validateSeed(seed){
  if(!seed||seed.schema!=='cudy-owner-stock-v1'||!Array.isArray(seed.items)||!seed.items.length||seed.items.length>200)fail('Нужен файл начального склада Cudy JSON, до 200 позиций');
  var seen=new Set();
  return seed.items.map(function(x){
   if(!/^CUDY-\d{3}$/.test(x.sku)||seen.has(x.sku))fail('Повтор или неверный код товара');seen.add(x.sku);
   if(typeof x.model!=='string'||!x.model.trim()||x.model.length>100)fail('Проверьте модель');
   integer(x.quantity,0,LIMIT,'Проверьте начальное количество');
   if(x.price_minor!==null)integer(x.price_minor,0,LIMIT,'Проверьте цену');
   return {sku:x.sku,model:x.model,description:String(x.description||'').slice(0,200),category:String(x.category||'').slice(0,100),price_known:x.price_minor!==null,price_minor:x.price_minor===null?0:x.price_minor,opening_qty:x.quantity,qty:x.quantity,source_row:x.source_row,source_no:x.source_no};
  });
 }
 return {amount:amount,rate:rate,bonus:roundBonus,plan:plan,clean:clean,validateSeed:validateSeed,account:account};
});
