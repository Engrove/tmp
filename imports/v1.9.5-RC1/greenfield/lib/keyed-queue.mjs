export function createKeyedQueue() {
  const tails = new Map();

  function enqueue(key, task) {
    const prior = tails.get(key) || Promise.resolve();
    const next = prior.catch(() => undefined).then(task);
    tails.set(key, next);
    next.finally(() => {
      if (tails.get(key) === next) tails.delete(key);
    }).catch(() => undefined);
    return next;
  }

  return {
    enqueue,
    size: () => tails.size
  };
}
