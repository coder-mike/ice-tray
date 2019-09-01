export function assertUnreachable(value: never): never {
  throw new Error('Did not expect to get here');
}

export function unexpected(): never {
  throw new Error('Did not expect to get here');
}
