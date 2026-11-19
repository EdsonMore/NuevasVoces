import test from 'node:test';
import assert from 'node:assert/strict';
import * as sdk from 'soundcraft-ui-connection';

test('el SDK espera la respuesta entrante y recupera el estado tras un envío sin confirmación', async () => {
  let gain = 10;
  let acknowledge = true;
  const writes: number[] = [];
  const sockets: MockSocket[] = [];
  class MockSocket {
    readyState = 0;
    onopen = (_event: unknown) => {};
    onmessage = (_event: { data: string }) => {};
    onclose = (_event: { wasClean: boolean }) => {};

    constructor() {
      sockets.push(this);
      queueMicrotask(() => {
        if (this.readyState !== 0) return;
        this.readyState = 1;
        this.onopen({});
        this.onmessage({ data: '3:::SETS^model^ui24\nSETD^hw.1.gain^' + ((gain + 6) / 63) });
      });
    }

    send(message: string) {
      const match = /^3:::SETD\^hw\.1\.gain\^(.+)$/.exec(message);
      if (!match) return;
      gain = Math.round((Number(match[1]) * 63 - 6) * 10) / 10;
      writes.push(gain);
      if (acknowledge) queueMicrotask(() => this.onmessage({ data: message }));
    }

    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      queueMicrotask(() => this.onclose({ wasClean: true }));
    }
  }

  const loader = require('node:module');
  const originalLoad = loader._load;
  loader._load = function (id: string, ...args: unknown[]) {
    if (id === 'soundcraft-ui-connection') {
      return {
        ...sdk,
        SoundcraftUI: class extends sdk.SoundcraftUI {
          constructor(targetIP: string) {
            super({ targetIP, webSocketCtor: MockSocket as unknown as sdk.SoundcraftUIOptions['webSocketCtor'] });
          }
        },
      };
    }
    return originalLoad.call(this, id, ...args);
  };
  const { liveMixer } = require('../console/controller') as typeof import('../console/controller');
  loader._load = originalLoad;

  try {
    assert.equal(await liveMixer.read(2), 10);
    assert.equal(await liveMixer.write(2, 11, 10), 11);
    assert.deepEqual(writes, [11]);
    await assert.rejects(liveMixer.write(2, 12, 10), /cambió/);
    assert.deepEqual(writes, [11]);
    acknowledge = false;
    await assert.rejects(liveMixer.write(2, 20, 11), /No se confirmó/);
    assert.equal(gain, 20); // El envío pudo llegar aunque se haya perdido la respuesta.
    assert.equal(await liveMixer.read(2), 20);
    assert.equal(sockets.length, 2);
    assert.deepEqual(writes, [11, 20]);
  } finally {
    for (const socket of sockets) socket.close();
  }
});
