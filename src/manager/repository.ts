import { promises as fs, unlinkSync } from 'fs';
import { dirname, resolve } from 'path';
import { randomUUID } from 'crypto';
import type { Workspace } from './types';
import { AppError } from './types';

const empty = (): Workspace => ({ revision: 0, shows: [], proposals: [] });

export interface Repository {
  readonly kind: 'local' | 'supabase';
  load(): Promise<Workspace>;
  save(state: Workspace): Promise<void>;
}

export async function createRepository(mode: 'live' | 'demo'): Promise<Repository> {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (mode === 'live' && (url || secret)) {
    if (!url || !secret) throw new Error('Configura SUPABASE_URL y SUPABASE_SECRET_KEY juntos.');
    return new SupabaseRepository(url, secret, process.env.WORKSPACE_ID || 'itaca');
  }
  const path = resolve(process.env.DATA_DIR || resolve(__dirname, '../../.data'), mode + '.json');
  await fs.mkdir(dirname(path), { recursive: true });

  // Un proceso por archivo. Evita que dos servidores sobrescriban el mismo historial.
  const lock = path + '.lock';
  try {
    const pid = Number(await fs.readFile(lock, 'utf8'));
    let alive = true;
    try { process.kill(pid, 0); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
    }
    if (alive) throw new Error('Ya hay un servidor usando este archivo de datos.');
    await fs.unlink(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await fs.writeFile(lock, String(process.pid), { flag: 'wx' });
  process.once('exit', () => { try { unlinkSync(lock); } catch {} });
  return new LocalRepository(path);
}

class LocalRepository implements Repository {
  readonly kind = 'local' as const;
  constructor(private readonly path: string) {}

  async load(): Promise<Workspace> {
    try {
      return JSON.parse(await fs.readFile(this.path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty();
      throw error;
    }
  }

  async save(state: Workspace): Promise<void> {
    const temporary = this.path + '.' + randomUUID() + '.tmp';
    const next = { ...state, revision: state.revision + 1 };
    try {
      await fs.writeFile(temporary, JSON.stringify(next, null, 2), { flag: 'wx' });
      await fs.rename(temporary, this.path);
      state.revision = next.revision;
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
}

export class SupabaseRepository implements Repository {
  readonly kind = 'supabase' as const;
  private readonly endpoint: string;

  constructor(url: string, private readonly secret: string, private readonly id: string) {
    this.endpoint = new URL('/rest/v1/sound_workspaces', url).toString();
  }

  private async request(query: string, init: RequestInit = {}): Promise<any[]> {
    const response = await fetch(this.endpoint + query, {
      ...init,
      headers: {
        apikey: this.secret,
        // Las claves secretas nuevas se usan en apikey. Las JWT heredadas
        // también requieren Authorization para PostgREST.
        ...(this.secret.startsWith('eyJ') ? { Authorization: 'Bearer ' + this.secret } : {}),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new AppError('No se pudo acceder a Supabase. Comprueba la configuración y el esquema SQL.', 503);
    return response.json();
  }

  async load(): Promise<Workspace> {
    const rows = await this.request('?id=eq.' + encodeURIComponent(this.id) + '&select=revision,state');
    return rows.length ? { ...rows[0].state, revision: rows[0].revision } : empty();
  }

  async save(state: Workspace): Promise<void> {
    const next = state.revision + 1;
    const body = JSON.stringify({
      id: this.id, revision: next, state: { shows: state.shows, proposals: state.proposals },
      updated_at: new Date().toISOString(),
    });
    const query = state.revision === 0 ? '' : '?id=eq.' + encodeURIComponent(this.id) + '&revision=eq.' + state.revision;
    const rows = await this.request(query, { method: state.revision === 0 ? 'POST' : 'PATCH', body });
    if (!rows.length) throw new AppError('Otro servidor actualizó los datos. Actualiza la página antes de continuar.', 409);
    state.revision = next;
  }
}
