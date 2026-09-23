// Models the JSON/base::Value boundary that RC1's structuredClone mock missed.
export function chromeJsonCopy(value) {
  const order=v=>Array.isArray(v)?v.map(order):v!==null && typeof v==="object"
    ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,order(v[k])])) : v;
  return order(JSON.parse(JSON.stringify(value)));
}
export function chromeJsonStorage(seed={}) {
  const state=chromeJsonCopy(seed);
  return {state,async get(keys){
    const list=keys==null?Object.keys(state):typeof keys==="string"?[keys]:Array.isArray(keys)?keys:Object.keys(keys);
    return chromeJsonCopy(Object.fromEntries(list.filter(k=>Object.hasOwn(state,k)).map(k=>[k,state[k]])));
  },async set(rows){Object.assign(state,chromeJsonCopy(rows));},async remove(keys){for(const key of typeof keys==="string"?[keys]:keys)delete state[key];}};
}
