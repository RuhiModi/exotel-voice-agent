const memoryStore = new Map();

export function getMemory(callSid) {
  return memoryStore.get(callSid) || [];
}

export function saveMemory(callSid, role, content) {
  const history = memoryStore.get(callSid) || [];
  history.push({ role, content });
  memoryStore.set(callSid, history.slice(-6)); // last 6 turns only
}

