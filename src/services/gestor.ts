import { db } from '../db/database';
import { applyGain, applyMute, readChannelState } from '../console/controller';

export interface Escena {
  id: number;
  obra_id: number;
  nombre: string;
  orden: number;
}

export interface CanalEscena {
  canal_hw: number;
  nombre_persona: string | null;
  gain_db: number;
  mute: number;
}

export function crearObra(nombre: string): number {
  const result = db.prepare('INSERT INTO obras (nombre) VALUES (?)').run(nombre);
  return Number(result.lastInsertRowid);
}

export function crearEscena(obraId: number, nombre: string): number {
  const { orden } = db
    .prepare('SELECT COALESCE(MAX(orden), 0) + 1 AS orden FROM escenas WHERE obra_id = ?')
    .get(obraId) as { orden: number };
  const result = db
    .prepare('INSERT INTO escenas (obra_id, nombre, orden) VALUES (?, ?, ?)')
    .run(obraId, nombre, orden);
  return Number(result.lastInsertRowid);
}

export function listarEscenas(): Escena[] {
  return db.prepare('SELECT id, obra_id, nombre, orden FROM escenas ORDER BY obra_id, orden').all() as Escena[];
}

/** Guarda (crea o actualiza) el estado de un canal dentro de una escena. */
export function guardarEstadoCanal(
  escenaId: number,
  canalHw: number,
  gainDb: number,
  mute: boolean,
  nombrePersona?: string,
): void {
  db.prepare(
    `INSERT INTO canales (escena_id, canal_hw, nombre_persona, gain_db, mute)
     VALUES (@escenaId, @canalHw, @nombrePersona, @gainDb, @mute)
     ON CONFLICT(escena_id, canal_hw) DO UPDATE SET
       gain_db = @gainDb,
       mute = @mute,
       nombre_persona = COALESCE(@nombrePersona, nombre_persona)`,
  ).run({
    escenaId,
    canalHw,
    nombrePersona: nombrePersona ?? null,
    gainDb,
    mute: mute ? 1 : 0,
  });
}

/** Carga una escena: aplica el gain y el mute guardados de cada canal en la consola real. */
export async function aplicarEscena(escenaId: number): Promise<void> {
  const canales = db
    .prepare('SELECT canal_hw, gain_db, mute FROM canales WHERE escena_id = ?')
    .all(escenaId) as CanalEscena[];
  for (const canal of canales) {
    await applyGain({ action: 'SET_GAIN', channel: canal.canal_hw, value: canal.gain_db });
    await applyMute(canal.canal_hw, canal.mute === 1);
  }
}

// ponytail: solo relee los canales que ya pertenecen a la escena (no hay forma barata de
// enumerar "todos los canales de la consola" sin introspección de dispositivo). Si la escena
// es nueva y aún no tiene canales, no hay nada que leer: usa guardarEstadoCanal para añadirlos.
export async function guardarEstadoActualComoEscena(escenaId: number): Promise<void> {
  const canales = db
    .prepare('SELECT canal_hw FROM canales WHERE escena_id = ?')
    .all(escenaId) as Pick<CanalEscena, 'canal_hw'>[];
  for (const canal of canales) {
    const estado = await readChannelState(canal.canal_hw);
    guardarEstadoCanal(escenaId, canal.canal_hw, estado.gainDb, estado.mute);
  }
}

/** Busca el canal hw más reciente asociado a un nombre de persona (para comandos como "sube la voz de Ana"). */
export function buscarCanalPorNombre(nombre: string): number | null {
  const row = db
    .prepare('SELECT canal_hw FROM canales WHERE nombre_persona = ? COLLATE NOCASE ORDER BY id DESC LIMIT 1')
    .get(nombre) as { canal_hw: number } | undefined;
  return row ? row.canal_hw : null;
}
