(function(){
 'use strict';
 var cfg=window.CUDY_FIREBASE_CONFIG||{},project=String(cfg.projectId||''),key=String(cfg.apiKey||'');
 var prefix='projects/'+project+'/databases/(default)/documents';
 var base='https://firestore.googleapis.com/v1/'+prefix;
 var token='',refresh=sessionStorage.getItem('cudy-firebase-refresh')||'',uid=sessionStorage.getItem('cudy-firebase-uid')||'',expiry=0,refreshing=null;
 function clear(){token='';refresh='';uid='';expiry=0;sessionStorage.removeItem('cudy-firebase-refresh');sessionStorage.removeItem('cudy-firebase-uid')}
 function store(x){token=x.idToken;refresh=x.refreshToken;uid=x.localId;expiry=Date.now()+Number(x.expiresIn||3600)*1000;sessionStorage.setItem('cudy-firebase-refresh',refresh);sessionStorage.setItem('cudy-firebase-uid',uid)}
 async function call(url,method,body,headers){
  var r;try{r=await fetch(url,{method:method||'GET',headers:Object.assign({'Content-Type':'application/json'},headers||{}),body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body),cache:'no-store',credentials:'omit'})}catch(_){throw Error('Нет соединения. Данные не подтверждены. Повторите с теми же полями.')}
  var x=await r.json();if(r.ok)return x;
  var code=x.error&&(x.error.message||x.error.status)||'Ошибка подключения',message=code;
  if(/INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND|INVALID_PASSWORD/.test(code))message='Неверная почта или пароль';
  if(/EMAIL_EXISTS/.test(code))message='Эта почта уже зарегистрирована';
  if(/PERMISSION_DENIED/.test(code))message='Нет доступа. Проверьте профиль и актуальные правила Firebase.';
  if(/ABORTED|FAILED_PRECONDITION/.test(code))message='Остаток или запись изменились. Обновите данные и повторите.';
  if(/ALREADY_EXISTS/.test(code))message='Такая запись уже существует. Проверьте номер документа и историю.';
  if(/TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_DISABLED|UNAUTHENTICATED/.test(code)){clear();message='Сеанс истёк. Войдите снова'}
  var e=Error(message);e.status=r.status;e.code=code;throw e;
 }
 async function auth(){if(token&&Date.now()<expiry-60000)return token;if(!refresh)throw Error('Войдите в кабинет');
  if(!refreshing)refreshing=(async function(){try{var x=await call('https://securetoken.googleapis.com/v1/token?key='+encodeURIComponent(key),'POST','grant_type=refresh_token&refresh_token='+encodeURIComponent(refresh),{'Content-Type':'application/x-www-form-urlencoded'});store({idToken:x.id_token,refreshToken:x.refresh_token,localId:x.user_id,expiresIn:x.expires_in});return token;}finally{refreshing=null}})();return refreshing;
 }
 async function rest(path,method,body){return call(base+path,method,body,{'Authorization':'Bearer '+await auth()})}
 function fields(x){var f={};Object.keys(x).forEach(function(k){var v=x[k];if(typeof v==='string')f[k]={stringValue:v};else if(typeof v==='boolean')f[k]={booleanValue:v};else if(Number.isSafeInteger(v))f[k]={integerValue:String(v)};else throw Error('Некорректное поле '+k)});return f}
 function decode(doc){var x={id:doc.name.split('/').pop(),_updateTime:doc.updateTime};Object.entries(doc.fields||{}).forEach(function(p){var v=p[1];x[p[0]]=v.stringValue!==undefined?v.stringValue:v.integerValue!==undefined?Number(v.integerValue):v.booleanValue!==undefined?v.booleanValue:null});return x}
 async function get(path,optional){try{return decode(await rest(path))}catch(e){if(optional&&e.status===404)return null;throw e}}
 async function list(path){var all=[],next='';do{var page=await rest(path+'?pageSize=100'+(next?'&pageToken='+encodeURIComponent(next):''));all.push.apply(all,(page.documents||[]).map(decode));next=page.nextPageToken||''}while(next);return all}
 function write(path,data,before){return {update:{name:prefix+path,fields:fields(data)},currentDocument:before&&before._updateTime?{updateTime:before._updateTime}:{exists:false}}}
 async function commit(writes){return rest(':commit','POST',{writes:writes})}
 async function me(){var p=await get('/profiles/'+uid);if(!p.active){clear();throw Error('Ваш кабинет отключён')}return p}
 async function admin(){var p=await me();if(p.role!=='admin')throw Error('Только владелец может выполнить это действие');return p}
 function id(){var x=new Uint8Array(16);crypto.getRandomValues(x);return Array.from(x,function(v){return v.toString(16).padStart(2,'0')}).join('')}
 async function request(path,method,body){
  method=method||'GET';
  if(path==='/api/session'&&method==='POST'){var x=await call('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(key),'POST',{email:String(body.username).trim(),password:body.password,returnSecureToken:true});store(x);try{return {user:await me()}}catch(e){clear();throw e}}
  if(path==='/api/session'&&method==='DELETE'){clear();return {ok:true}}
  if(path==='/api/me')return {user:await me()};
  if(path==='/api/dealers'&&method==='GET'){await admin();return {dealers:(await list('/profiles')).filter(function(p){return p.role==='dealer'})}}
  if(path==='/api/dealers'&&method==='POST'){
   await admin();var C=window.CudyConsignmentCore;
   if(!String(body.name||'').trim()||String(body.name).length>80||!/^OP\d{2}$/.test(body.code||''))throw Error('Укажите имя и код оптовика');
   if(!String(body.username||'').includes('@')||String(body.password||'').length<12)throw Error('Укажите почту и пароль от 12 символов');
   C.rate(body.rate_bps/100);
   var current=await list('/profiles');if(current.some(function(p){return p.code===body.code}))throw Error('Код оптовика уже используется');
   var newUser=await call('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key='+encodeURIComponent(key),'POST',{email:body.username.trim().toLowerCase(),password:body.password,returnSecureToken:true});
   var p={username:body.username.trim().toLowerCase(),name:body.name.trim(),role:'dealer',rate_bps:body.rate_bps,active:true,code:body.code};
   try{await commit([write('/profiles/'+newUser.localId,p,null)])}catch(e){throw Error('Почта создана, но профиль не сохранён. Владелец должен восстановить профиль для UID '+newUser.localId+'. '+e.message)}
   return {dealer:Object.assign({id:newUser.localId},p)};
  }
  var match=/^\/api\/dealers\/([A-Za-z0-9_-]+)$/.exec(path);
  if(match&&method==='PATCH'){
   await admin();var old=await get('/profiles/'+match[1]);if(old.role!=='dealer')throw Error('Выберите оптовика');var p=window.CudyConsignmentCore.clean(old);
   if(body.rate_bps!==undefined){window.CudyConsignmentCore.rate(body.rate_bps/100);p.rate_bps=body.rate_bps}
   if(body.active!==undefined)p.active=!!body.active;
   if(body.name!==undefined)p.name=String(body.name).trim();
   // Old accounts must receive a supported rate before activation or editing.
   window.CudyConsignmentCore.rate(p.rate_bps/100);
   await commit([write('/profiles/'+match[1],p,old)]);return {dealer:p};
  }
  if(path.startsWith('/api/legacy-ledger/')){
   var who=path.split('/').pop(),sales=await list('/profiles/'+who+'/sales'),payments=await list('/profiles/'+who+'/payments');return {sales:sales,payments:payments};
  }
  throw Error('Операция не поддерживается');
 }
 window.CudyCloud={ready:function(){return !!project&&key.length>12},signedIn:function(){return !!refresh&&!!uid},clear:clear,request:request,newId:id,storage:{get:get,list:list,write:write,commit:commit,me:me,admin:admin,uid:function(){return uid}}};
})();
