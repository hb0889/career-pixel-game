'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const PORT=Number(process.env.PORT||3000),HOST=process.env.HOST||'0.0.0.0';
const PASSWORD=process.env.ADMIN_PASSWORD;
if(!PASSWORD||PASSWORD.length<4){console.error('ADMIN_PASSWORD 환경변수에 관리자 비밀번호를 설정하세요.');process.exit(1)}
const DB_PATH=process.env.DB_PATH||path.join(__dirname,'data','stats.sqlite');fs.mkdirSync(path.dirname(DB_PATH),{recursive:true});
const db=new DatabaseSync(DB_PATH);db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, goal TEXT NOT NULL, started_at TEXT DEFAULT CURRENT_TIMESTAMP); CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(run_id,kind)); CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);');
const insertRun=db.prepare('INSERT INTO runs(id,goal) VALUES (?,?)');const findRun=db.prepare('SELECT id FROM runs WHERE id=?');const insertEvent=db.prepare('INSERT OR IGNORE INTO events(run_id,kind) VALUES (?,?)');
const sessions=new Map(),loginAttempts=new Map();const ttl=8*3600*1000;const allowedEvents=new Set(['checkpoint10','checkpoint20','checkpoint30','finish','consult','school','phone']);const goals=new Set(['취업 성공','대학 입학','업무 활용','스펙업 및 이직','취미']);
function json(res,code,obj,headers={}){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(obj))}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>4096){reject(Error('too large'));req.destroy()}});req.on('end',()=>{try{resolve(JSON.parse(s||'{}'))}catch{reject(Error('invalid JSON'))}});req.on('error',reject)})}
function cookie(req){return (req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('career_admin='))?.slice(13)}
function authorized(req){let t=cookie(req),s=t&&sessions.get(t);if(!s)return false;if(s.exp<Date.now()){sessions.delete(t);return false}return true}
function aggregate(){const runs=db.prepare('SELECT COUNT(*) n FROM runs').get().n;const kinds=Object.fromEntries(db.prepare('SELECT kind,COUNT(*) n FROM events GROUP BY kind').all().map(x=>[x.kind,x.n]));const goalRows=db.prepare('SELECT goal,COUNT(*) n FROM runs GROUP BY goal ORDER BY n DESC').all();return {started:runs,finished:kinds.finish||0,checkpoints:{10:kinds.checkpoint10||0,20:kinds.checkpoint20||0,30:kinds.checkpoint30||0},consultClicks:kinds.consult||0,schoolClicks:kinds.school||0,phoneClicks:kinds.phone||0,goals:Object.fromEntries(goalRows.map(x=>[x.goal,x.n])),updatedAt:new Date().toISOString()}}
const html=fs.readFileSync(path.join(__dirname,'index.html'));
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');const ip=req.socket.remoteAddress||'unknown';try{
 if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});return res.end(html)}
 if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true,mode:'server'});
 if(req.method==='POST'&&url.pathname==='/api/run'){const b=await body(req);if(!goals.has(b.goal))return json(res,400,{error:'invalid goal'});const id=crypto.randomUUID();insertRun.run(id,b.goal);return json(res,201,{runId:id})}
 if(req.method==='POST'&&url.pathname==='/api/event'){const b=await body(req);if(typeof b.runId!=='string'||!findRun.get(b.runId)||!allowedEvents.has(b.kind))return json(res,400,{error:'invalid event'});insertEvent.run(b.runId,b.kind);return json(res,200,{ok:true})}
 if(req.method==='POST'&&url.pathname==='/api/admin/login'){const rec=loginAttempts.get(ip)||{count:0,until:0};if(rec.until>Date.now())return json(res,429,{error:'잠시 후 다시 시도하세요.'});const b=await body(req);const actual=crypto.createHash('sha256').update(String(b.password||'')).digest();const expected=crypto.createHash('sha256').update(PASSWORD).digest();if(!crypto.timingSafeEqual(actual,expected)){rec.count++;if(rec.count>=5){rec.until=Date.now()+15*60*1000;rec.count=0}loginAttempts.set(ip,rec);return json(res,401,{error:'비밀번호가 올바르지 않습니다.'})}loginAttempts.delete(ip);const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{exp:Date.now()+ttl});return json(res,200,{ok:true},{'Set-Cookie':`career_admin=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=28800${(process.env.COOKIE_SECURE==='1'||process.env.RENDER)?'; Secure':''}`})}
 if(req.method==='GET'&&url.pathname==='/api/admin/stats'){if(!authorized(req))return json(res,401,{error:'로그인이 필요합니다.'});return json(res,200,aggregate())}
 if(req.method==='POST'&&url.pathname==='/api/admin/logout'){let t=cookie(req);if(t)sessions.delete(t);return json(res,200,{ok:true},{'Set-Cookie':'career_admin=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0'})}
 return json(res,404,{error:'not found'});
 }catch(e){console.error(e);if(!res.headersSent)json(res,500,{error:'server error'})}});
server.listen(PORT,HOST,()=>console.log(`Career RPG http://${HOST}:${PORT}`));
