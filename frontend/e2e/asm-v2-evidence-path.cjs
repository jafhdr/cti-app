const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const worktree = fs.realpathSync(path.resolve(__dirname, '../..'));

function insideWorktree(candidate) {
  const relative = path.relative(worktree, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function resolvedTarget(directory) {
  let ancestor = directory;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error('Evidence directory has no existing ancestor');
    ancestor = parent;
  }
  return path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, directory));
}

function evidencePath(filename) {
  if (filename !== path.basename(filename) || !filename.endsWith('.png')) {
    throw new Error('Evidence filename must be a PNG basename');
  }
  const directory = path.resolve(process.env.SICTI_ASM_E2E_EVIDENCE_DIR || path.join(os.homedir(), '.sicti', 'asm-v2-e2e-evidence'));
  if (insideWorktree(resolvedTarget(directory))) throw new Error('Evidence directory must be outside the ASM worktree');
  fs.mkdirSync(directory, { recursive: true });
  if (insideWorktree(fs.realpathSync(directory))) throw new Error('Evidence directory must be outside the ASM worktree');
  return path.join(directory, filename);
}

module.exports = { evidencePath };
