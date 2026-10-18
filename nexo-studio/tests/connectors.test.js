'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const connectors=require('../connectors');
const dir=path.join(os.tmpdir(),'nexo-connectors-'+process.pid+'-'+Date.now());
test('connector catalog, encryption, read-only GitHub, manual outbound, disconnect',async t=>{
 await fs.mkdir(dir,{recursive:true});await connectors.init(dir);
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 assert(connectors.catalog().length>=15);
 assert.equal(connectors.catalog().find(x=>x.id==='instagram').kind,'planned');
 const secret='github_pat_this-is-a-safe-placeholder';
 await connectors.configure('github',{token:secret});
 assert.equal(connectors.catalog().find(x=>x.id==='github').connected,true);
 const encrypted=await fs.readFile(path.join(dir,'.secrets','connectors.enc'),'utf8');
 assert(!encrypted.includes(secret),'Do not write plaintext credentials');
 assert(!JSON.stringify(connectors.catalog()).includes(secret),'Do not expose secrets to browser');
 let observed=null;const oldFetch=global.fetch;
 global.fetch=async(u,opts)=>{observed={url:String(u),opts};return {ok:true,json:async()=>[{full_name:'example/demo',description:'A sample repository',private:false,pushed_at:'2026-10-01'}]};};
 try{const repo=await connectors.read('github');assert.equal(repo.items[0].name,'example/demo');assert.equal(observed.opts.headers.Authorization,'Bearer '+secret);}finally{global.fetch=oldFetch;}
 assert.rejects(()=>connectors.configure('slack',{url:'https://evil.example/webhook'}));
 assert.rejects(()=>connectors.configure('rss',{url:'http://localhost/feed'}));
 await connectors.configure('slack',{url:'https://hooks.slack.com/services/T/B/secure-token'});
 global.fetch=async (u,opts)=>{observed={url:String(u),opts};return{ok:true}};
 try{await connectors.sendMessage('slack','Hola equipo');assert.equal(observed.url,'https://hooks.slack.com/services/T/B/secure-token');assert.match(JSON.parse(observed.opts.body).text,/NEXO/);}finally{global.fetch=oldFetch;}
 await connectors.disconnect('github');assert.equal(connectors.catalog().find(x=>x.id==='github').connected,false);
 await connectors.init(dir);assert.equal(connectors.catalog().find(x=>x.id==='slack').connected,true,'Credentials should survive restart');
});
test('private network addresses rejected',()=>{
 assert.equal(connectors.isPublicIp('127.0.0.1'),false);assert.equal(connectors.isPublicIp('10.2.2.2'),false);assert.equal(connectors.isPublicIp('192.168.0.1'),false);assert.equal(connectors.isPublicIp('8.8.8.8'),true);
});
test('RSS title extraction uses bounded feed',()=>{const rows=connectors.feedTitles('<rss><item><title><![CDATA[Hola &amp; mundo]]></title><pubDate>Now</pubDate></item></rss>');assert.equal(rows[0].title,'Hola & mundo');});
