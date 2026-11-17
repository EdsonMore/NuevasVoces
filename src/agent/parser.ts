export interface SetGainCommand {
  action: 'SET_GAIN';
  channel: number;
  value: number;
}

export interface AdjustGainByNameCommand {
  action: 'ADJUST_GAIN_BY_NAME';
  personName: string;
  direction: 'up' | 'down';
}

export interface LoadSceneCommand {
  action: 'LOAD_SCENE';
  sceneId: number;
}

export interface SaveSceneCommand {
  action: 'SAVE_SCENE';
  sceneId: number;
}

export interface SetMuteCommand {
  action: 'SET_MUTE';
  channel: number;
  value: boolean;
}

export interface SetMuteByNameCommand {
  action: 'SET_MUTE_BY_NAME';
  personName: string;
  value: boolean;
}

export interface SetMasterCommand {
  action: 'SET_MASTER';
  value: number;
}

export type EqBandName = 'low' | 'mid' | 'high';

export interface EqCommand {
  action: 'EQ_BOOST' | 'EQ_CUT';
  personName: string;
  band: EqBandName;
  value: number;
}

export type Command =
  | SetGainCommand
  | AdjustGainByNameCommand
  | LoadSceneCommand
  | SaveSceneCommand
  | SetMuteCommand
  | SetMuteByNameCommand
  | SetMasterCommand
  | EqCommand;

// ponytail: paso fijo de ±3 dB para EQ por voz; añadir cantidad explícita si el técnico la pide.
const EQ_STEP_DB = 3;
const BAND_BY_WORD: Record<string, EqBandName> = {
  cuerpo: 'low', graves: 'low', bajos: 'low', medios: 'mid', agudos: 'high', brillo: 'high',
};

type Matcher = (match: RegExpMatchArray) => Command;

// Patrones: "sube/baja el canal N a X dB", "pon el canal N en X[ dB]",
// "carga la escena N", "guarda esto como la escena N", "sube/baja la voz de <nombre>"
const PATTERNS: [RegExp, Matcher][] = [
  [
    /\b(?:sube|baja)\s+el\s+canal\s+(\d+)\s+a\s+(-?\d+(?:[.,]\d+)?)\s*(?:db)?\b/i,
    (m) => ({ action: 'SET_GAIN', channel: parseInt(m[1], 10), value: parseFloat(m[2].replace(',', '.')) }),
  ],
  [
    /\bpon\s+el\s+canal\s+(\d+)\s+en\s+(-?\d+(?:[.,]\d+)?)\s*(?:db)?\b/i,
    (m) => ({ action: 'SET_GAIN', channel: parseInt(m[1], 10), value: parseFloat(m[2].replace(',', '.')) }),
  ],
  [
    /\bcarga\s+la\s+escena\s+(\d+)\b/i,
    (m) => ({ action: 'LOAD_SCENE', sceneId: parseInt(m[1], 10) }),
  ],
  [
    /\bguarda\s+(?:esto\s+)?como\s+(?:la\s+)?escena\s+(\d+)\b/i,
    (m) => ({ action: 'SAVE_SCENE', sceneId: parseInt(m[1], 10) }),
  ],
  [
    /\b(sube|baja)\s+la\s+voz\s+de\s+(\w+)\b/i,
    (m) => ({ action: 'ADJUST_GAIN_BY_NAME', direction: m[1].toLowerCase() === 'sube' ? 'up' : 'down', personName: m[2] }),
  ],
  [
    /\b(mutea|desmutea)\s+el\s+canal\s+(\d+)\b/i,
    (m) => ({ action: 'SET_MUTE', channel: parseInt(m[2], 10), value: m[1].toLowerCase() === 'mutea' }),
  ],
  [
    /\b(mutea|silencia|desmutea)\s+a\s+(\w+)\b/i,
    (m) => ({ action: 'SET_MUTE_BY_NAME', personName: m[2], value: m[1].toLowerCase() !== 'desmutea' }),
  ],
  [
    /\b(?:sube|baja)\s+el\s+master\s+a\s+(-?\d+(?:[.,]\d+)?)\s*(?:db)?\b/i,
    (m) => ({ action: 'SET_MASTER', value: parseFloat(m[1].replace(',', '.')) }),
  ],
  [
    /\b(?:dale\s+m[aá]s|sube(?:le)?(?:\s+(?:los|el))?)\s+(cuerpo|graves|bajos|medios|agudos|brillo)\s+a\s+(\w+)\b/i,
    (m) => ({ action: 'EQ_BOOST', personName: m[2], band: BAND_BY_WORD[m[1]], value: EQ_STEP_DB }),
  ],
  [
    /\b(?:quita(?:le)?|baja(?:le)?)(?:\s+(?:los|el))?\s+(cuerpo|graves|bajos|medios|agudos|brillo)\s+a\s+(\w+)\b/i,
    (m) => ({ action: 'EQ_CUT', personName: m[2], band: BAND_BY_WORD[m[1]], value: -EQ_STEP_DB }),
  ],
];

export function parseCommand(text: string): Command | null {
  const normalized = text.trim().toLowerCase();
  for (const [pattern, toCommand] of PATTERNS) {
    const match = normalized.match(pattern);
    if (match) return toCommand(match);
  }
  return null;
}
