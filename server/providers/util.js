const crypto = require('crypto');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Deterministic PRNG seeded from a string (demo mode only).
function seededRandom(seed) {
  let h = crypto.createHash('sha256').update(String(seed)).digest().readUInt32LE(0) || 1;
  return () => {
    h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
}

class ProviderQuotaError extends Error {
  constructor(provider, message) { super(message || `${provider} quota exhausted`); this.provider = provider; this.quota = true; }
}

module.exports = { sleep, seededRandom, ProviderQuotaError };
