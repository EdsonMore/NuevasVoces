import { DEFAULT_CHANNEL } from '../config';

export interface SetGainCommand {
  action: 'SET_GAIN';
  channel: number;
  value: number;
}

export interface AdjustGainCommand {
  action: 'ADJUST_GAIN';
  channel: number;
  delta: number;
}

type GainValue =
  | Omit<SetGainCommand, 'channel'>
  | Omit<AdjustGainCommand, 'channel'>;

export type GainCommand = SetGainCommand | AdjustGainCommand;

export interface ParseContext {
  defaultChannel?: number;
  aliases?: { name: string; channel: number }[];
}

type Verb = 'set' | 'increase' | 'decrease' | 'give';

const VERBS = new Map<string, Verb>([
  ['ajusta', 'set'], ['ajustale', 'set'], ['ajustar', 'set'],
  ['pon', 'set'], ['ponle', 'set'], ['poner', 'set'],
  ['deja', 'set'], ['dejale', 'set'], ['dejar', 'set'],
  ['fija', 'set'], ['fijale', 'set'], ['fijar', 'set'],
  ['sube', 'increase'], ['subele', 'increase'], ['subir', 'increase'],
  ['aumenta', 'increase'], ['aumentale', 'increase'], ['aumentar', 'increase'],
  ['incrementa', 'increase'], ['incrementar', 'increase'],
  ['eleva', 'increase'], ['elevar', 'increase'],
  ['baja', 'decrease'], ['bajale', 'decrease'], ['bajar', 'decrease'],
  ['reduce', 'decrease'], ['reducelo', 'decrease'], ['reducir', 'decrease'],
  ['disminuye', 'decrease'], ['disminuir', 'decrease'],
  ['quita', 'decrease'], ['quitar', 'decrease'],
  ['da', 'give'], ['dale', 'give'], ['dar', 'give'], ['darle', 'give'],
]);

const ORDINALS = new Map<string, number>([
  ['primer', 1], ['primero', 1], ['segundo', 2], ['tercer', 3], ['tercero', 3],
  ['cuarto', 4], ['quinto', 5], ['sexto', 6], ['septimo', 7], ['octavo', 8],
  ['noveno', 9], ['decimo', 10], ['undecimo', 11], ['decimoprimero', 11],
  ['duodecimo', 12], ['decimosegundo', 12], ['decimotercero', 13],
  ['decimocuarto', 14], ['decimoquinto', 15], ['decimosexto', 16],
  ['decimoseptimo', 17], ['decimoctavo', 18], ['decimonoveno', 19], ['vigesimo', 20],
]);

const UNITS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
const CARDINALS = new Map<string, number>([
  ...UNITS.map((word, value): [string, number] => [word, value]),
  ...[
    'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciseis', 'diecisiete',
    'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidos', 'veintitres',
    'veinticuatro', 'veinticinco', 'veintiseis', 'veintisiete', 'veintiocho', 'veintinueve',
  ].map((word, index): [string, number] => [word, index + 10]),
  ['un', 1],
]);

for (const [index, tens] of ['treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'].entries()) {
  const base = (index + 3) * 10;
  CARDINALS.set(tens, base);
  for (const [unit, word] of UNITS.entries()) {
    if (unit > 0) CARDINALS.set(tens + ' y ' + word, base + unit);
  }
}

// Las expresiones cualitativas tienen una magnitud explícita, en dB.
const RELATIVE_AMOUNTS = new Map<string, number>([
  ['un poco', 1], ['un poquito', 1], ['ligeramente', 1],
]);
const DIRECTIONS = new Map<string, number>([['mas', 1], ['menos', -1]]);

const ordinalWords = [...ORDINALS.keys()].sort((a, b) => b.length - a.length).join('|');
const channelNumbers = [...CARDINALS.keys()].sort((a, b) => b.length - a.length).join('|');
const CHANNEL_PATTERN =
  '(?:^|\\s)(?:(?:para el|a el|en el|el|al|del|de|a|en)\\s+)?' +
  '(?:canal\\s+(?:numero\\s+)?(\\d+(?:[oa])?|' + ordinalWords + '|' + channelNumbers + ')|' +
  '(' + ordinalWords + ')\\s+canal)(?=\\s|$)';

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/\.?[º°]/g, 'o').replace(/\.?ª/g, 'a').replace(/−/g, '-')
    .replace(/^[\s¿¡]+|[\s.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^por favor(?: *,)? |(?: *,)? por favor$/g, '')
    .replace(/^(?:puedes|podrias) /, '');
}

function parseDb(text: string): number | null {
  const amount = text.replace(/\s*(?:d\s?b|decibel(?:es|ios?)?)$/, '')
    .replace(/^menos /, '-').replace(/^mas /, '+');

  if (/^[+-]?\d+(?:[.,]\d+)?$/.test(amount)) {
    const value = Number(amount.replace(',', '.'));
    return Number.isFinite(value) ? value : null;
  }

  const unsigned = amount.replace(/^[+-]/, '');
  const sign = amount.startsWith('-') ? -1 : 1;
  const [whole, fraction, extra] = unsigned.split(/ (?:coma|punto) /);
  const integer = /^\d+$/.test(whole) ? Number(whole) : CARDINALS.get(whole);
  if (integer === undefined || !Number.isFinite(integer) || extra !== undefined) return null;
  if (fraction === undefined) return sign * integer;

  const decimalDigits = /^\d+$/.test(fraction) ? fraction : CARDINALS.get(fraction);
  return decimalDigits === undefined ? null : sign * (integer + Number('0.' + decimalDigits));
}

function extractTarget(text: string, context: ParseContext): { channel: number; remainder: string } | null {
  const matches = (context.aliases ?? []).filter(({ name }) => {
    const alias = normalize(name);
    return alias && (' ' + text + ' ').includes(' ' + alias + ' ');
  });
  if (matches.length > 1) return null;
  if (matches.length === 1) {
    const alias = normalize(matches[0].name);
    const escaped = alias.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');
    text = text.replace(new RegExp('(?:^|\\s)(?:(?:a|de|para)\\s+)?' + escaped + '(?=\\s|$)'), ' canal ' + matches[0].channel);
  }
  const targets = [...text.matchAll(new RegExp(CHANNEL_PATTERN, 'g'))];
  if (targets.length > 1) return null;
  const target = targets[0];
  if (!target) return { channel: context.defaultChannel ?? DEFAULT_CHANNEL, remainder: text };

  const token = target[1] ?? target[2];
  const channel = ORDINALS.get(token) ?? CARDINALS.get(token) ?? Number(token.replace(/[oa]$/, ''));
  if (!Number.isSafeInteger(channel) || channel < 1) return null;

  const start = target.index!;
  const remainder = (text.slice(0, start) + ' ' + text.slice(start + target[0].length)).replace(/\s+/g, ' ').trim();
  return { channel, remainder };
}

function extractValue(text: string, verb: Verb): GainValue | null {
  const verbDirection = verb === 'increase' ? 1 : verb === 'decrease' ? -1 : undefined;
  const absolute = text.match(/^(?:a|en) (.+)$/);
  if (absolute && (text.startsWith('a ') || verbDirection === undefined)) {
    const value = parseDb(absolute[1]);
    return value === null ? null : { action: 'SET_GAIN', value };
  }

  const amount = text.replace(/^en /, '');
  const suffix = amount.match(/^(.+) (mas|menos)$/);
  const prefix = verb === 'give' ? amount.match(/^(mas|menos) (.+)$/) : null;
  const directionWord = suffix?.[2] ?? prefix?.[1];
  const explicitDirection = directionWord ? DIRECTIONS.get(directionWord) : undefined;
  if (verbDirection !== undefined && explicitDirection !== undefined && verbDirection !== explicitDirection) return null;

  const direction = explicitDirection ?? verbDirection;
  if (direction !== undefined) {
    const quantity = suffix?.[1] ?? prefix?.[2] ?? amount;
    const magnitude = RELATIVE_AMOUNTS.get(quantity) ?? parseDb(quantity);
    return magnitude === null || magnitude < 0 ? null : { action: 'ADJUST_GAIN', delta: direction * magnitude };
  }

  const value = verb === 'set' ? parseDb(text) : null;
  return value === null ? null : { action: 'SET_GAIN', value };
}

export function parseCommand(text: string, context: ParseContext = {}): GainCommand | null {
  const command = normalize(text).match(/^(\w+) (.+)$/);
  if (!command) return null;
  const verb = VERBS.get(command[1]);
  if (!verb) return null;

  const target = extractTarget(command[2], context);
  if (!target) return null;

  // El valor debe consumir toda la frase restante. Así se rechazan objetivos
  // desconocidos, cantidades ambiguas e instrucciones adicionales.
  const amount = target.remainder.replace(/\b(?:(?:de )?(?:la )?)ganancia\b/, '').replace(/\s+/g, ' ').trim();
  const value = extractValue(amount, verb);
  return value && { ...value, channel: target.channel };
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

export type ExtraCommand =
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

type Matcher = (match: RegExpMatchArray) => ExtraCommand;

// Comandos fuera del flujo de propuestas de ganancia (esa la cubre parseCommand):
// "carga la escena N", "guarda esto como la escena N", "sube/baja la voz de <nombre>"
const PATTERNS: [RegExp, Matcher][] = [
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

export function parseExtraCommand(text: string): ExtraCommand | null {
  const normalized = text.trim().toLowerCase();
  for (const [pattern, toCommand] of PATTERNS) {
    const match = normalized.match(pattern);
    if (match) return toCommand(match);
  }
  return null;
}
