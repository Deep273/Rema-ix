const {randomBytes,scrypt,timingSafeEqual,createHash}=require('node:crypto');
const { randomInt } = require('node:crypto');
const { sendVerification, mailConfigured } = require('./auth-mail.cjs');
const derive=require('node:util').promisify(scrypt);
const digest=value=>createHash('sha256').update(value).digest('hex');
async function hashPassword(password) {
  const salt=randomBytes(16).toString('hex');
  return salt+':'+(await derive(password,salt,64)).toString('hex');
}
async function verifyPassword(password,stored) {
  const [salt,hex]=stored.split(':');
  const actual=await derive(password,salt,64);
  const expected=Buffer.from(hex,'hex');
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}
async function initialize(store) {store.initialize();}
function createAuth(store,{json,body,secure=false, sendCode=sendVerification, canSend=mailConfigured}) {
  store.initialize();
  const attempts=new Map();
  const tokenFrom=request=>{
    const part=(request.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('landscope_session='));
    const token=part?.slice('landscope_session='.length);
    return /^[a-f0-9]{64}$/.test(token||'')?token:null;
  };
  const cookie=(response,token,age)=>response.setHeader('Set-Cookie',
    'landscope_session='+token+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+age+(secure?'; Secure':''));
  async function user(request) {
    const token=tokenFrom(request);
    return token?store.findSession(digest(token)):null;
  }
  async function handle(request,response,url) {
    if(!['/api/auth/login','/api/auth/register','/api/auth/verify-email','/api/auth/logout','/api/auth/me'].includes(url.pathname))return false;
    if(url.pathname==='/api/auth/me' && request.method==='GET'){
      const current=await user(request);
      json(response,current?200:401,current?{user:current}:{message:'Войдите в аккаунт.'});
      return true;
    }
    if(request.method!=='POST'||url.pathname==='/api/auth/me'){json(response,405,{message:'Метод не поддерживается.'});return true;}
    if(request.headers.origin){
      let host;try{host=new URL(request.headers.origin).host}catch{}
      if(host!==request.headers.host){json(response,403,{message:'Запрос с другого сайта запрещён.'});return true;}
    }
    if(url.pathname==='/api/auth/logout'){
      const token=tokenFrom(request);if(token)store.deleteSession(digest(token));
      cookie(response,'',0);json(response,200,{ok:true});return true;
    }

    const form=await body(request);
    if (url.pathname === '/api/auth/verify-email') {
      const challenge = typeof form.challenge === 'string' ? form.challenge : '';
      const code = typeof form.code === 'string' ? form.code : '';
      if (!/^[a-f0-9]{64}$/.test(challenge) || !/^\d{6}$/.test(code)) {
        json(response,400,{message:'Введите шестизначный код из письма.'});return true;
      }
      const token = randomBytes(32).toString('hex'), previous = tokenFrom(request);
      let account;
      try { account = store.confirmPending(digest(challenge),digest(challenge+':'+code),digest(token),previous ? digest(previous) : null); }
      catch (error) {
        if (error.errcode === 2067) {json(response,409,{message:'Эта почта уже зарегистрирована. Войдите в аккаунт.'});return true;}
        throw error;
      }
      if (!account) {json(response,400,{message:'Код неверный или истёк. После 5 ошибок запросите новое письмо.'});return true;}
      cookie(response,token,43200);json(response,201,{user:account});return true;
    }
    const username=typeof form.username==='string'?form.username.trim().toLowerCase():'';
    const password=typeof form.password==='string'?form.password:'';
    const registering = url.pathname === '/api/auth/register';
    if (!registering && username.includes('@') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
      json(response,400,{message:'Некорректная почта. Введите адрес в формате name@example.com.'});return true;
    }
    if (registering) {
      if (username.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
        json(response,400,{message:'Некорректная почта. Введите адрес в формате name@example.com.'});return true;
      }
      if (password.length < 10 || password.length > 1024) {
        json(response,400,{message:'Пароль должен содержать от 10 до 1024 символов.'});return true;
      }
      if (password !== form.passwordConfirmation) {
        json(response,400,{message:'Пароли не совпадают. Введите одинаковый пароль в обоих полях.'});return true;
      }
    }
    if(!username || username.length>100 || !password || password.length>1024){
      json(response,401,{message:'Неверная почта или пароль. Проверьте введённые данные.'});return true;
    }
    const now=Date.now();
    for(const [key,value] of attempts)if(value.until<=now)attempts.delete(key);
    const key=request.socket.remoteAddress||'unknown';
    const attempt=attempts.get(key)||{count:0,until:now+900000};
    if(attempt.count>=20||(!attempts.has(key)&&attempts.size>=10000)){
      response.setHeader('Retry-After','900');json(response,429,{message:'Слишком много попыток. Повторите через 15 минут.'});return true;
    }
    attempt.count++;attempts.set(key,attempt);


    if (registering) {
      const token = randomBytes(32).toString('hex');
      const previous = tokenFrom(request);
      let account;
      try {
        account = store.registerAccount(username, await hashPassword(password), digest(token), previous ? digest(previous) : null);
      } catch (error) {
        if (error.errcode === 2067) {
          json(response,409,{message:'Эта почта уже зарегистрирована. Войдите в аккаунт.'});
          return true;
        }
        throw error;
      }
      cookie(response,token,43200);
      json(response,201,{user:account});
      return true;
    }
    const account=store.findAccount(username);
    const valid=await verifyPassword(password,account?.password_hash||'0'.repeat(32)+':'+ '0'.repeat(128));
    if(!account||!valid){json(response,401,{message:'Неверная почта или пароль. Проверьте введённые данные.'});return true;}
    const token=randomBytes(32).toString('hex'),previous=tokenFrom(request);
    store.createSession(digest(token),account.id,previous?digest(previous):null);
    cookie(response,token,43200);
    json(response,200,{user:{id:account.id,username:account.username}});
    return true;
  }
  return {handle,user};
}
module.exports={createAuth,initialize,hashPassword,verifyPassword};