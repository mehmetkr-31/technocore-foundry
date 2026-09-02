export class StrictJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrictJsonError';
  }
}

function assertUnicode(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new StrictJsonError('Lone Unicode surrogate is forbidden.');
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new StrictJsonError('Lone Unicode surrogate is forbidden.');
    }
  }
}

function compareUnicode(left: string, right: string) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) as number);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) as number);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

export function assertStrictJsonValue(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    assertUnicode(value);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new StrictJsonError('Only safe JSON integers are permitted.');
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new StrictJsonError('Cyclic values are not JSON.');
    seen.add(value);
    value.forEach((item) => assertStrictJsonValue(item, seen));
    seen.delete(value);
    return;
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new StrictJsonError('Only plain JSON objects are permitted.');
    if (seen.has(value)) throw new StrictJsonError('Cyclic values are not JSON.');
    seen.add(value);
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      assertUnicode(key);
      assertStrictJsonValue(item, seen);
    }
    seen.delete(value);
    return;
  }
  throw new StrictJsonError(`Unsupported JSON value: ${typeof value}.`);
}

export function canonicalJson(value: unknown): string {
  assertStrictJsonValue(value);
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => compareUnicode(left, right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

class Parser {
  private index = 0;

  constructor(
    private readonly source: string,
    private readonly preserveUnsafeIntegers = false,
  ) {}

  parse() {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.source.length) throw this.error('Unexpected trailing input.');
    if (!this.preserveUnsafeIntegers) assertStrictJsonValue(value);
    return value;
  }

  private error(message: string) {
    return new StrictJsonError(`${message} At character ${this.index}.`);
  }

  private skipWhitespace() {
    while (/[\t\n\r ]/.test(this.source[this.index] ?? '')) this.index += 1;
  }

  private parseValue(): unknown {
    const character = this.source[this.index];
    if (character === '{') return this.parseObject();
    if (character === '[') return this.parseArray();
    if (character === '"') return this.parseString();
    if (character === 't') return this.parseLiteral('true', true);
    if (character === 'f') return this.parseLiteral('false', false);
    if (character === 'n') return this.parseLiteral('null', null);
    if (character === '-' || /[0-9]/.test(character ?? '')) return this.parseNumber();
    throw this.error('Expected a JSON value.');
  }

  private parseLiteral(token: string, value: unknown) {
    if (this.source.slice(this.index, this.index + token.length) !== token) throw this.error(`Expected ${token}.`);
    this.index += token.length;
    return value;
  }

  private parseString() {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (character === '"') {
        this.index += 1;
        try {
          const value = JSON.parse(this.source.slice(start, this.index)) as string;
          assertUnicode(value);
          return value;
        } catch (error) {
          if (error instanceof StrictJsonError) throw error;
          throw this.error('Malformed JSON string.');
        }
      }
      if (character === '\\') {
        this.index += 2;
      } else {
        this.index += 1;
      }
    }
    throw this.error('Unterminated JSON string.');
  }

  private parseNumber() {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.source.slice(this.index));
    if (!match) throw this.error('Malformed JSON number.');
    this.index += match[0].length;
    if (/[.eE]/.test(match[0])) throw this.error('Floats are forbidden.');
    const value = Number(match[0]);
    if (!Number.isSafeInteger(value)) {
      if (this.preserveUnsafeIntegers) return BigInt(match[0]);
      throw this.error('JSON integer exceeds the safe cross-language profile.');
    }
    return value;
  }

  private parseArray() {
    this.index += 1;
    this.skipWhitespace();
    const output: unknown[] = [];
    if (this.source[this.index] === ']') {
      this.index += 1;
      return output;
    }
    while (true) {
      this.skipWhitespace();
      output.push(this.parseValue());
      this.skipWhitespace();
      if (this.source[this.index] === ']') {
        this.index += 1;
        return output;
      }
      if (this.source[this.index] !== ',') throw this.error('Expected a comma or closing bracket.');
      this.index += 1;
    }
  }

  private parseObject() {
    this.index += 1;
    this.skipWhitespace();
    const entries: Array<[string, unknown]> = [];
    const keys = new Set<string>();
    if (this.source[this.index] === '}') {
      this.index += 1;
      return {};
    }
    while (true) {
      this.skipWhitespace();
      if (this.source[this.index] !== '"') throw this.error('Expected an object key.');
      const key = this.parseString();
      if (keys.has(key)) throw this.error(`Duplicate object key: ${key}.`);
      keys.add(key);
      this.skipWhitespace();
      if (this.source[this.index] !== ':') throw this.error('Expected a colon after the object key.');
      this.index += 1;
      this.skipWhitespace();
      entries.push([key, this.parseValue()]);
      this.skipWhitespace();
      if (this.source[this.index] === '}') {
        this.index += 1;
        return Object.fromEntries(entries);
      }
      if (this.source[this.index] !== ',') throw this.error('Expected a comma or closing brace.');
      this.index += 1;
    }
  }
}

export function parseStrictJson(source: string) {
  assertUnicode(source);
  return new Parser(source).parse();
}

export function decodeStrictUtf8(bytes: ArrayBuffer | Uint8Array) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new StrictJsonError('Input is not valid UTF-8.');
  }
}

export function parseStrictJsonBytes(bytes: ArrayBuffer | Uint8Array) {
  return parseStrictJson(decodeStrictUtf8(bytes));
}

// Transport acknowledgements can contain unrelated legacy 19-digit nonces. Preserve those as
// bigint while retaining fatal UTF-8, duplicate-key, Unicode, integer-only, and grammar checks.
// Callers must still require safe integers for every field they trust.
export function parseLosslessIntegerJsonBytes(bytes: ArrayBuffer | Uint8Array) {
  const source = decodeStrictUtf8(bytes);
  assertUnicode(source);
  return new Parser(source, true).parse();
}
