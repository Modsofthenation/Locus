/** Serializes observation/input and fences work queued before a human handoff. */
export class ComputerControlChanged extends Error {}

export class ComputerControl {
  private states = new Map<
    string,
    { generation: number; tail: Promise<unknown>; failures: number; observe: boolean }
  >();

  private state(id: string) {
    let state = this.states.get(id);
    if (!state) {
      state = { generation: 0, tail: Promise.resolve(), failures: 0, observe: false };
      this.states.set(id, state);
    }
    return state;
  }

  run<T>(id: string, work: () => Promise<T>): Promise<T> {
    const state = this.state(id);
    const generation = state.generation;
    const next = state.tail
      .catch(() => undefined)
      .then(() => {
        if (generation !== state.generation)
          throw new ComputerControlChanged(
            "Computer control changed. Observe again after handback before acting.",
          );
        return work();
      });
    state.tail = next.catch(() => undefined);
    return next;
  }

  handoff<T>(id: string, work: () => Promise<T>): Promise<T> {
    const state = this.state(id);
    state.generation++;
    state.failures = 0;
    state.observe = true;
    return this.run(id, work);
  }

  failed(id: string, ok: boolean): number {
    const state = this.state(id);
    state.failures = ok ? 0 : state.failures + 1;
    return state.failures;
  }
  stalled(id: string): boolean {
    return this.state(id).failures >= 3;
  }
  needsObservation(id: string): boolean {
    return this.state(id).observe;
  }
  observed(id: string): void {
    this.state(id).observe = false;
  }
}
