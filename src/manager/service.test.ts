import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createUiServer } from '../ui/server';
import { SoundManager } from './service';
import { parseCommand } from '../agent/parser';
import type { Repository } from './repository';
import type { MixerPort, Workspace } from './types';

function fixture() {
  let saved: Workspace = { revision: 0, shows: [], proposals: [] };
  const gains = new Map([[2, 10], [3, 5]]);
  const writes: number[] = [];
  let failOn = 0;
  const repository: Repository = {
    kind: 'local',
    load: async () => structuredClone(saved),
    save: async (state) => { state.revision++; saved = structuredClone(state); },
  };
  const mixer: MixerPort = {
    mode: 'demo',
    read: async (channel) => {
      const value = gains.get(channel);
      if (value === undefined) throw new Error('No hay lectura.');
      return value;
    },
    write: async (channel, value, expected) => {
      if (channel === failOn) throw new Error('Conexión interrumpida.');
      assert.equal(gains.get(channel), expected);
      writes.push(channel);
      gains.set(channel, value);
      return value;
    },
  };
  return {
    manager: new SoundManager(repository, mixer), repository, mixer, gains, writes,
    fail: (channel: number) => { failOn = channel; },
  };
}

async function prepare(context = fixture()) {
  const show = await context.manager.saveShow(undefined, 'Ensayo');
  for (const [channel, actor] of [[2, 'Ana'], [3, 'Luis']] as const) {
    await context.manager.saveChannel(show.id, { channel, actor, microphone: 'Diadema ' + channel, minGain: -6, maxGain: 20 });
  }
  return { ...context, show };
}

test('voz por actor crea propuesta, rechazo no escribe y doble confirmación aplica una vez', async () => {
  const { manager, show, gains, writes } = await prepare();
  const proposal = await manager.proposeCommand(show.id, 'dale un poco más de ganancia a Ana');
  assert.deepEqual(proposal.changes, [{ channel: 2, before: 10, after: 11, delta: 1 }]);
  assert.equal(gains.get(2), 10);
  await manager.reject(proposal.id);
  assert.equal(writes.length, 0);
  await assert.rejects(manager.confirm(proposal.id), /resuelta/);
  const second = await manager.proposeCommand(show.id, 'pon el segundo canal en 12 dB');
  await Promise.all([manager.confirm(second.id), manager.confirm(second.id)]);
  assert.equal(gains.get(2), 12);
  assert.deepEqual(writes, [2]);
});

test('rechaza actor desconocido, límites, lecturas ausentes y valor obsoleto antes de escribir', async () => {
  const { manager, show, gains, writes } = await prepare();
  await assert.rejects(manager.proposeCommand(show.id, 'sube un poco la ganancia de Pedro'), /interpretar/);
  await assert.rejects(manager.proposeCommand(show.id, 'pon el canal 2 en 21 dB'), /permite/);
  const proposal = await manager.proposeCommand(show.id, 'sube un poco el canal 2');
  gains.set(2, 14);
  await assert.rejects(manager.confirm(proposal.id), /Cambió/);
  gains.delete(2);
  await assert.rejects(manager.proposeCommand(show.id, 'sube un poco el canal 2'), /lectura/);
  assert.equal(writes.length, 0);
});

test('deshacer requiere aprobación, restaura el valor anterior y respeta cambios manuales', async () => {
  const { manager, show, gains } = await prepare();
  const proposal = await manager.proposeCommand(show.id, 'pon el canal 2 en 15 dB');
  await manager.confirm(proposal.id);
  const undo = await manager.proposeUndo(proposal.id);
  assert.equal(gains.get(2), 15);
  await manager.confirm(undo.id);
  assert.equal(gains.get(2), 10);
  await assert.rejects(manager.proposeUndo(proposal.id), /deshacer/);
  const next = await manager.proposeCommand(show.id, 'pon el canal 2 en 12 dB');
  await manager.confirm(next.id);
  gains.set(2, 13);
  await assert.rejects(manager.proposeUndo(next.id), /cambió/);
});

test('las propuestas caducan tras reinicio y editar límites invalida decisiones pendientes', async () => {
  const { manager, show, repository, mixer, writes } = await prepare();
  const proposal = await manager.proposeCommand(show.id, 'sube un poco el canal 2');
  const restarted = new SoundManager(repository, mixer);
  await assert.rejects(restarted.confirm(proposal.id), /caducó/);
  const pending = await manager.proposeCommand(show.id, 'sube un poco el canal 2');
  await manager.saveChannel(show.id, { channel: 2, actor: 'Ana', microphone: 'M2', minGain: -6, maxGain: 10 });
  await assert.rejects(manager.confirm(pending.id), /resuelta/);
  assert.equal(writes.length, 0);
});

test('cinco escenas actualizan el modo guía solo al confirmar', async () => {
  const { manager, show, gains } = await prepare();
  for (let index = 1; index <= 5; index++) {
    const scene = await manager.saveScene(show.id, undefined, {
      name: 'Escena ' + index, notes: 'Entrada', gains: [{ channel: 2, value: index }],
    });
    const proposal = await manager.proposeScene(show.id, scene.id);
    assert.notEqual((await manager.view()).shows[0].activeSceneId, scene.id);
    await manager.confirm(proposal.id);
    assert.equal(gains.get(2), index);
    assert.equal((await manager.view()).shows[0].activeSceneId, scene.id);
  }
});

test('revisar la misma escena actualiza un solo cuadro y requiere confirmar la versión visible', async () => {
  const { manager, show, gains, writes } = await prepare();
  const scene = await manager.saveScene(show.id, undefined, {
    name: 'Entrada', gains: [{ channel: 2, value: 15 }],
  });
  const first = await manager.proposeScene(show.id, scene.id);
  gains.set(2, 12);
  const refreshed = await manager.proposeScene(show.id, scene.id);
  assert.equal(refreshed.id, first.id);
  assert.equal(refreshed.createdAt, first.createdAt);
  assert.equal(refreshed.reviewVersion, 2);
  assert.deepEqual(refreshed.changes, [{ channel: 2, before: 12, after: 15 }]);
  const state = await manager.view();
  assert.equal(state.proposals.length, 1);
  assert.equal(state.proposals.filter((proposal) => proposal.status === 'pending').length, 1);
  assert.deepEqual(writes, []);
  await assert.rejects(manager.confirm(first.id, first.reviewVersion), /se actualizó/);
  await assert.rejects(manager.confirm(first.id), /se actualizó/);
  assert.equal((await manager.confirm(refreshed.id, refreshed.reviewVersion)).status, 'applied');
  assert.equal(gains.get(2), 15);
  assert.deepEqual(writes, [2]);
  const next = await manager.proposeScene(show.id, scene.id);
  assert.notEqual(next.id, first.id);
});

test('peticiones simultáneas a la misma escena mantienen una sola propuesta pendiente', async () => {
  const { manager, show, writes } = await prepare();
  const scene = await manager.saveScene(show.id, undefined, {
    name: 'Entrada', gains: [{ channel: 2, value: 15 }],
  });
  const reviews = await Promise.all(Array.from({ length: 4 }, () => manager.proposeScene(show.id, scene.id)));
  assert.equal(new Set(reviews.map((proposal) => proposal.id)).size, 1);
  assert.deepEqual(reviews.map((proposal) => proposal.reviewVersion), [1, 2, 3, 4]);
  assert.equal((await manager.view()).proposals.length, 1);
  assert.deepEqual(writes, []);
});

test('los duplicados anteriores pasan al historial y su confirmación queda invalidada', async () => {
  const { manager, show, repository, writes } = await prepare();
  const scene = await manager.saveScene(show.id, undefined, {
    name: 'Entrada', gains: [{ channel: 2, value: 15 }],
  });
  const first = await manager.proposeScene(show.id, scene.id);
  await manager.proposeCommand(show.id, 'sube un poco el canal 3');
  const oldData = await repository.load();
  const legacy = { ...first, id: 'legacy-copy' };
  delete legacy.reviewVersion;
  oldData.proposals.push(legacy);
  await repository.save(oldData);
  await assert.rejects(manager.confirm(first.id, first.reviewVersion), /resuelta/);
  const state = await manager.view();
  assert.equal(state.proposals.length, 3);
  assert.equal(state.proposals.find((proposal) => proposal.id === first.id)?.status, 'superseded');
  assert.equal(state.proposals.find((proposal) => proposal.id === legacy.id)?.status, 'pending');
  assert.equal(state.proposals.find((proposal) => proposal.source === 'command')?.status, 'pending');
  assert.equal((await repository.load()).proposals[0].status, 'superseded');
  assert.deepEqual(writes, []);
});

test('rechazar o caducar permite otra revisión y cada escena mantiene su propia propuesta', async () => {
  const { manager, show, repository } = await prepare();
  const scene = await manager.saveScene(show.id, undefined, {
    name: 'Entrada', gains: [{ channel: 2, value: 15 }],
  });
  const secondScene = await manager.saveScene(show.id, undefined, {
    name: 'Salida', gains: [{ channel: 2, value: 8 }],
  });
  const first = await manager.proposeScene(show.id, scene.id);
  await manager.reject(first.id);
  const next = await manager.proposeScene(show.id, scene.id);
  assert.notEqual(next.id, first.id);
  const expiredData = await repository.load();
  expiredData.proposals.find((proposal) => proposal.id === next.id)!.expiresAt = new Date(0).toISOString();
  await repository.save(expiredData);
  const fresh = await manager.proposeScene(show.id, scene.id);
  assert.notEqual(fresh.id, next.id);
  await manager.proposeScene(show.id, secondScene.id);
  const state = await manager.view();
  assert.equal(state.proposals.find((proposal) => proposal.id === next.id)?.status, 'expired');
  assert.equal(state.proposals.filter((proposal) => proposal.status === 'pending').length, 2);
});

test('una escena parcialmente aplicada conserva resultados y nunca se reenvía al reintentar', async () => {
  const context = await prepare();
  const scene = await context.manager.saveScene(context.show.id, undefined, {
    name: 'Dúo', gains: [{ channel: 2, value: 12 }, { channel: 3, value: 8 }],
  });
  const proposal = await context.manager.proposeScene(context.show.id, scene.id);
  context.fail(3);
  const result = await context.manager.confirm(proposal.id);
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.applied.map((change) => change.channel), [2]);
  assert.equal((await context.manager.view()).shows[0].activeSceneId, undefined);
  await assert.rejects(context.manager.confirm(proposal.id), /resuelta/);
  assert.deepEqual(context.writes, [2]);
});

test('el parser conserva comandos numéricos y rechaza negaciones, objetivos múltiples y unidades ajenas', () => {
  assert.deepEqual(parseCommand('pon el canal 2 en menos 2,5 decibeles'), { action: 'SET_GAIN', channel: 2, value: -2.5 });
  assert.deepEqual(parseCommand('sube un poco'), { action: 'ADJUST_GAIN', channel: 2, delta: 1 });
  for (const phrase of ['no subas el canal 2 a 5', 'pon el canal 2 en 5 y el canal 3 en 2', 'sube el volumen del canal 2 en 3']) {
    assert.equal(parseCommand(phrase), null);
  }
});

test('HTTP sirve la interfaz y exige confirmar antes de escribir, incluso en /command', async () => {
  const context = await prepare();
  const server = createUiServer(context.manager);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port;
  async function post(path: string, body = {}) {
    return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  try {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Cambios pendientes/);
    const command = await post('/command', { showId: context.show.id, text: 'sube un poco el canal 2' });
    assert.equal(command.status, 201);
    const proposal = await command.json() as { id: string };
    assert.equal(context.writes.length, 0);
    const confirmed = await post('/api/proposals/' + proposal.id + '/confirm');
    assert.equal(confirmed.status, 200);
    assert.deepEqual(context.writes, [2]);
    const scene = await context.manager.saveScene(context.show.id, undefined, {
      name: 'Entrada', gains: [{ channel: 2, value: 15 }],
    });
    const sceneRoute = '/api/shows/' + context.show.id + '/scenes/' + scene.id + '/propose';
    const firstReview = await (await post(sceneRoute)).json() as { id: string; reviewVersion: number };
    const latest = await (await post(sceneRoute)).json() as { id: string; reviewVersion: number };
    assert.equal(firstReview.id, latest.id);
    assert.equal((await post('/api/proposals/' + latest.id + '/confirm', { reviewVersion: firstReview.reviewVersion })).status, 409);
    assert.equal((await post('/api/proposals/' + latest.id + '/confirm', { reviewVersion: latest.reviewVersion })).status, 200);
    const crossOrigin = await fetch(base + '/api/shows', {
      method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Otra' }),
    });
    assert.equal(crossOrigin.status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
