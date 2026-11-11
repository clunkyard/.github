#!/usr/bin/env node
'use strict';

// Shared with the public community repository. The updater has no private
// API access and never evaluates downloaded robot source or build metadata.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const ORIGIN='https://clunkyard.com',MAX_BYTES=64*1024*1024,MAX_FILES=4096;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),json=value=>JSON.stringify(value,null,2)+'\n';
const ROOT_FILES=['README.md','Makefile','LICENSE','.gitignore','.clunkyard-source.json'];
const LANGUAGE_ALIASES={'Vane DSL':'vane','Cadence DSL':'cadence','Glyph DSL':'glyph','COBOL (GnuCOBOL)':'cobol','C → WASM':'c-wasm'};
const PRIVATE=new Set(['.git','.github','.clunkyard','.ssh','.aws','.kube','node_modules','upstream_updates']);
function safePath(value){
  if(typeof value!=='string'||!value||Buffer.byteLength(value)>240||Buffer.from(value).toString()!==value||value.startsWith('/')||/[\\\u0000-\u001f\u007f]/.test(value))throw Error('Invalid published source path.');
  const parts=value.split('/');if(parts.some(part=>!part||part==='.'||part==='..'||PRIVATE.has(part.toLowerCase())||/^\.env(?:\.|$)/i.test(part)))throw Error(`Refusing internal or private path: ${value}`);
  return value;
}
function checkedMode(value){if(!Number.isInteger(value)||value<0||value>0o777)throw Error('Invalid published source mode.');return value;}
function decodeBundle(bytes){
  if(bytes.length>MAX_BYTES)throw Error('Published source download is too large.');
  const bundle=JSON.parse(zlib.gunzipSync(bytes,{maxOutputLength:MAX_BYTES}).toString('utf8'));
  if(bundle?.v!==1||!Array.isArray(bundle.files)||!Array.isArray(bundle.directories)||bundle.files.length+bundle.directories.length>MAX_FILES)throw Error('Invalid published source bundle.');
  const seen=new Map(),directories=[],files=[];let total=0;
  const record=(entry,kind)=>{const name=safePath(entry.path);if(seen.has(name))throw Error(`Repeated source path: ${name}`);seen.set(name,kind);return name;};
  for(const entry of bundle.directories)directories.push({path:record(entry,'directory'),mode:checkedMode(entry.mode)});
  for(const entry of bundle.files){
    const name=record(entry,'file');if(typeof entry.data!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.data))throw Error(`Invalid file encoding: ${name}`);
    const data=Buffer.from(entry.data,'base64');total+=data.length;
    if(data.length!==entry.size||sha(data)!==entry.sha256||total>MAX_BYTES)throw Error(`Source file failed verification: ${name}`);
    files.push({path:name,mode:checkedMode(entry.mode),size:data.length,sha256:entry.sha256,data});
  }
  for(const name of seen.keys()){const parts=name.split('/');for(let i=1;i<parts.length;i++)if(seen.get(parts.slice(0,i).join('/'))!=='directory')throw Error(`Missing parent directory: ${name}`);}
  const manifest=JSON.stringify({directories,files:files.map(({path,size,mode,sha256})=>({path,size,mode,sha256}))});
  if(sha(manifest)!==bundle.manifestHash)throw Error('Published source manifest failed verification.');
  return{manifestHash:bundle.manifestHash,directories,files};
}
async function download(url,{fetchImpl=fetch}={}){
  const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(30_000),headers:{Accept:'application/json, application/gzip'}});
  if(!response.ok)throw Error(`Public source request failed (${response.status}): ${url}`);
  if(Number(response.headers.get('content-length'))>MAX_BYTES)throw Error('Public response is too large.');
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>MAX_BYTES)throw Error('Public response is too large.');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);
}
async function profile(id,options){
  if(!UUID.test(id||''))throw Error('Invalid public bot ID.');
  const bot=JSON.parse((await download(`${ORIGIN}/api/arena/bots/${id}`,options)).toString('utf8')).bot;
  if(bot?.id!==id||bot.houseBot!==true||bot.visibility!=='published'||bot.sourcePublished!==true||!UUID.test(bot.active_revision_id||'')||!/^[0-9a-f]{64}$/.test(bot.manifest_hash||'')||typeof bot.language!=='string')throw Error(`Bot is not a published House source: ${id}`);
  return bot;
}
function identity(bot){return{botId:bot.id,revisionId:bot.active_revision_id,manifestHash:bot.manifest_hash};}
function sameSource(left,right){return JSON.stringify(identity(left))===JSON.stringify(identity(right))&&left.language===right.language;}
async function fetchSource(row,options){
  const before=await profile(row.id,options),slug=before.slug||row.slug;
  if(!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(slug||'')||before.slug&&row.slug&&before.slug!==row.slug)throw Error(`Exact House slug is unavailable or changed: ${row.id}`);
  if(row.active_revision_id&&(row.active_revision_id!==before.active_revision_id||row.manifest_hash!==before.manifest_hash))throw Error(`House metadata changed: ${slug}`);
  const snapshot=decodeBundle(await download(`${ORIGIN}/api/arena/v2/bots/${row.id}/source`,options)),after=await profile(row.id,options);
  if(!sameSource(before,after))throw Error(`House source changed during download: ${slug}`);
  return{bot:{...before,slug},snapshot};
}
const makefile='CLUNKYARD ?= npx --yes @clunkyard/cli@2\n\n.PHONY: all setup doctor match replay clean\nall:\n\t$(CLUNKYARD) build\nsetup:\n\t$(CLUNKYARD) setup\ndoctor:\n\t$(CLUNKYARD) doctor\nmatch:\n\t$(CLUNKYARD) match\nreplay:\n\t$(CLUNKYARD) replay\nclean:\n\t$(CLUNKYARD) clean\n';
const license=`MIT License

Copyright (c) 2026 Clunkyard contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
function readme(bot,entry){
  return `# ${bot.name.replace(/[\r\n]/g,' ')} — a Clunkyard House robot

Study this ${bot.language} robot, change \`${entry}\`, and test your own strategy.
This is the published House source from [Clunkyard](${ORIGIN}/#robots/${bot.id}),
not a language starter. Your copy is yours to improve.

Install Node 20+, npm and the [language's own tools](${ORIGIN}/sdk/${bot.language==='c-wasm'?'wasm':bot.language}).
The shared CLI downloads only the engine and this language's SDK.

\`\`\`sh
git clone https://github.com/clunkyard/house-${bot.slug}.git
cd house-${bot.slug}
npx --yes @clunkyard/cli@2 doctor
npx --yes @clunkyard/cli@2 build
npx --yes @clunkyard/cli@2 match 42 2d classic
npx --yes @clunkyard/cli@2 replay
\`\`\`

With Make, use \`make doctor\`, \`make\`, \`make match\` and \`make replay\`.
Try another seed, inspect the replay, change your code and repeat.
See [local trials](${ORIGIN}/sdk/local-trials) for modes and rulesets.
Generated downloads and builds stay in ignored \`.clunkyard/\`.
The CLI uses your installed compiler; native assets require Linux x86-64/glibc 2.39+
(Ubuntu 24.04+ or WSL2). Vane, Glyph and Cadence use portable Node/WebAssembly.

## Keep your own robot

Use this template to create your own GitHub repository, then connect it in
[My bots](${ORIGIN}/#bots) to build on push. Clunkyard also offers
[private Git](${ORIGIN}/sdk/private-git) and browser editing.
Run local trials before hosted practice and tournament entry.
Builds execute source as your user, so review changes you pull.

This official template follows the published House robot. Its hourly sync is
restricted to \`clunkyard/house-${bot.slug}\`; it never runs in a player's copy.
\`.clunkyard-source.json\` records the source bot, revision and original manifest.
Robot source bytes are preserved; \`bot.json\` uses the CLI's canonical language slug.
Tooling, this guide and the MIT licence are template additions.
`;
}
function workflow(bot,updaterRef){const updaterHash=sha(fs.readFileSync(__filename));return `name: Refresh published House source
on:
  schedule:
    - cron: '37 * * * *'
  workflow_dispatch:
permissions: {}
concurrency:
  group: house-source
  cancel-in-progress: false
jobs:
  refresh:
    if: github.repository == 'clunkyard/house-${bot.slug}'
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - name: Verify and refresh public source
        run: |
          curl --fail --silent --show-error --proto '=https' --tlsv1.2 'https://raw.githubusercontent.com/clunkyard/.github/${updaterRef}/scripts/sync-house.cjs' -o "$RUNNER_TEMP/sync-house.cjs"
          printf '%s  %s\\n' '${updaterHash}' "$RUNNER_TEMP/sync-house.cjs" | sha256sum --check
          node "$RUNNER_TEMP/sync-house.cjs" --sync ${bot.id} --slug ${bot.slug}
      - name: Commit verified changes
        run: |
          git add --all
          if git diff --cached --quiet; then exit 0; fi
          git config user.name 'clunkyard-house[bot]'
          git config user.email 'house@users.noreply.github.com'
          git commit -m 'Refresh published House robot source'
          git push
`;}
function filesIn(root,relative=''){
  const files=[];for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const name=relative?relative+'/'+entry.name:entry.name,full=path.join(root,name);if(entry.isDirectory())files.push(...filesIn(root,name));else if(entry.isFile())files.push({path:name,sha256:sha(fs.readFileSync(full)),mode:fs.statSync(full).mode&0o777});else throw Error(`Unsupported prepared file: ${name}`);}return files;
}
function writeFile(root,name,data,mode=0o644){const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data,{mode});fs.chmodSync(target,mode);}
function prepareTree(root,{bot,snapshot},{includeSync=true,updaterRef='REVIEWED_UPDATER_COMMIT'}={}){
  if(fs.existsSync(root))throw Error(`Prepared destination already exists: ${root}`);
  for(const file of snapshot.files)if(ROOT_FILES.includes(file.path)&&file.path!=='LICENSE')throw Error(`Published source collides with generated tooling: ${file.path}`);
  // Existing licensing is never replaced or relicensed by an automated export.
  const manifestFile=snapshot.files.find(file=>file.path==='bot.json');if(!manifestFile)throw Error('Published bot.json is missing.');
  const manifest=JSON.parse(manifestFile.data.toString('utf8'));
  if(!manifest||Array.isArray(manifest)||typeof manifest!=='object'||manifest.language&&(LANGUAGE_ALIASES[manifest.language]||String(manifest.language).toLowerCase())!==bot.language)throw Error('Published language does not match bot.json.');
  const entry=safePath(manifest.entry);if(!snapshot.files.some(file=>file.path===entry))throw Error('Published bot entry is missing.');
  fs.mkdirSync(root,{recursive:true});for(const directory of snapshot.directories)fs.mkdirSync(path.join(root,directory.path),{recursive:true});
  for(const file of snapshot.files)writeFile(root,file.path,file.data,file.mode);
  if(manifest.language!==bot.language)writeFile(root,'bot.json',json({...manifest,language:bot.language}),manifestFile.mode);
  writeFile(root,'Makefile',makefile);writeFile(root,'README.md',readme(bot,entry));
  if(!snapshot.files.some(file=>file.path==='LICENSE'))writeFile(root,'LICENSE',license);
  writeFile(root,'.gitignore','.clunkyard/\nnode_modules/\nbuild/\nreplays/\n');writeFile(root,'.clunkyard-source.json',json(identity(bot)));
  const managed=filesIn(root),record={v:1,repository:`clunkyard/house-${bot.slug}`,source:identity(bot),visibleManifestHash:snapshot.manifestHash,language:bot.language,sourceFiles:snapshot.files.map(({path,mode,size,sha256})=>({path,mode,size,sha256})),directories:snapshot.directories,managed};
  writeFile(root,'.github/house-template.json',json(record));
  if(includeSync)writeFile(root,'.github/workflows/house-source.yml',workflow(bot,updaterRef));
  for(const directory of [...snapshot.directories].sort((a,b)=>b.path.split('/').length-a.path.split('/').length))fs.chmodSync(path.join(root,directory.path),directory.mode);
  return{...record,slug:bot.slug,name:bot.name,files:filesIn(root)};
}
function git(root,args){return execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function gh(args,input){return execFileSync('gh',args,{encoding:'utf8',input,stdio:[input===undefined?'ignore':'pipe','pipe','pipe']}).trim();}
function verifyTree(root,files){const current=filesIn(root);if(JSON.stringify(current)!==JSON.stringify(files))throw Error(`Prepared files changed: ${root}`);}
async function sync(id,slug,options){
  const root=process.cwd(),repository=`clunkyard/house-${slug}`;
  if(process.env.GITHUB_REPOSITORY!==repository)throw Error('House sync runs only in its original official repository.');
  if(git(root,['status','--porcelain']))throw Error('House template checkout must be clean.');
  const prior=JSON.parse(fs.readFileSync(path.join(root,'.github/house-template.json'),'utf8'));
  if(prior.repository!==repository||prior.source.botId!==id)throw Error('House template origin changed.');
  const current=filesIn(root).filter(file=>!file.path.startsWith('.git/')&&!file.path.startsWith('.github/'));
  // A Git clone normalizes read/write permissions to 0644 or 0755. Compare
  // bytes and executability here; the public export records the full modes.
  const gitFiles=files=>files.map(({path,sha256,mode})=>({path,sha256,executable:Boolean(mode&0o111)}));
  if(JSON.stringify(gitFiles(current))!==JSON.stringify(gitFiles(prior.managed)))throw Error('Managed House files were edited; review before refreshing.');
  const source=await fetchSource({id,slug},options);if(JSON.stringify(identity(source.bot))===JSON.stringify(prior.source))return;
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'house-template-sync-'));
  try{
    const tree=path.join(temp,'prepared'),next=prepareTree(tree,source,{includeSync:false});
    for(const file of prior.managed){safePath(file.path);fs.unlinkSync(path.join(root,file.path));}
    // Only verified source/tooling and the managed list change. The updater
    // and workflow are maintained separately and cannot be replaced by bots.
    for(const file of next.managed)writeFile(root,file.path,fs.readFileSync(path.join(tree,file.path)),file.mode);
    writeFile(root,'.github/house-template.json',fs.readFileSync(path.join(tree,'.github/house-template.json')));
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
async function publish(output,rows,updaterRef){
  // All checks finish before the first repository is created. Existing repos
  // are never adopted, overwritten, force-pushed or made public by this tool.
  for(const row of rows){
    if(!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(row.slug)||row.repository!==`clunkyard/house-${row.slug}`||!UUID.test(row.source?.botId||''))throw Error('Invalid prepared House repository.');
    if(fs.readFileSync(path.join(output,'house-'+row.slug,'.github/workflows/house-source.yml'),'utf8')!==workflow({id:row.source.botId,slug:row.slug},updaterRef))throw Error('Prepared updater workflow does not match the reviewed pin.');
    verifyTree(path.join(output,'house-'+row.slug),row.files);
    const current=await profile(row.source.botId);if(JSON.stringify(identity(current))!==JSON.stringify(row.source))throw Error(`Published source advanced: ${row.slug}`);
    try{gh(['api',`repos/${row.repository}`]);throw Error(`Repository already exists: ${row.repository}`);}catch(error){if(!/HTTP 404/.test(error.stderr?.toString()||''))throw error;}
  }
  for(const row of rows){
    const directory=path.join(output,'house-'+row.slug);git(directory,['init','--initial-branch=main']);git(directory,['add','--all']);git(directory,['commit','-m','Publish verified House robot template']);
    gh(['repo','create',row.repository,'--public','--source',directory,'--remote','origin','--push','--description',`${row.name}: a ${row.language} Clunkyard House robot to study, copy and improve`,'--homepage',`${ORIGIN}/#robots/${row.source.botId}`]);
    gh(['api','--method','PATCH',`repos/${row.repository}`,'-F','is_template=true','-F','has_wiki=false','-F','has_projects=false']);
    gh(['api','--method','PUT',`repos/${row.repository}/topics`,'--input','-'],json({names:['clunkyard','robot-battle','programming-game','house-bot',row.language]}));
  }
}
async function main(argv=process.argv.slice(2)){
  const option=name=>{const index=argv.indexOf(name);return index<0?null:argv[index+1];};
  if(option('--sync'))return sync(option('--sync'),option('--slug'));
  const updaterRef=option('--updater-ref');if(argv.includes('--apply')&&!/^[0-9a-f]{40}$/.test(updaterRef||''))throw Error('Publishing requires --updater-ref REVIEWED_COMMIT_SHA.');
  const destination=option('--out');if(!destination)throw Error('Use --out NEW_DIRECTORY [--metadata PUBLIC_ROWS.json] [--updater-ref REVIEWED_SHA] [--apply].');
  const output=path.resolve(destination);if(fs.existsSync(output)){if(!argv.includes('--apply'))throw Error('Choose a new template output directory.');const prepared=JSON.parse(fs.readFileSync(path.join(output,'templates.json'),'utf8'));if(prepared.v!==1||prepared.origin!==ORIGIN||prepared.updaterRef!==updaterRef||!Array.isArray(prepared.templates)||!prepared.templates.length)throw Error('Prepared House report or updater pin is invalid.');return publish(output,prepared.templates,updaterRef);}
  const metadata=option('--metadata')?JSON.parse(fs.readFileSync(option('--metadata'),'utf8')):JSON.parse((await download(`${ORIGIN}/api/arena/bots`)).toString('utf8')).bots.filter(bot=>bot.houseBot&&bot.visibility==='published');
  if(!Array.isArray(metadata)||!metadata.length||metadata.length>100)throw Error('No public House metadata supplied.');
  const rows=[],used=new Set();for(const value of metadata){const source=await fetchSource(value);if(used.has(source.bot.slug))throw Error('Duplicate House slug.');used.add(source.bot.slug);const row=prepareTree(path.join(output,'house-'+source.bot.slug),source,{updaterRef:updaterRef||'REVIEWED_UPDATER_COMMIT'});rows.push(row);console.log(`Prepared ${row.repository}: ${source.snapshot.files.length} verified public files, revision ${row.source.revisionId}.`);}
  fs.writeFileSync(path.join(output,'templates.json'),json({v:1,origin:ORIGIN,updaterRef:updaterRef||null,templates:rows}));
  if(argv.includes('--apply'))await publish(output,rows,updaterRef);else console.log(`Dry run only. Review ${path.join(output,'templates.json')} and generated workflows before publishing.`);
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={safePath,decodeBundle,fetchSource,prepareTree,verifyTree,sync,main};
