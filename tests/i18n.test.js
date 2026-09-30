const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function fixture(saved='fr', fail=false) {
  const nodes=[], writes=[], events=[];
  const body={nodeType:1,closest:()=>null,hasAttribute:()=>false};
  let mutation;
  const document={body,documentElement:{},createTreeWalker:()=>{let index=0;return {nextNode:()=>nodes[index++]};}};
  const db={getSetting:async()=>saved,setSetting:async(key,value)=>{if(fail)throw Error('Storage');writes.push([key,value]);}};
  const context=vm.createContext({document,navigator:{languages:['en-GB']},window:{dispatchEvent:e=>events.push(e),addEventListener(){}},CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}},NodeFilter:{SHOW_ELEMENT:1,SHOW_TEXT:4},MutationObserver:class {constructor(fn){mutation=fn;}observe(){}}});
  vm.runInContext(fs.readFileSync('js/locales.js','utf8')+'\n'+fs.readFileSync('js/i18n.js','utf8')+'\nthis.api=WaveI18n;this.catalog=WaveLocales;',context);
  function text(value,protectedValue=false) {
    const parent={closest:selector=>selector.includes('.track-title') ? (protectedValue?parent:null) : selector.includes('.nav-btn') ? parent:null};
    const node={nodeType:3,parentElement:parent,nodeValue:value,isConnected:true};nodes.push(node);return node;
  }
  return {api:context.api,catalog:context.catalog,document,db,writes,events,text,mutate:node=>mutation([{type:'characterData',target:node}])};
}

test('21 explicit locales have all 53 core messages and valid identifiers',()=>{
  const {catalog}=fixture();assert.equal(catalog.definitions.length,21);
  for(const [id] of catalog.definitions){
    assert.doesNotThrow(()=>Intl.getCanonicalLocales(id));
    assert.equal(Object.keys(catalog.catalogs[id]).length,catalog.keys.length);
    for(const value of Object.values(catalog.catalogs[id])){assert.ok(value.trim());assert.ok(!/[\u00ad\u200b]/.test(value));}
  }
});
test('language, regional variants and scripts resolve without inventing dialect catalogs',()=>{
  const {api}=fixture();
  for(const [input,expected] of [['en-CA','en'],['fr-CA','fr'],['pt-BR','pt-BR'],['pt-AO','pt-PT'],['zh-TW','zh-Hant'],['zh-SG','zh-Hans'],['zh-Hant-HK','zh-Hant'],['nb-NO','nb'],['nn-NO','nn'],['no','nb'],['yue-HK',null],['constructor',null],['xx',null]])assert.equal(api.resolve(input),expected);
  assert.equal(api.deviceLocale(['xx','ja-JP','en']), 'ja');
  assert.equal(api.resolve('zh-Hans-TW'), 'zh-Hans');
  assert.equal(api.resolve('pt-BR-u-nu-latn'), 'pt-BR');
  assert.equal(api.deviceLocale(['xx']), 'fr');
});
test('selection persists and Arabic direction reverses safely on return to French',async()=>{
  const f=fixture();await f.api.init(f.db);await f.api.setLanguage('ar');
  assert.equal(f.api.t('Accueil'),'الرئيسية');assert.equal(f.document.documentElement.dir,'rtl');
  assert.deepEqual(f.writes,[['language','ar']]);
  await f.api.setLanguage('fr');assert.equal(f.document.documentElement.dir,'ltr');assert.equal(f.api.t('Accueil'),'Accueil');
});
test('device selection, saved language, invalid preference and storage failure',async()=>{
  const f=fixture('system');await f.api.init(f.db);assert.equal(f.api.locale,'en');assert.equal(f.api.preference,'system');
  const reload=fixture('ja');await reload.api.init(reload.db);assert.equal(reload.api.locale,'ja');
  const invalid=fixture('constructor');await invalid.api.init(invalid.db);assert.equal(invalid.api.locale,'fr');
  await assert.rejects(invalid.api.setLanguage('__proto__'));assert.equal(invalid.writes.length,0);
  const fail=fixture('fr',true);await fail.api.init(fail.db);await assert.rejects(fail.api.setLanguage('ar'));assert.equal(fail.api.locale,'fr');
});
test('UI round trips retain originals; identical user metadata is untouched',async()=>{
  const f=fixture();const ui=f.text('Accueil'),title=f.text('Accueil',true);
  await f.api.init(f.db);await f.api.setLanguage('ja');assert.equal(ui.nodeValue,'ホーム');assert.equal(title.nodeValue,'Accueil');
  await f.api.setLanguage('en');assert.equal(ui.nodeValue,'Home');await f.api.setLanguage('fr');assert.equal(ui.nodeValue,'Accueil');
  assert.equal(f.api.t('__proto__'),'__proto__');assert.equal(f.api.t('Un message non traduit'),'Un message non traduit');
});
test('dynamically rebuilt UI translates once and preserves sort affordances',async()=>{
  const f=fixture('en');await f.api.init(f.db);const ui=f.text(' ✓ Titre ↓ ');
  f.mutate(ui);assert.equal(ui.nodeValue,' ✓ Title ↓ ');f.mutate(ui);assert.equal(ui.nodeValue,' ✓ Title ↓ ');
  ui.nodeValue='Artiste';f.mutate(ui);assert.equal(ui.nodeValue,'Artist');
  await f.api.setLanguage('fr');assert.equal(ui.nodeValue,'Artiste');
});
