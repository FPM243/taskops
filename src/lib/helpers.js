// src/lib/helpers.js
// Funciones utilitarias y helpers del sistema NEXUS
// Extraídas de App.jsx en refactor ETAPA 2

import { DEPT_COLORS, USERS, ASSIGN_MATRIX, PUEDE_REGISTRAR_AUSENCIAS, MONTHS_ES, T2 } from "./constants";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../supabase";

// ════════════════════════════════════════
// FUNCIONES DE FECHA
// ════════════════════════════════════════

export function safeDate(dateStr) {
  if(!dateStr) return null;
  try {
    if(dateStr.includes("T")) return new Date(dateStr);
    return new Date(dateStr + "T12:00:00");
  } catch(e) { return null; }
}

export function safeDays(dateStr) {
  const d = safeDate(dateStr);
  if(!d || isNaN(d.getTime())) return 0;
  return Math.max(0, Math.round((new Date() - d) / 86400000));
}

export function fmtDT(iso) {
  const d = new Date(iso);
  if(isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})+" "+d.toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"});
}

export function fmtCompletedDate(d){
  if(!d) return "—";
  const dt=new Date(d.includes("T")?d:d+"T12:00:00");
  return dt.toLocaleDateString("es-MX",{day:"numeric",month:"short",year:"numeric"});
}

export function fmtDate(d){
  if(!d) return "";
  const dt=new Date(d+"T12:00:00"),today=new Date(); today.setHours(0,0,0,0);
  const diff=Math.round((dt-today)/86400000);
  if(diff<0)   return `Vencida hace ${Math.abs(diff)}d`;
  if(diff===0) return "Vence HOY";
  if(diff===1) return "Vence mañana";
  return dt.toLocaleDateString("es-MX",{day:"numeric",month:"short"});
}

export const fmtISODateLocal = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

export const isoWeekday = d => { const wd=d.getDay(); return wd===0?7:wd; };

export const isTodayDeadline = d => {
  const dt=new Date(d+"T12:00:00"), now=new Date();
  return dt.toDateString()===now.toDateString();
};

// ════════════════════════════════════════
// FUNCIONES DE AUSENCIAS
// ════════════════════════════════════════

export function diasHabilesAusencia(fechaInicio,fechaFin){
  if(!fechaInicio||!fechaFin) return 0;
  let count=0;
  let current=new Date(fechaInicio+"T12:00:00");
  const fin=new Date(fechaFin+"T12:00:00");
  while(current<=fin){
    const dow=current.getDay();
    if(dow!==0&&dow!==6) count++;
    current.setDate(current.getDate()+1);
  }
  return count;
}

export const fmtFechaCortaAusencia = fStr => {
  if(!fStr) return "";
  const d=new Date(fStr+"T12:00:00");
  return `${d.getDate()} ${MONTHS_ES[d.getMonth()].slice(0,3)}`;
};

export const fmtRangoAusencia = (desde,hasta) => {
  if(!desde) return "";
  if(!hasta||desde===hasta) return fmtFechaCortaAusencia(desde);
  const d1=new Date(desde+"T12:00:00"),d2=new Date(hasta+"T12:00:00");
  if(d1.getMonth()===d2.getMonth()) return `${d1.getDate()}–${d2.getDate()} ${MONTHS_ES[d2.getMonth()].slice(0,3)}`;
  return `${fmtFechaCortaAusencia(desde)} – ${fmtFechaCortaAusencia(hasta)}`;
};

export const puedeRegistrarAusencias = user => !!user && PUEDE_REGISTRAR_AUSENCIAS.includes(user.id);

export const esRHAusencias = user => user?.dept === "RR.HH";

export const rolRegistroAusencia = user => esRHAusencias(user) ? "rh" : "gerente";

// ════════════════════════════════════════
// FUNCIONES DE TAREAS
// ════════════════════════════════════════

export const dc = dept => DEPT_COLORS[dept] || "#6B7280";

export const getInvolved = ids => (ids||[]).map(id=>USERS.find(u=>u.id===id)).filter(Boolean);

export const shortName = n => n.replace("Gerente de ","");

export const isOver = (d,st) => new Date(d)<new Date()&&st!=="Completada"&&st!=="Cancelada"&&st!=="Bloqueada";

export const isActive = t => t.status!=="Completada"&&t.status!=="Cancelada";

export const isAtRisk = t => {
  if(!isActive(t)||!t.deadline||isOver(t.deadline,t.status)||t.status==="Bloqueada") return false;
  const dt=new Date(t.deadline+"T12:00:00"),now=new Date(); now.setHours(0,0,0,0);
  const diff=Math.round((dt-now)/86400000); return diff>=0&&diff<=2;
};

export function dlStatus(deadline,status){
  if(!deadline) return {label:"",c:T2,bg:"#F9FAFB",isOver:false,isToday:false};
  const active=status!=="Completada"&&status!=="Cancelada"&&status!=="Bloqueada";
  const dt=new Date(deadline+"T12:00:00"),now=new Date(); now.setHours(0,0,0,0);
  const diff=Math.round((dt-now)/86400000);
  if(!active) return {label:fmtDate(deadline),c:T2,bg:"#F9FAFB",isOver:false,isToday:false};
  if(diff<0)  return {label:`Vencida hace ${Math.abs(diff)}d`,c:"#DC2626",bg:"#FEF2F2",isOver:true,isToday:false};
  if(diff===0)return {label:"Vence HOY",c:"#EA580C",bg:"#FFF7ED",isOver:false,isToday:true};
  if(diff<=3) return {label:fmtDate(deadline),c:"#D97706",bg:"#FFFBEB",isOver:false,isToday:false};
  return {label:fmtDate(deadline),c:"#059669",bg:"#ECFDF5",isOver:false,isToday:false};
}

export const isActiveStatus = st => st!=="Completada"&&st!=="Cancelada";

// ════════════════════════════════════════
// FUNCIONES DE AVISOS
// ════════════════════════════════════════

// Destinatarios de un aviso: soporta el array nuevo (destinatarioIds) y
// cae de vuelta al campo viejo singular (destinatarioId) para avisos
// existentes en Supabase — no requiere migración de datos.
export const avisoRecipients = a => a.destinatarioIds!==undefined ? a.destinatarioIds : a.destinatarioId;

export const avisoIncludesUser = (a,uid) => {
  const d=avisoRecipients(a);
  if(d==="todos") return true;
  if(Array.isArray(d)) return d.includes(uid);
  return d===uid;
};

// ════════════════════════════════════════
// FUNCIONES DE FLOW/STAGES
// ════════════════════════════════════════

export const genStageId = () => `st${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}`;

export const getStageIds = (invIds,flowStageIds) => (flowStageIds&&flowStageIds.length===invIds.length) ? flowStageIds : invIds.map((_,i)=>String(i));

export const calcProgress = (invIds,flowStates,flowStageIds) => {
  if(!invIds||!invIds.length) return null;
  const sids=getStageIds(invIds,flowStageIds);
  const vals=invIds.map((_,idx)=>{const s=flowStates?.[sids[idx]]||"Pendiente";return s==="Completado"?100:s==="En proceso"?50:0;});
  return Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
};

// ════════════════════════════════════════
// FUNCIONES DE USUARIOS Y PERMISOS
// ════════════════════════════════════════

export const getAssignableIds = user => {
  if (!user) return [];
  if (user.dept === "Dirección") return USERS.map(u => u.id);
  const ids = ASSIGN_MATRIX[user.dept];
  if (ids) return [...new Set([user.id, ...ids])];
  return [user.id];
};

// ════════════════════════════════════════
// FUNCIÓN DE AUTENTICACIÓN
// ════════════════════════════════════════

export async function verifyDeptPassword(dept, password) {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/verify-dept-password`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ dept, password })
      }
    );

    // Manejar rate limiting
    if (response.status === 429) {
      const data = await response.json();
      alert(`Demasiados intentos. Espera ${data.retryAfter || 60} segundos.`);
      return false;
    }

    if (!response.ok) {
      console.error("[Auth] Error en verificación:", response.status);
      return false;
    }

    const data = await response.json();
    return data.valid === true;
  } catch (err) {
    console.error("[Auth] Error verificando contraseña:", err);
    return false;
  }
}
