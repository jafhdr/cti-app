const { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync, lstatSync, unlinkSync, realpathSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const { randomUUID } = require('node:crypto');

const root = resolve(__dirname, '.qa-phase3c-state');
const target = value => typeof value === 'string' && value.length <= 253 && /^(?:[a-z0-9-]+\.)+[a-z0-9-]+\.test$/.test(value);
const key = (tenantId, domain) => JSON.stringify([tenantId, domain]);

function stateFile() {
  const name = process.env.SICTI_SOAR_MOCK_STATE_FILE;
  if (!name || !/^[a-z0-9_-]+\.json$/.test(name)) throw new Error('QA mock state filename required');
  mkdirSync(root, { recursive: true });
  if (realpathSync(root) !== root || dirname(resolve(root, name)) !== root) throw new Error('Mock state path denied');
  const file = resolve(root, name);
  if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error('Mock state symlink denied');
  return file;
}

function valid(data) {
  return data && data.version === 1 && Array.isArray(data.blocked) && data.blocked.every(row => typeof row === 'string')
    && data.requests && typeof data.requests === 'object' && !Array.isArray(data.requests)
    && data.nonces && typeof data.nonces === 'object' && !Array.isArray(data.nonces);
}

function createStore() {
  const file = stateFile();
  let state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, blocked: [], requests: {}, nonces: {} };
  if (!valid(state)) throw new Error('Invalid mock state file');
  const lock = `${file}.lock`;
  try {
    const fd = openSync(lock, 'wx', 0o600);
    writeFileSync(fd, String(process.pid)); closeSync(fd);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = Number(readFileSync(lock, 'utf8'));
    let live = false;
    if (Number.isInteger(owner) && owner > 0) { try { process.kill(owner, 0); live = true; } catch { /* stale owner */ } }
    if (live) throw new Error('Mock state already has a live writer');
    unlinkSync(lock);
    const fd = openSync(lock, 'wx', 0o600);
    writeFileSync(fd, String(process.pid)); closeSync(fd);
  }
  process.once('exit', () => { try { if (readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock); } catch { /* process shutdown */ } });

  function persist(next) {
    const data = JSON.stringify(next);
    if (Buffer.byteLength(data) > 4_000_000) throw new Error('Mock state capacity reached');
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, file);
    state = next;
  }

  return {
    recordNonce(nonce, timestamp) {
      if (Object.hasOwn(state.nonces, nonce)) return false;
      if (Object.keys(state.nonces).length >= 10_000) throw new Error('Mock nonce capacity reached');
      persist({ ...state, nonces: { ...state.nonces, [nonce]: timestamp } });
      return true;
    },
    action(requestId, tenantId, domain, operation) {
      if (!target(domain) || !['BLOCK_DOMAIN', 'UNBLOCK_DOMAIN'].includes(operation)) throw new Error('Mock action denied');
      const prior = state.requests[requestId];
      if (prior) {
        if (prior.tenantId !== tenantId || prior.target !== domain || prior.operation !== operation) throw new Error('Mock request ID conflict');
        return prior.blocked;
      }
      const entry = key(tenantId, domain);
      const blocked = new Set(state.blocked);
      if (operation === 'BLOCK_DOMAIN') blocked.add(entry); else blocked.delete(entry);
      const result = blocked.has(entry);
      persist({ ...state, blocked: [...blocked], requests: { ...state.requests, [requestId]: { tenantId, target: domain, operation, blocked: result } } });
      return result;
    },
    blocked(tenantId, domain) { return state.blocked.includes(key(tenantId, domain)); },
    snapshot() { return { blocked: [...state.blocked], requestCount: Object.keys(state.requests).length, nonceCount: Object.keys(state.nonces).length }; },
  };
}

module.exports = { createStore, stateFile };
