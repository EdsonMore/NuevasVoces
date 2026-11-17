import assert from 'node:assert';
import { parseCommand } from './parser';

assert.deepStrictEqual(parseCommand('Mutea el canal 3'), { action: 'SET_MUTE', channel: 3, value: true });
assert.deepStrictEqual(parseCommand('Desmutea el canal 2'), { action: 'SET_MUTE', channel: 2, value: false });
assert.deepStrictEqual(parseCommand('Silencia a Mafer'), { action: 'SET_MUTE_BY_NAME', personName: 'mafer', value: true });
assert.deepStrictEqual(parseCommand('Desmutea a Gabs'), { action: 'SET_MUTE_BY_NAME', personName: 'gabs', value: false });
assert.deepStrictEqual(parseCommand('Sube el master a 0 dB'), { action: 'SET_MASTER', value: 0 });
assert.deepStrictEqual(parseCommand('Baja el master a -10'), { action: 'SET_MASTER', value: -10 });
assert.deepStrictEqual(parseCommand('sube la voz de Alvaro'), {
  action: 'ADJUST_GAIN_BY_NAME',
  direction: 'up',
  personName: 'alvaro',
});
assert.deepStrictEqual(parseCommand('Dale más cuerpo a Mafer'), { action: 'EQ_BOOST', personName: 'mafer', band: 'low', value: 3 });
assert.deepStrictEqual(parseCommand('Quita los agudos a Gabs'), { action: 'EQ_CUT', personName: 'gabs', band: 'high', value: -3 });
assert.deepStrictEqual(parseCommand('Sube los medios a Alvaro'), { action: 'EQ_BOOST', personName: 'alvaro', band: 'mid', value: 3 });
assert.deepStrictEqual(parseCommand('Baja los graves a Mafer'), { action: 'EQ_CUT', personName: 'mafer', band: 'low', value: -3 });

console.log('parser.test.ts OK');
