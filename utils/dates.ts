export const todayISO = () => new Date().toISOString().slice(0,10);
export const toISO = (v?: string | number | Date | null) => {
  if(!v) return '';
  const d = new Date(v);
  return isNaN(+d) ? '' : d.toISOString().slice(0,10);
};
export function parseSmartDate(s?: any): string {
  if(!s) return '';
  if(s instanceof Date) return toISO(s);
  if(/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return s;
  const trials = [/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, /^(\d{1,2})-(\d{1,2})-(\d{4})$/, /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/];
  for(const rx of trials){
    const m = String(s).match(rx);
    if(m){
      let yyyy: number, mm: number, dd: number;
      if(rx === trials[1]){ yyyy=+m[1]; mm=+m[2]; dd=+m[3]; }
      else if(rx === trials[2]){ mm=+m[1]; dd=+m[2]; yyyy=+m[3]; }
      else { mm=+m[1]; dd=+m[2]; yyyy=+m[3]; }
      const d = new Date(Date.UTC(yyyy, mm-1, dd));
      if(!isNaN(+d)) return d.toISOString().slice(0,10);
    }
  }
  const d = new Date(s);
  return isNaN(+d) ? '' : d.toISOString().slice(0,10);
}
export function expiryStatus(iso?: string){
  if(!iso) return {label:'Missing', color:'bg-red-100 text-red-700'};
  const now = new Date();
  const dt = new Date(iso);
  const days = Math.round((+dt - +now)/(1000*60*60*24));
  if(days < 0) return {label:`Expired ${Math.abs(days)}d`, color:'bg-red-100 text-red-700'};
  if(days <= 30) return {label:`${days}d left`, color:'bg-orange-100 text-orange-700'};
  if(days <= 60) return {label:`${days}d left`, color:'bg-yellow-100 text-yellow-700'};
  return {label:`${days}d left`, color:'bg-emerald-100 text-emerald-700'};
}
