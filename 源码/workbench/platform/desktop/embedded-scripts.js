'use strict';

// These are synchronous, owned presentation libraries. Preserve global lexical
// scope and exceptions, but do not send their function-bearing completion values
// back across Electron IPC. Do not use for requests that need a return value.
function sideEffectScript(source) {
  if (typeof source !== 'string') throw new TypeError('Presentation source must be text');
  return source + '\n;void 0;\n';
}

module.exports = { sideEffectScript };
