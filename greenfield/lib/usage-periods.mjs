// Calendar budgets use the operator's fixed business time zone, independently
// of the Chrome/OS zone. Compute each midnight separately across DST changes.
export const USAGE_TIME_ZONE = 'Europe/Helsinki';
const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone:USAGE_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
});
const parts = at => Object.fromEntries(formatter.formatToParts(at)
  .filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
const dateKey = ({year,month,day}) => `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
function shiftDate(date, days) {
  const d = new Date(Date.UTC(date.year,date.month-1,date.day+days));
  return {year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate()};
}
function midnight(date) {
  const wall = Date.UTC(date.year,date.month-1,date.day);
  let at = wall;
  for(let i=0;i<4;i++) {
    const p = parts(at);
    const difference = Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-wall;
    if(difference===0)return at;
    at-=difference;
  }
  throw new Error('USAGE_MIDNIGHT_UNRESOLVED');
}
let cached = null;
export function usagePeriods(now=Date.now()) {
  if(!Number.isFinite(now))throw new Error('USAGE_TIME_INVALID');
  const date = parts(now), dayKey = dateKey(date);
  if(cached?.dayKey===dayKey)return cached;
  const weekday = new Date(Date.UTC(date.year,date.month-1,date.day)).getUTCDay();
  const monday = shiftDate(date,-((weekday+6)%7));
  cached = Object.freeze({basis:'CALENDAR',timeZone:USAGE_TIME_ZONE,dayKey,weekKey:dateKey(monday),
    dayStartAtMs:midnight(date),nextDayAtMs:midnight(shiftDate(date,1)),
    weekStartAtMs:midnight(monday),nextWeekAtMs:midnight(shiftDate(monday,7))});
  return cached;
}
