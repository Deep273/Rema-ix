const {createStore}=require('./auth-store.cjs');
const {hashPassword}=require('./auth.cjs');
(async()=>{
 const username=(process.env.LANDSCOPE_NEW_USERNAME||'').trim().toLowerCase();
 const password=process.env.LANDSCOPE_NEW_PASSWORD||'';
 delete process.env.LANDSCOPE_NEW_PASSWORD;
 if(!/^[a-z0-9_.@-]{3,100}$/.test(username))throw Error('Недопустимый логин.');
 if(password.length<10||password.length>1024)throw Error('Пароль: от 10 до 1024 символов.');
 const store=createStore(process.env.LANDSCOPE_AUTH_DB||undefined);
 try{
  store.initialize();
  if(store.findAccount(username))throw Error('Логин уже существует.');
  store.createAccount(username,await hashPassword(password));
  console.log('Аккаунт создан: '+username);
 }finally{store.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});