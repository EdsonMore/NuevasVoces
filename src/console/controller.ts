import { SoundcraftUI } from 'soundcraft-ui-connection';
import { MIXER_IP } from '../config';

const MIN_GAIN_DB = -6;
const MAX_GAIN_DB = 57;
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
