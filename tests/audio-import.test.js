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
