'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {decodeBundle,fetchSource,prepareTree,verifyTree,sync,main}=require('../scripts/sync-house.cjs');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const bot={id:'11111111-1111-4111-8111-111111111111',slug:'specimen',name:'Specimen',language:'vane',houseBot:true,visibility:'published',sourcePublished:true,active_revision_id:'22222222-2222-4222-8222-222222222222',manifest_hash:'a'.repeat(64)};
function fixture({revision=bot.active_revision_id,source='drive 0.7',extra=true}={}){
  const files=[{path:'bot.json',mode:0o644,data:Buffer.from(JSON.stringify({name:'Specimen',entry:'robot.vane'}))},{path:'robot.vane',mode:0o600,data:Buffer.from(source)},{path:'trial.sh',mode:0o755,data:Buffer.from('echo trial\n')}];if(extra)files.push({path:'binary.dat',mode:0o600,data:Buffer.from([0,255,10,128])});
  const entries=files.map(({path,mode,data})=>({path,mode,size:data.length,sha256:hash(data),data:data.toString('base64')})),manifest={directories:[],files:entries.map(({path,size,mode,sha256})=>({path,size,mode,sha256}))},value={v:1,...manifest,files:entries,manifestHash:hash(JSON.stringify(manifest))},bytes=zlib.gzipSync(Buffer.from(JSON.stringify(value))),profile={...bot,active_revision_id:revision};
  return{value,bytes,files,profile,snapshot:decodeBundle(bytes)};
}
const fetchFor=value=>async url=>new Response(url.endsWith('/source')?value.bytes:JSON.stringify({bot:value.profile}));
test('House template preserves verified robot bytes and executability, adds language, and guards inherited sync',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'house-publisher-'));try{
    const value=fixture(),root=path.join(temp,'tree'),row=prepareTree(root,{bot:value.profile,snapshot:value.snapshot},{updaterRef:'b'.repeat(40)});
    for(const file of value.files.filter(file=>file.path!=='bot.json')){assert.deepEqual(fs.readFileSync(path.join(root,file.path)),file.data);assert.equal(fs.statSync(path.join(root,file.path)).mode&0o777,file.mode);}
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,'bot.json'))).language,'vane');assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'.clunkyard-source.json'))),{botId:bot.id,revisionId:bot.active_revision_id,manifestHash:bot.manifest_hash});
    const workflow=fs.readFileSync(path.join(root,'.github/workflows/house-source.yml'),'utf8');assert.match(workflow,/if: github.repository == 'clunkyard\/house-specimen'/);assert.match(workflow,/clunkyard\/\.github\/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\/scripts\/sync-house.cjs/);assert.match(workflow,/sha256sum --check/);assert.equal(fs.existsSync(path.join(root,'.github/scripts')),false);verifyTree(root,row.files);
    fs.appendFileSync(path.join(root,'robot.vane'),' changed');assert.throws(()=>verifyTree(root,row.files),/Prepared files changed/);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('House export rejects corrupt bytes, traversal and internal paths before writing',()=>{
  const value=fixture();value.value.files[0].data=Buffer.from('bad').toString('base64');assert.throws(()=>decodeBundle(zlib.gzipSync(Buffer.from(JSON.stringify(value.value)))),/failed verification/);
  for(const name of ['../private','/absolute','.github/workflows/run.yml','.env','src/.ssh/key','node_modules/private','src\\robot']){const bad=fixture();bad.value.files[0].path=name;assert.throws(()=>decodeBundle(zlib.gzipSync(Buffer.from(JSON.stringify(bad.value)))),/path/);}
});
test('House source download is fenced by public identity before and after export',async()=>{
  const value=fixture();let reads=0;const fetchImpl=async url=>{if(url.endsWith('/source'))return new Response(value.bytes);reads++;return new Response(JSON.stringify({bot:{...value.profile,...(reads===2?{active_revision_id:'33333333-3333-4333-8333-333333333333'}:{})}}));};
  await assert.rejects(()=>fetchSource({id:bot.id,slug:bot.slug},{fetchImpl}),/changed during download/);
  await assert.rejects(()=>fetchSource({id:bot.id,slug:'wrong'},{fetchImpl:fetchFor(value)}),/slug/);
  await assert.rejects(()=>fetchSource({id:bot.id},{fetchImpl:async()=>new Response(JSON.stringify({bot:{...value.profile,visibility:'private'}}))}),/not a published House/);
});
test('shared updater refuses player copies and edited source, then refreshes only managed files',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'house-updater-')),previous=process.cwd(),env=process.env.GITHUB_REPOSITORY;
  try{
    const value=fixture(),root=path.join(temp,'repo');prepareTree(root,{bot:value.profile,snapshot:value.snapshot},{updaterRef:'b'.repeat(40)});process.chdir(root);
    const git=args=>execFileSync('git',args,{cwd:root,stdio:'pipe'});git(['init','--initial-branch=main']);git(['add','--all']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.test','-c','commit.gpgsign=false','commit','-m','Fixture']);
    process.env.GITHUB_REPOSITORY='player/house-specimen';await assert.rejects(()=>sync(bot.id,bot.slug),/only in its original/);
    process.env.GITHUB_REPOSITORY='clunkyard/house-specimen';fs.appendFileSync('robot.vane',' local edit');await assert.rejects(()=>sync(bot.id,bot.slug),/must be clean/);git(['checkout','--','robot.vane']);
    const workflow=fs.readFileSync('.github/workflows/house-source.yml'),next=fixture({revision:'33333333-3333-4333-8333-333333333333',source:'drive 0.9',extra:false});await sync(bot.id,bot.slug,{fetchImpl:fetchFor(next)});
    assert.equal(fs.readFileSync('robot.vane','utf8'),'drive 0.9');assert.equal(fs.existsSync('binary.dat'),false);assert.deepEqual(fs.readFileSync('.github/workflows/house-source.yml'),workflow);assert.equal(JSON.parse(fs.readFileSync('.clunkyard-source.json')).revisionId,next.profile.active_revision_id);
  }finally{process.chdir(previous);if(env===undefined)delete process.env.GITHUB_REPOSITORY;else process.env.GITHUB_REPOSITORY=env;fs.rmSync(temp,{recursive:true,force:true});}
});
test('public publishing requires a reviewed immutable updater pin',async()=>{await assert.rejects(()=>main(['--apply','--out','unused']),/reviewed.*SHA/i);});
