export interface BridgeRequest {
  id: string | null;
  command: string;
  args: unknown[];
  timeoutMs: number | undefined;
}

export type ErrorKind = 'unknown-command' | 'threw' | 'timeout' | 'bad-request';

export interface BridgeError {
  kind: ErrorKind;
  message: string;
}

export type BridgeResponse =
  | { id: string | null; ok: true; result: unknown; ms: number }
  | { id: string | null; ok: false; error: BridgeError };

export type ParseResult =
  | { ok: true; request: BridgeRequest }
  | { ok: false; id: string | null; message: string };

export function parseRequest(line: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { ok: false, id: null, message: 'line is not valid JSON' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, id: null, message: 'request must be a JSON object' };
  }
  const rawId: unknown = Reflect.get(value, 'id');
  if (rawId !== undefined && typeof rawId !== 'string') {
    return { ok: false, id: null, message: 'request.id must be a string' };
  }
  const id = typeof rawId === 'string' ? rawId : null;
  const command: unknown = Reflect.get(value, 'command');
  if (typeof command !== 'string' || command.length === 0) {
    return { ok: false, id, message: 'request.command must be a non-empty string' };
  }
  const args: unknown = Reflect.get(value, 'args');
  if (args !== undefined && !Array.isArray(args)) {
    return { ok: false, id, message: 'request.args must be an array' };
  }
  const timeoutMs: unknown = Reflect.get(value, 'timeoutMs');
  if (
    timeoutMs !== undefined &&
    (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
  ) {
    return { ok: false, id, message: 'request.timeoutMs must be a positive finite number' };
  }
  return {
    ok: true,
    request: {
      id,
      command,
      args: Array.isArray(args) ? args : [],
      timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : undefined,
    },
  };
}

// The `{"$uri": "..."}` marker is the only arg coercion; it must match exactly that shape.
export function rewriteUriMarkers(
  value: unknown,
  parseUri: (value: string) => unknown,
): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) {
    return value.map((item) => rewriteUriMarkers(item, parseUri));
  }
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === '$uri') {
    const marker: unknown = Reflect.get(value, '$uri');
    if (typeof marker === 'string') return parseUri(marker);
  }
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    out[key] = rewriteUriMarkers(Reflect.get(value, key), parseUri);
  }
  return out;
}

// Results cross the socket as JSON; a value JSON.stringify rejects degrades to a marker.
export function safeSerialize(result: unknown): unknown {
  try {
    JSON.stringify(result);
    return result;
  } catch {
    return { $nonSerializable: true, type: describeType(result) };
  }
}

function describeType(value: unknown): string {
  if (typeof value !== 'object' || value === null) return typeof value;
  const proto: unknown = Object.getPrototypeOf(value);
  if (typeof proto === 'object' && proto !== null && 'constructor' in proto) {
    const ctor: unknown = proto.constructor;
    if (typeof ctor === 'function' && ctor.name !== '') return ctor.name;
  }
  return 'object';
}
