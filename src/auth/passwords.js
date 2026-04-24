// Password hashing using Node's built-in crypto.scrypt — no external dependencies.
// Stored format: scrypt$<N>$<r>$<p>$<salt_base64>$<hash_base64>

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const N = 16384;      // CPU/memory cost
const r = 8;          // block size
const p = 1;          // parallelization
const SALT_BYTES = 16;
const HASH_BYTES = 32;

async function hashPassword(plain) {
  if (!plain || plain.length < 4) {
    throw new Error('Password must be at least 4 characters');
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = await scrypt(plain, salt, HASH_BYTES, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(plain, stored) {
  if (!plain || !stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const storedN = parseInt(parts[1], 10);
  const storedR = parseInt(parts[2], 10);
  const storedP = parseInt(parts[3], 10);
  const salt = Buffer.from(parts[4], 'base64');
  const expectedHash = Buffer.from(parts[5], 'base64');
  try {
    const actualHash = await scrypt(plain, salt, expectedHash.length, { N: storedN, r: storedR, p: storedP });
    return crypto.timingSafeEqual(actualHash, expectedHash);
  } catch {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
