export function createInspectorRunGate() {
  let generation = 0;
  return {
    begin() {
      generation += 1;
      return generation;
    },
    isCurrent(token: number) {
      return token === generation;
    },
    cancel() {
      generation += 1;
    },
  };
}
