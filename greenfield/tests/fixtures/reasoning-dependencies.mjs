import {refreshModelEvidence} from '../../lib/model-evidence-refresh.mjs';
import {APP_VERSION} from '../../lib/contracts.mjs';
import {readFileSync} from 'node:fs';
import {normalizeReasoningLevel, reasoningAuthorizationMatches} from '../../lib/reasoning-level.mjs';

const source = readFileSync(new URL('../../background.js', import.meta.url), 'utf8');
const tail = source.slice(source.indexOf('async function reasoningPolicyForProcess('));
const resolver = tail.slice(0, /^}\s*$/m.exec(tail).index + 1);

// Older focused tests model only one legacy queue snapshot. Supply that
// snapshot as storage input to the real resolver, not a mocked policy verdict.
// Tests with a storage loader retain it; queue-reasoning.test exercises the
// production persistence, edit races and final send checks end to end.
export function withReasoningDependencies(deps) {
  deps.refreshModelEvidence ??= refreshModelEvidence;
  deps.APP_VERSION ??= APP_VERSION;
  deps.refreshSendModelEvidence ??= async (...args) => {
    const tail=source.slice(source.indexOf('async function refreshSendModelEvidence('));
    const body=tail.slice(0, /^}\s*$/m.exec(tail).index+1);
    return Function(...Object.keys(deps),body+';return refreshSendModelEvidence;')(...Object.values(deps))(...args);
  };
  deps.normalizeReasoningLevel ??= normalizeReasoningLevel;
  deps.reasoningAuthorizationMatches ??= reasoningAuthorizationMatches;
  deps.reasoningPolicyForProcess ??= async (process, policy) => {
    const loadMissionWorkQueue = deps.loadMissionWorkQueue ?? (async () => ({
      queueId:process?.queueContext?.queueId,
      items:[{itemId:process?.queueContext?.itemId, reasoningLevel:process?.queueContext?.reasoningLevel}]
    }));
    const chrome = deps.chrome?.storage?.local ? deps.chrome : {storage:{local:{}}};
    return Function('chrome','loadMissionWorkQueue','normalizeReasoningLevel',
      resolver + ';return reasoningPolicyForProcess')(chrome,loadMissionWorkQueue,normalizeReasoningLevel)(process,policy);
  };
  return deps;
}
