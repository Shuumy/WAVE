const { test } = require('node:test');
const assert = require('node:assert/strict');
const { convert, jsonRequest } = require('../js/audio-import.js');

test('ready audio becomes a named File and releases the server job', async () => {
  const calls = [], messages = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({url, options});
    if (options.method === 'POST') return Response.json({id: 'abc'});
    if (options.method === 'DELETE') return new Response(null, {status: 204});
    if (url.endsWith('/file')) return new Response('audio fixture', {headers: {'content-type': 'audio/mpeg'}});
    return Response.json({state:'ready', title:'Demo', artist:'WAVE', message:'Prêt'});
  };
  try {
    const file = await convert('https://api.test', 'https://youtu.be/BaW_jenozKc', 'mp3', m=>messages.push(m));
    assert.equal(file.name, 'WAVE - Demo.mp3');
    assert.equal(file.type, 'audio/mpeg');
    assert.deepEqual(messages, ['Prêt']);
    assert.equal(JSON.parse(calls[0].options.body).format, 'mp3');
    assert.equal(calls.at(-1).options.method, 'DELETE');
  } finally { global.fetch = original; }
});

test('source failure reaches the user without downloading a file', async () => {
  const original = global.fetch;
  global.fetch = async (_url, options) => Response.json(options.method === 'POST' ? {id:'abc'} : {state:'failed',message:'Source indisponible'});
  try { await assert.rejects(convert('https://api.test', 'url', 'mp3', ()=>{}), /Source indisponible/); }
  finally { global.fetch = original; }
});

test('disabled service gives the API explanation', async () => {
  const original = global.fetch;
  global.fetch = async () => Response.json({detail:'Service non activé'}, {status:503});
  try { await assert.rejects(jsonRequest('https://api.test'), /Service non activé/); }
  finally { global.fetch = original; }
});

test('HTML payload cannot be imported as audio', async () => {
  const original = global.fetch;
  global.fetch = async (url, options) => {
    if (options.method === 'POST') return Response.json({id:'abc'});
    if (url.endsWith('/file')) return new Response('<html>Error</html>', {headers:{'content-type':'text/html'}});
    return Response.json({state:'ready'});
  };
  try { await assert.rejects(convert('https://api.test','url','mp3',()=>{}), /fichier audio valide/); }
  finally { global.fetch = original; }
});

test('direct download uses the selected provider without adding to the library', async () => {
  const { init } = require('../js/audio-import.js');
  const originalFetch = global.fetch, originalDocument = global.document;
  const nodes = {};
  for (const id of ['audioLinkForm','audioLinkStatus','audioLinkSubmit','audioLinkDirect','audioLinkDownload','audioLinkSave','audioProviderStatus','audioProviderRefresh']) {
    nodes[id] = { hidden: true, listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; }, setAttribute() {}, click() { this.clicked = true; } };
  }
  nodes.audioLinkForm.elements = { url: {value:'https://youtu.be/BaW_jenozKc'}, format: {value:'mp3'}, provider: {value:'cobalt', options:[{value:'',textContent:'Serveur WAVE'},{value:'cobalt',textContent:'Cobalt'},{value:'piped',textContent:'Piped'}]} };
  global.document = {getElementById: id => nodes[id]};
  let saved = 0, selected;
  global.fetch = async (url, options) => {
    if (url.endsWith('/config')) return Response.json({providers:[{value:'',label:'Serveur WAVE',configured:true},{value:'cobalt',label:'Cobalt',configured:true},{value:'piped',label:'Piped',configured:false}]});
    if (options.method === 'POST') { selected = JSON.parse(options.body).provider; return Response.json({id:'download'}); }
    if (options.method === 'DELETE') return new Response(null, {status:204});
    if (url.endsWith('/file')) return new Response('fixture', {headers:{'content-type':'audio/mpeg'}});
    return Response.json({state:'ready',title:'Demo'});
  };
  try {
    await init('https://api.test', async () => { saved++; return 1; });
    assert.equal(nodes.audioLinkForm.elements.provider.options[2].disabled, true);
    await nodes.audioLinkForm.listeners.submit({preventDefault(){},submitter:{value:'download'}});
    assert.equal(selected, 'cobalt');
    assert.equal(saved, 0);
    assert.equal(nodes.audioLinkDownload.clicked, true);
    assert.equal(nodes.audioLinkDownload.download, 'Demo.mp3');
    assert.equal(nodes.audioLinkSave.hidden, false);
    await nodes.audioLinkSave.listeners.click();
    assert.equal(saved, 1);
    nodes.audioLinkStatus.textContent = 'Ancienne erreur Piped';
    nodes.audioLinkForm.elements.provider.value = 'piped';
    nodes.audioLinkForm.listeners.change();
    assert.equal(nodes.audioLinkStatus.textContent, '');
    assert.equal(nodes.audioLinkDownload.hidden, true);
    assert.equal(nodes.audioLinkDirect.disabled, true);
    nodes.audioLinkForm.elements.provider.value = 'cobalt';
    nodes.audioLinkForm.listeners.change();
    assert.equal(nodes.audioLinkDirect.disabled, false);
  } finally {
    URL.revokeObjectURL(nodes.audioLinkDownload.href);
    global.fetch = originalFetch; global.document = originalDocument;
  }
});
