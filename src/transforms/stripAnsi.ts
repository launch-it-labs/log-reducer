import { Transform } from '../types';

// Matches ANSI escape sequences: CSI sequences, OSC sequences, and simple escapes
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><~]/g;

// Carriage return (often paired with \n in Windows logs, or used for progress bars)
const CR_REGEX = /\r(?!\n)/g;

// Other control characters (except \n and \t which are meaningful)
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

export const stripAnsi: Transform = {
  name: 'Strip ANSI',
  settingKey: 'stripAnsi',
  apply(input: string): string {
    return input
      .replace(ANSI_REGEX, '')
      .replace(CR_REGEX, '')
      .replace(CONTROL_CHARS_REGEX, '');
  },
};
