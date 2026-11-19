import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { SupabaseRepository } from './repository';

test('el archivo local conserva datos entre procesos y bloquea aperturas simultáneas', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'itaca-data-'));
  const modulePath = require.resolve('./repository');
  function run(code: string) {
    return spawnSync(process.execPath, ['-r', 'ts-node/register', '-e', code], {
      cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, DATA_DIR: directory },
    });
  }
  const prelude = 'const {createRepository}=require(' + JSON.stringify(modulePath) + ');';
  try {
    const first = run(prelude + '(async()=>{const repo=await createRepository("demo");' +
      'await repo.save({revision:0,shows:[{id:"one",name:"Ensayo",channels:[],scenes:[]}],proposals:[]});' +
      'try{await createRepository("demo");process.exitCode=2;}catch(error){console.log(error.message);}})();');
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Ya hay un servidor/);
    const second = run(prelude + '(async()=>{const repo=await createRepository("demo");console.log(JSON.stringify(await repo.load()));})();');
    assert.equal(second.status, 0, second.stderr);
    assert.equal(JSON.parse(second.stdout).shows[0].name, 'Ensayo');
    assert.equal(JSON.parse(second.stdout).revision, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Supabase guarda por revisión, mantiene la clave en la petición del servidor y rechaza conflictos', async () => {
  const originalFetch = global.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  let rows: unknown[] = [{ revision: 3, state: { shows: [], proposals: [] } }];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const repository = new SupabaseRepository('https://example.supabase.co', 'sb_secret_test', 'itaca');
    const state = await repository.load();
    assert.equal(state.revision, 3);
    rows = [{}];
    await repository.save(state);
    assert.match(calls[1].url, /revision=eq.3/);
    assert.equal(state.revision, 4);
    assert.equal((calls[1].init?.headers as Record<string, string>).apikey, 'sb_secret_test');
    assert.equal(JSON.parse(String(calls[1].init?.body)).revision, 4);
    rows = [];
    await assert.rejects(repository.save(state), /Otro servidor/);
    assert.equal(state.revision, 4);
  } finally {
    global.fetch = originalFetch;
  }
});
