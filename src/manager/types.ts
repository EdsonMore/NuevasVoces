export interface ChannelAssignment {
  channel: number;
  actor: string;
  microphone: string;
  minGain: number;
  maxGain: number;
}

export interface Scene {
  id: string;
  name: string;
  notes: string;
  gains: { channel: number; value: number }[];
}

export interface Show {
  id: string;
  name: string;
  channels: ChannelAssignment[];
  scenes: Scene[];
  activeSceneId?: string;
}

export interface GainChange {
  channel: number;
  before: number;
  after: number;
  delta?: number;
}

export interface Proposal {
  id: string;
  showId: string;
  label: string;
  source: 'command' | 'scene' | 'undo';
  sceneId?: string;
  undoOf?: string;
  changes: GainChange[];
  status: 'pending' | 'applying' | 'applied' | 'rejected' | 'stale' | 'expired' | 'failed' | 'partial' | 'superseded';
  createdAt: string;
  updatedAt?: string;
  reviewVersion?: number;
  expiresAt: string;
  session: string;
  mode: 'demo' | 'live';
  applied: GainChange[];
  message?: string;
  decidedAt?: string;
  undoneBy?: string;
}

export interface Workspace {
  revision: number;
  shows: Show[];
  proposals: Proposal[];
}

export interface MixerPort {
  mode: 'demo' | 'live';
  read(channel: number): Promise<number>;
  write(channel: number, value: number, expected: number): Promise<number>;
}

export class AppError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}
