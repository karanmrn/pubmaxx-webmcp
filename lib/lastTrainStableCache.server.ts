import "server-only";

type StableCacheEntry<T> = {
  expiresAt: number;
  promise: Promise<T>;
};

const caches = new Map<string, Map<string, StableCacheEntry<unknown>>>();
const MAX_ENTRIES_PER_NAMESPACE = 256;

export function cachedLastTrainValue<T>(
  namespace: string,
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  keep: (value: T) => boolean,
): Promise<T> {
  let cache = caches.get(namespace);
  if (!cache) {
    cache = new Map();
    caches.set(namespace, cache);
  }

  const now = Date.now();
  const cached = cache.get(key) as StableCacheEntry<T> | undefined;
  if (cached && cached.expiresAt > now) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.promise;
  }
  if (cached) cache.delete(key);

  const promise = load()
    .then((value) => {
      if (!keep(value)) cache?.delete(key);
      return value;
    })
    .catch((error: unknown) => {
      cache?.delete(key);
      throw error;
    });
  cache.set(key, { expiresAt: now + ttlMs, promise });
  while (cache.size > MAX_ENTRIES_PER_NAMESPACE) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
  return promise;
}

export function __resetLastTrainStableCache(): void {
  caches.clear();
}
