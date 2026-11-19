import { randomUUID } from 'crypto';
import { parseCommand } from '../agent/parser';
import { DEFAULT_CHANNEL } from '../config';
import { AppError } from './types';
import type { ChannelAssignment, GainChange, MixerPort, Proposal, Scene, Show, Workspace } from './types';
import type { Repository } from './repository';

const PROPOSAL_LIFETIME_MS = 2 * 60_000;
const CLOSE_ENOUGH_DB = 0.11;

function text(value: unknown, field: string, optional = false): string {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > 300) {
    throw new AppError('Revisa el campo ' + field + '.');
  }
  return value.trim();
}

function number(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new AppError(field + ' debe ser un número válido.');
  return value;
}

function channelNumber(value: unknown): number {
  const channel = number(value, 'Canal');
  if (!Number.isInteger(channel) || channel < 1 || channel > 20) throw new AppError('Selecciona un canal entre 1 y 20.');
  return channel;
}

function findShow(state: Workspace, id: string): Show {
  const show = state.shows.find((item) => item.id === id);
  if (!show) throw new AppError('La obra ya no está disponible.', 404);
  return show;
}

function findProposal(state: Workspace, id: string): Proposal {
  const proposal = state.proposals.find((item) => item.id === id);
  if (!proposal) throw new AppError('La propuesta ya no está disponible.', 404);
  return proposal;
}

function validateGain(show: Show, channel: number, value: number): void {
  const assignment = show.channels.find((item) => item.channel === channel);
  if (!assignment) throw new AppError('Registra el canal ' + channel + ' en el mapa de la obra.');
  if (!Number.isFinite(value) || value < assignment.minGain || value > assignment.maxGain) {
    throw new AppError('El canal ' + channel + ' permite de ' + assignment.minGain + ' a ' + assignment.maxGain + ' dB.');
  }
}

function invalidate(showId: string, state: Workspace): void {
  for (const proposal of state.proposals) {
    if (proposal.showId === showId && proposal.status === 'pending') {
      proposal.status = 'stale';
      proposal.message = 'Se modificó la obra. Genera una propuesta nueva.';
    }
  }
}

function collapseSceneProposals(state: Workspace): boolean {
  const seen = new Set<string>();
  let changed = false;
  // Conserva la revisión más reciente de los datos creados antes de esta mejora.
  for (const proposal of [...state.proposals].reverse()) {
    if (proposal.source !== 'scene' || !proposal.sceneId || proposal.status !== 'pending') continue;
    const key = JSON.stringify([proposal.showId, proposal.sceneId, proposal.session, proposal.mode]);
    if (seen.has(key)) {
      proposal.status = 'superseded';
      proposal.message = 'Sustituida por la revisión más reciente de esta escena.';
      proposal.decidedAt = new Date().toISOString();
      changed = true;
    }
    seen.add(key);
  }
  return changed;
}

export class SoundManager {
  private readonly session = randomUUID();
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly repository: Repository, private readonly mixer: MixerPort) {}

  // Las decisiones y ediciones se serializan para proteger tanto el archivo
  // como la secuencia de lectura, aprobación y escritura.
  private run<T>(operation: (state: Workspace) => Promise<T>): Promise<T> {
    const task = this.tail.catch(() => {}).then(async () => {
      const state = await this.repository.load();
      if (collapseSceneProposals(state)) await this.repository.save(state);
      return operation(state);
    });
    this.tail = task;
    return task;
  }

  view(): Promise<Workspace & { mode: string; storage: string }> {
    return this.run(async (state) => {
      for (const proposal of state.proposals) {
        if (proposal.status === 'pending' && (proposal.session !== this.session || Date.parse(proposal.expiresAt) <= Date.now())) {
          proposal.status = 'expired';
          proposal.message = 'La propuesta caducó. Vuelve a consultar la consola.';
        }
        if (proposal.status === 'applying') {
          proposal.status = 'failed';
          proposal.message = 'La aplicación se reinició durante el envío. Verifica los canales en la consola.';
        }
      }
      return { ...state, mode: this.mixer.mode, storage: this.repository.kind };
    });
  }

  saveShow(id: string | undefined, name: unknown): Promise<Show> {
    return this.run(async (state) => {
      const title = text(name, 'nombre de la obra');
      const show = id ? findShow(state, id) : { id: randomUUID(), name: title, channels: [], scenes: [] };
      show.name = title;
      if (!id) state.shows.push(show);
      await this.repository.save(state);
      return show;
    });
  }

  deleteShow(id: string): Promise<void> {
    return this.run(async (state) => {
      findShow(state, id);
      invalidate(id, state);
      state.shows = state.shows.filter((show) => show.id !== id);
      await this.repository.save(state);
    });
  }

  saveChannel(showId: string, body: Record<string, unknown>): Promise<ChannelAssignment> {
    return this.run(async (state) => {
      const show = findShow(state, showId);
      const assignment: ChannelAssignment = {
        channel: channelNumber(body.channel),
        actor: text(body.actor, 'actor'),
        microphone: text(body.microphone, 'micrófono'),
        minGain: number(body.minGain, 'Límite mínimo'),
        maxGain: number(body.maxGain, 'Límite máximo'),
      };
      if (assignment.minGain < -6 || assignment.maxGain > 57 || assignment.minGain > assignment.maxGain) {
        throw new AppError('Los límites deben estar entre -6 y 57 dB y el mínimo debe ser menor o igual al máximo.');
      }
      const name = assignment.actor.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      if (show.channels.some((item) => item.channel !== assignment.channel &&
        item.actor.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() === name)) {
        throw new AppError('Ese actor ya está asignado a otro canal. Usa nombres distintos para las órdenes de voz.');
      }
      show.channels = show.channels.filter((item) => item.channel !== assignment.channel);
      show.channels.push(assignment);
      show.channels.sort((a, b) => a.channel - b.channel);
      invalidate(showId, state);
      await this.repository.save(state);
      return assignment;
    });
  }

  deleteChannel(showId: string, channel: number): Promise<void> {
    return this.run(async (state) => {
      const show = findShow(state, showId);
      if (show.scenes.some((scene) => scene.gains.some((gain) => gain.channel === channel))) {
        throw new AppError('Retira primero este canal de las escenas que lo utilizan.');
      }
      show.channels = show.channels.filter((item) => item.channel !== channel);
      invalidate(showId, state);
      await this.repository.save(state);
    });
  }

  saveScene(showId: string, id: string | undefined, body: Record<string, unknown>): Promise<Scene> {
    return this.run(async (state) => {
      const show = findShow(state, showId);
      if (!Array.isArray(body.gains) || !body.gains.length || body.gains.length > 20) {
        throw new AppError('Incluye entre 1 y 20 canales en la escena.');
      }
      const gains = body.gains.map((raw) => {
        if (!raw || typeof raw !== 'object') throw new AppError('Ajuste de escena inválido.');
        const gain = { channel: channelNumber(raw.channel), value: number(raw.value, 'Ganancia') };
        validateGain(show, gain.channel, gain.value);
        return gain;
      });
      if (new Set(gains.map((gain) => gain.channel)).size !== gains.length) throw new AppError('Hay canales repetidos en la escena.');
      const scene: Scene = {
        id: id ?? randomUUID(), name: text(body.name, 'nombre de la escena'),
        notes: text(body.notes, 'notas', true), gains,
      };
      const index = show.scenes.findIndex((item) => item.id === id);
      if (id && index < 0) throw new AppError('La escena ya no existe.', 404);
      if (id) show.scenes[index] = scene;
      else show.scenes.push(scene);
      invalidate(showId, state);
      await this.repository.save(state);
      return scene;
    });
  }

  deleteScene(showId: string, sceneId: string): Promise<void> {
    return this.run(async (state) => {
      const show = findShow(state, showId);
      show.scenes = show.scenes.filter((scene) => scene.id !== sceneId);
      if (show.activeSceneId === sceneId) delete show.activeSceneId;
      invalidate(showId, state);
      await this.repository.save(state);
    });
  }

  async readChannels(showId: string): Promise<{ channel: number; value?: number; error?: string }[]> {
    return this.run(async (state) => {
      const show = findShow(state, showId);
      return Promise.all(show.channels.map(async ({ channel }) => {
        try { return { channel, value: await this.mixer.read(channel) }; }
        catch (error) { return { channel, error: (error as Error).message }; }
      }));
    });
  }

  private async propose(state: Workspace, show: Show, details: Pick<Proposal, 'label' | 'source' | 'sceneId' | 'undoOf'>,
    targets: { channel: number; value?: number; delta?: number; expected?: number }[]): Promise<Proposal> {
    const changes: GainChange[] = [];
    for (const target of targets) {
      const before = await this.mixer.read(target.channel);
      if (target.expected !== undefined && Math.abs(before - target.expected) > CLOSE_ENOUGH_DB) {
        throw new AppError('El canal ' + target.channel + ' cambió desde la operación original. Revisa la consola antes de deshacer.', 409);
      }
      const after = Number((target.delta === undefined ? target.value! : before + target.delta).toFixed(1));
      validateGain(show, target.channel, after);
      changes.push({ channel: target.channel, before, after, ...(target.delta === undefined ? {} : { delta: target.delta }) });
    }
    const sceneProposals = details.source === 'scene'
      ? state.proposals.filter((item) => item.showId === show.id && item.source === 'scene' &&
        item.sceneId === details.sceneId && item.status === 'pending')
      : [];
    const pending = sceneProposals.find((item) => item.session === this.session &&
      item.mode === this.mixer.mode && Date.parse(item.expiresAt) > Date.now());
    const now = new Date().toISOString();
    const proposal: Proposal = {
      ...details, id: pending?.id ?? randomUUID(), showId: show.id, changes, status: 'pending', applied: [],
      createdAt: pending?.createdAt ?? now, updatedAt: now, reviewVersion: pending ? (pending.reviewVersion ?? 1) + 1 : 1,
      expiresAt: new Date(Date.now() + PROPOSAL_LIFETIME_MS).toISOString(),
      session: this.session, mode: this.mixer.mode,
    };
    for (const previous of sceneProposals) {
      if (previous !== pending) {
        previous.status = 'expired';
        previous.message = 'La propuesta caducó. Se creó una revisión nueva.';
      }
    }
    if (pending) Object.assign(pending, proposal);
    else state.proposals.push(proposal);
    await this.repository.save(state);
    return proposal;
  }

  proposeCommand(showId: string, raw: unknown): Promise<Proposal> {
    return this.run(async (state) => {
      const show = findShow(state, showId);
      const phrase = text(raw, 'comando');
      const command = parseCommand(phrase, {
        defaultChannel: DEFAULT_CHANNEL,
        aliases: show.channels.map(({ actor, channel }) => ({ name: actor, channel })),
      });
      if (!command) throw new AppError('No pude interpretar el ajuste. Prueba «sube un poco la ganancia de Ana» o «pon el canal 2 en 5 dB».');
      const target = command.action === 'SET_GAIN'
        ? { channel: command.channel, value: command.value }
        : { channel: command.channel, delta: command.delta };
      if (!show.channels.some((item) => item.channel === command.channel)) {
        throw new AppError('Registra el canal ' + command.channel + ' en el mapa de la obra.');
      }
      if (command.action === 'SET_GAIN') validateGain(show, command.channel, command.value);
      return this.propose(state, show, { label: phrase, source: 'command' }, [target]);
    });
  }

  proposeScene(showId: string, sceneId: string): Promise<Proposal> {
    return this.run(async (state) => {
      const show = findShow(state, showId);
      const scene = show.scenes.find((item) => item.id === sceneId);
      if (!scene) throw new AppError('La escena ya no existe.', 404);
      return this.propose(state, show, { label: scene.name, source: 'scene', sceneId }, scene.gains);
    });
  }

  proposeUndo(id: string): Promise<Proposal> {
    return this.run(async (state) => {
      const original = findProposal(state, id);
      if (!original.applied.length || original.undoneBy || original.source === 'undo' || original.mode !== this.mixer.mode) {
        throw new AppError('Esta operación no se puede deshacer.');
      }
      if (state.proposals.some((item) => item.undoOf === id && item.status === 'pending' && Date.parse(item.expiresAt) > Date.now() && item.session === this.session)) {
        throw new AppError('Ya existe una propuesta para deshacer esta operación.');
      }
      return this.propose(state, findShow(state, original.showId),
        { label: 'Deshacer · ' + original.label, source: 'undo', undoOf: id },
        original.applied.map((change) => ({ channel: change.channel, value: change.before, expected: change.after })));
    });
  }

  reject(id: string): Promise<Proposal> {
    return this.run(async (state) => {
      const proposal = findProposal(state, id);
      if (proposal.status !== 'pending') throw new AppError('La propuesta ya fue resuelta.', 409);
      proposal.status = 'rejected';
      proposal.decidedAt = new Date().toISOString();
      await this.repository.save(state);
      return proposal;
    });
  }

  confirm(id: string, reviewVersion: unknown = 1): Promise<Proposal> {
    return this.run(async (state) => {
      const proposal = findProposal(state, id);
      if (proposal.status === 'applied') return proposal; // Reintento HTTP idempotente.
      if (proposal.status !== 'pending') throw new AppError('La propuesta ya fue resuelta.', 409);
      // Otra pestaña puede estar mostrando la versión anterior del mismo cuadro.
      if (reviewVersion !== (proposal.reviewVersion ?? 1)) {
        throw new AppError('La propuesta se actualizó. Revisa los valores nuevos antes de confirmar.', 409);
      }
      if (proposal.session !== this.session || proposal.mode !== this.mixer.mode || Date.parse(proposal.expiresAt) <= Date.now()) {
        proposal.status = 'expired';
        proposal.message = 'La propuesta caducó. Vuelve a consultar la consola.';
        await this.repository.save(state);
        throw new AppError(proposal.message, 409);
      }
      const show = findShow(state, proposal.showId);
      try {
        // Se validan todos los canales antes del primer envío.
        for (const change of proposal.changes) {
          validateGain(show, change.channel, change.after);
          const current = await this.mixer.read(change.channel);
          if (Math.abs(current - change.before) > CLOSE_ENOUGH_DB) {
            throw new AppError('Cambió la ganancia del canal ' + change.channel + '. Genera una propuesta nueva.', 409);
          }
        }
      } catch (error) {
        proposal.status = 'stale';
        proposal.message = (error as Error).message;
        await this.repository.save(state);
        throw error;
      }

      // Se persiste la decisión antes del hardware. Un reinicio o reintento
      // nunca vuelve a enviar automáticamente una operación en curso.
      proposal.status = 'applying';
      proposal.decidedAt = new Date().toISOString();
      await this.repository.save(state);
      try {
        for (const change of proposal.changes) {
          await this.mixer.write(change.channel, change.after, change.before);
          proposal.applied.push(change);
          await this.repository.save(state);
        }
        proposal.status = 'applied';
        proposal.message = this.mixer.mode === 'demo' ? 'Aplicado en demostración.' : 'Cambio confirmado por la consola.';
        if (proposal.sceneId) show.activeSceneId = proposal.sceneId;
        if (proposal.undoOf) {
          const original = findProposal(state, proposal.undoOf);
          original.undoneBy = proposal.id;
          if (original.sceneId === show.activeSceneId) delete show.activeSceneId;
        }
      } catch (error) {
        proposal.status = proposal.applied.length ? 'partial' : 'failed';
        proposal.message = (error as Error).message + ' Revisa la consola antes de reintentar.';
      }
      await this.repository.save(state);
      return proposal;
    });
  }
}
