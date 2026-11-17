import { SoundcraftUI } from 'soundcraft-ui-connection';
import { MIXER_IP } from '../config';

const MIN_GAIN_DB = -6;
const MAX_GAIN_DB = 57;
const MIN_MASTER_DB = -20;
const MAX_MASTER_DB = 10;
// ponytail: timeout fijo de 5s. El SDK de Soundcraft no rechaza connect() si la consola
// está apagada (reintenta indefinidamente), así que sin este timeout la promesa cuelga para siempre.
// Subir/hacer configurable si una consola lenta en red real necesita más margen.
const CONNECT_TIMEOUT_MS = 5000;

/** Error de conexión con la consola (apagada, fuera de red, etc.), distinto de un error de validación. */
export class ConsoleConnectionError extends Error {}

let mixer: SoundcraftUI | null = null;
let connected: Promise<void> | null = null;

function getMixer(): SoundcraftUI {
  if (!mixer) mixer = new SoundcraftUI(MIXER_IP);
  return mixer;
}

function connectWithTimeout(ui: SoundcraftUI): Promise<void> {
  return Promise.race([
    ui.connect(),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new ConsoleConnectionError('La consola no está conectada o apagada.')), CONNECT_TIMEOUT_MS),
    ),
  ]);
}

function ensureConnected(): Promise<SoundcraftUI> {
  const ui = getMixer();
  if (!connected) {
    connected = connectWithTimeout(ui).catch((err) => {
      connected = null; // permite reintentar en la próxima llamada
      throw err instanceof ConsoleConnectionError ? err : new ConsoleConnectionError('La consola no está conectada o apagada.');
    });
  }
  return connected.then(() => ui);
}

/** Aplica una ganancia (dB) a un canal de la consola física. Valida el rango antes de enviar nada. */
export async function applyGain(channel: number, value: number): Promise<void> {
  if (value < MIN_GAIN_DB || value > MAX_GAIN_DB) {
    throw new Error(`Ganancia fuera de rango (${MIN_GAIN_DB} a ${MAX_GAIN_DB} dB): ${value}`);
  }
  const ui = await ensureConnected();
  ui.hw(channel).setGainDB(value);
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
