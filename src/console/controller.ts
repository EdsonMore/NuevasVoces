import { ConnectionStatus, DEVICE_CAPABILITIES, SoundcraftUI } from 'soundcraft-ui-connection';
import type { ConnectionEvent, HwChannel } from 'soundcraft-ui-connection';
import type { GainCommand } from '../agent/parser';
import { MIXER_IP, RECONNECT_TIMEOUT_MS } from '../config';
import type { MixerPort } from '../manager/types';

const GAIN_READ_TIMEOUT_MS = 2_000;
const GAIN_LIMITS = new Map([
  ['ui12', { channels: DEVICE_CAPABILITIES.ui12.input, min: -40, max: 50 }],
  ['ui16', { channels: DEVICE_CAPABILITIES.ui16.input, min: -40, max: 50 }],
  ['ui24', { channels: 20, min: -6, max: 57 }],
]);

export class ConsoleConnectionError extends Error {}

let mixer: SoundcraftUI | undefined;
let connecting: Promise<SoundcraftUI> | undefined;
const pendingByChannel = new Map<number, Promise<number>>();

async function openMixer(): Promise<SoundcraftUI> {
  const ui = new SoundcraftUI(MIXER_IP);
  const offline = new ConsoleConnectionError('No se pudo conectar con la consola.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let opened = false;

  const status = ui.status$.subscribe(({ type }: ConnectionEvent) => {
    if (type === ConnectionStatus.Open) opened = true;
    else if (opened) discard();
  });

  function discard(): void {
    if (status.closed) return;
    status.unsubscribe();
    if (mixer === ui) mixer = undefined;

    // El SDK conserva los parámetros entre reconexiones. La siguiente conexión
    // usa una instancia nueva para evitar leer datos de la sesión anterior.
    queueMicrotask(() => {
      void ui.disconnect().catch((err) => console.error('[consola] Error al cerrar la conexión:', err));
    });
  }

  try {
    await Promise.race([
      ui.connect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(offline), RECONNECT_TIMEOUT_MS);
      }),
    ]);
    if (status.closed || ui.conn.status !== ConnectionStatus.Open) throw offline;
    mixer = ui;
    return ui;
  } catch {
    discard();
    throw offline;
  } finally {
    clearTimeout(timer);
  }
}

function ensureConnected(): Promise<SoundcraftUI> {
  if (mixer) return Promise.resolve(mixer);
  connecting ??= openMixer().finally(() => { connecting = undefined; });
  return connecting;
}

function readGainDb(input: HwChannel, channel: number): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let subscription: { unsubscribe(): void } | undefined;
  const unavailable = new Error(`No se pudo leer la ganancia del canal ${channel}.`);

  const reading = new Promise<number>((resolve, reject) => {
    timer = setTimeout(() => reject(unavailable), GAIN_READ_TIMEOUT_MS);
    subscription = input.gainDB$.subscribe({
      next: (value: number) => { if (Number.isFinite(value)) resolve(value); },
      error: () => reject(unavailable),
      complete: () => reject(unavailable),
    });
  });

  // Se limpia al finalizar la promesa porque el observable puede emitir al suscribirse.
  return reading.finally(() => {
    clearTimeout(timer);
    subscription?.unsubscribe();
  });
}

async function executeGain(command: GainCommand, expected?: number): Promise<number> {
  const ui = await ensureConnected();
  const limits = GAIN_LIMITS.get(ui.deviceInfo.model ?? '');
  if (!limits) throw new Error('No se pudo identificar un modelo Soundcraft Ui compatible.');

  const channel = command.channel;
  if (!Number.isInteger(channel) || channel < 1 || channel > limits.channels) {
    throw new Error(`El canal debe estar entre 1 y ${limits.channels}.`);
  }

  const input = ui.hw(channel);
  if (expected !== undefined && Math.abs((await readGainDb(input, channel)) - expected) > 0.11) {
    throw new Error('La ganancia del canal ' + channel + ' cambió. Genera una propuesta nueva.');
  }
  const value = command.action === 'ADJUST_GAIN'
    ? Number(((await readGainDb(input, channel)) + command.delta).toPrecision(15))
    : command.value;

  if (!Number.isFinite(value) || value < limits.min || value > limits.max) {
    throw new Error(`Ganancia fuera de rango para el canal ${channel} (${limits.min} a ${limits.max} dB): ${value}`);
  }
  if (mixer !== ui || ui.conn.status !== ConnectionStatus.Open) {
    throw new ConsoleConnectionError('Se interrumpió la conexión con la consola antes de enviar el ajuste.');
  }
  // El SDK incluye las escrituras optimistas en su estado. La confirmación
  // debe llegar por el flujo entrante de la consola.
  const path = (ui.deviceInfo.model === 'ui24' ? 'hw' : 'i') + '.' + (channel - 1) + '.gain';
  let subscription: { unsubscribe(): void } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('No se confirmó el ajuste del canal ' + channel + '. Verifica la consola antes de reintentar.')), GAIN_READ_TIMEOUT_MS);
      subscription = ui.conn.inbound$.subscribe({
        next: (message: string) => {
          const [type, address, raw] = message.split('^');
          const db = Number(raw) * (limits.max - limits.min) + limits.min;
          if (type === 'SETD' && address === path && Number.isFinite(db) && Math.abs(db - value) <= 0.11) resolve();
        },
        error: () => reject(new ConsoleConnectionError('Conexión interrumpida durante el ajuste.')),
      });
      input.setGainDB(value);
    });
  } catch (error) {
    if (mixer === ui) mixer = undefined;
    void ui.disconnect().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    subscription?.unsubscribe();
  }
  return value;
}

async function queuedGain(command: GainCommand, expected?: number): Promise<number> {
  // Dos ajustes seguidos al mismo canal deben leer y escribir en orden.
  const previous = pendingByChannel.get(command.channel);
  const adjustment = (previous ?? Promise.resolve()).catch(() => {}).then(() => executeGain(command, expected));
  pendingByChannel.set(command.channel, adjustment);

  try {
    return await adjustment;
  } finally {
    if (pendingByChannel.get(command.channel) === adjustment) pendingByChannel.delete(command.channel);
  }
}

export async function applyGain(command: GainCommand): Promise<number> {
  return queuedGain(command);
}

export async function readGain(channel: number): Promise<number> {
  const ui = await ensureConnected();
  const limits = GAIN_LIMITS.get(ui.deviceInfo.model ?? '');
  if (!limits || !Number.isInteger(channel) || channel < 1 || channel > limits.channels) {
    throw new Error('Canal no disponible en la consola conectada.');
  }
  return readGainDb(ui.hw(channel), channel);
}

export const liveMixer: MixerPort = {
  mode: 'live',
  read: readGain,
  write: (channel, value, expected) => queuedGain({ action: 'SET_GAIN', channel, value }, expected),
};

export function createDemoMixer(): MixerPort {
  const gains = new Map<number, number>();
  function read(channel: number): number {
    if (!Number.isInteger(channel) || channel < 1 || channel > 20) throw new Error('Canal de demostración fuera de rango.');
    return gains.get(channel) ?? 0;
  }
  return {
    mode: 'demo',
    read: async (channel) => read(channel),
    write: async (channel, value, expected) => {
      if (Math.abs(read(channel) - expected) > 0.11) throw new Error('La ganancia cambió. Genera una propuesta nueva.');
      if (!Number.isFinite(value) || value < -6 || value > 57) throw new Error('Ganancia fuera de rango.');
      gains.set(channel, value);
      return value;
    },
  };
}

/** Cambia la ganancia (dB) de un canal de forma relativa (p.ej. "sube la voz de Ana"). */
export async function changeGain(channel: number, offsetDb: number): Promise<void> {
  const ui = await ensureConnected();
  ui.hw(channel).changeGainDB(offsetDb);
}

/** Pone/quita el mute de un canal en el bus principal. */
export async function applyMute(channel: number, muted: boolean): Promise<void> {
  const ui = await ensureConnected();
  ui.master.input(channel).setMute(muted);
}

/** Ajusta el nivel (dB) del fader Master. Valida el rango antes de enviar nada. */
export async function applyMaster(value: number): Promise<void> {
  if (value < MIN_MASTER_DB || value > MAX_MASTER_DB) {
    throw new Error(`Nivel de master fuera de rango (${MIN_MASTER_DB} a ${MAX_MASTER_DB} dB): ${value}`);
  }
  const ui = await ensureConnected();
  ui.master.setFaderLevelDB(value);
}

const MAX_EQ_CHANGE_DB = 10;
// ponytail: mapeo fijo a las 4 bandas del EQ paramétrico (1=low, 2=low-mid, 4=high); la frecuencia
// real de cada banda la decide el técnico en la consola. Cambiar mid a 3 si "medios" debe ser presencia.
const EQ_BAND_NUMBER = { low: 1, mid: 2, high: 4 } as const;

/** Cambia de forma relativa la ganancia (dB) de una banda del EQ de un canal. Máx ±10 dB por cambio. */
export async function applyEQ(channel: number, band: 'low' | 'mid' | 'high', value: number): Promise<void> {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_EQ_CHANGE_DB) {
    throw new Error(`Cambio de EQ fuera de rango (±${MAX_EQ_CHANGE_DB} dB): ${value}`);
  }
  const ui = await ensureConnected();
  ui.master.input(channel).eq.band(EQ_BAND_NUMBER[band]).changeGainDB(value);
}

// ponytail: la librería expone el estado como Observable (tipo BehaviorSubject: emite el valor
// actual de inmediato al suscribirse). No hay getter directo, así que leemos la primera emisión
// y nos desuscribimos. Tipado estructural a propósito: rxjs no está instalado como dependencia
// directa y no hace falta traerlo solo para esto.
function readOnce<T>(obs: { subscribe: (cb: (v: T) => void) => { unsubscribe: () => void } }): Promise<T> {
  return new Promise((resolve) => {
    const sub = obs.subscribe((value) => {
      resolve(value);
      sub.unsubscribe();
    });
  });
}

/** Lee el estado actual (ganancia y mute) de un canal directamente de la consola. */
export async function readChannelState(channel: number): Promise<{ gainDb: number; mute: boolean }> {
  const ui = await ensureConnected();
  const [gainDb, mute] = await Promise.all([
    readOnce<number>(ui.hw(channel).gainDB$),
    readOnce<boolean>(ui.master.input(channel).mute$),
  ]);
  return { gainDb, mute };
}
