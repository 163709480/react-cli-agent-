export { canonicalJson } from './canonical.js';
export { genesisHash, nextHash, verifyChain } from './hashChain.js';
export type { VerifyResult } from './hashChain.js';
export {
  NoopSink,
  InMemorySink,
  JsonlFileSink,
  agentEventToAuditFields,
  buildAuditEvent,
} from './sink.js';
export type { AuditEvent, AuditSink } from './sink.js';
