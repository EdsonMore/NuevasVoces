export interface SetGainCommand {
  action: 'SET_GAIN';
  channel: number;
  value: number;
}

// Patrones MVP: "sube/baja el canal N a X dB", "pon el canal N en X[ dB]"
const PATTERNS: RegExp[] = [
  /\b(?:sube|baja)\s+el\s+canal\s+(\d+)\s+a\s+(-?\d+(?:[.,]\d+)?)\s*(?:db)?\b/i,
  /\bpon\s+el\s+canal\s+(\d+)\s+en\s+(-?\d+(?:[.,]\d+)?)\s*(?:db)?\b/i,
];

export function parseCommand(text: string): SetGainCommand | null {
  const normalized = text.trim().toLowerCase();
  for (const pattern of PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      const channel = parseInt(match[1], 10);
      const value = parseFloat(match[2].replace(',', '.'));
      return { action: 'SET_GAIN', channel, value };
    }
  }
  return null;
}
