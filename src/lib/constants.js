// src/lib/constants.js
// Constantes estáticas del sistema NEXUS
// Extraídas de App.jsx en refactor ETAPA 1

// ════════════════════════════════════════
// CONFIGURACIÓN GENERAL
// ════════════════════════════════════════
export const MAX_ATTACHMENT_SIZE = 20*1024*1024;

export const VAPID_PUBLIC_KEY = "BDPhk-gLXmglq2HQL7tVFaXUpMTA4Lb6CFVVHN8FRfsmR3SjR52PZP_iQ6usGPNA1nhgc-P0XjBfbVLvFscQI3g";

export const LOGO_URL = "/fpm-logo.jpg";

// ════════════════════════════════════════
// USUARIOS Y DEPARTAMENTOS
// ════════════════════════════════════════
export const DEPT_COLORS = {
  "Dirección":"#4338CA","Ingenieria":"#2563EB","Calidad":"#059669",
  "Producción":"#D97706","Compras":"#7C3AED","Logistica/IT":"#0891B2",
  "Finanzas":"#BE185D","Mantenimiento":"#B45309","SMT":"#0F766E","RR.HH":"#DC2626",
  "Investigación y Desarrollo":"#0D9488","Recepción":"#0369A1",
};

export const USERS = [
  {id:1,  name:"Dir. General",               email:"agbaxter@fpm.com.mx",        ini:"DG",  dept:"Dirección",                    phone:"528112559943"},
  {id:2,  name:"Gerente de Ingeniería",      email:"ingenieria@fpm.com.mx",      ini:"GI",  dept:"Ingenieria",                   phone:"528111060963"},
  {id:3,  name:"Gerente de Calidad",         email:"calidad@fpm.com.mx",         ini:"GC",  dept:"Calidad",                      phone:"528118794086"},
  {id:4,  name:"Gerente de Producción",      email:"administracion@fpm.com.mx",  ini:"GP",  dept:"Producción",                   phone:"528134752622"},
  {id:5,  name:"Gerente de Compras",         email:"compras@fpm.com.mx",         ini:"GCo", dept:"Compras",                      phone:"528117636745"},
  {id:6,  name:"Gerente de Logística",       email:"logistica@fpm.com.mx",       ini:"GL",  dept:"Logistica/IT",                 phone:"528117641913"},
  {id:7,  name:"Gerente de Finanzas",        email:"cmartinez@fpm.com.mx",       ini:"GF",  dept:"Finanzas",                     phone:"528110665239"},
  {id:8,  name:"Mantenimiento",              email:"mpacheco@fpm.com.mx",        ini:"MT",  dept:"Mantenimiento",                phone:"528126577368"},
  {id:9,  name:"SMT",                        email:"smt@fpm.com.mx",             ini:"SM",  dept:"SMT",                          phone:"528211248010"},
  {id:10, name:"Gerente de RR.HH",           email:"recursoshumanos@fpm.com.mx", ini:"RH",  dept:"RR.HH",                        phone:"528110665017"},
  {id:11, name:"Supervisor de Calidad",      email:"icc@fpm.com.mx",             ini:"SC",  dept:"Calidad",                      phone:"528115270228"},
  {id:12, name:"Inspector de Calidad",       email:"auxcalidad@fpm.com.mx",      ini:"IC",  dept:"Calidad",                      phone:"528110643416"},
  {id:13, name:"Supervisor V",               email:"produccion@fpm.com.mx",      ini:"SV",  dept:"Producción",                   phone:"528128709178"},
  {id:14, name:"Supervisor N",               email:"produccion@fpm.com.mx",      ini:"SN",  dept:"Producción",                   phone:"528130766964"},
  {id:15, name:"Supervisor E",               email:"produccion@fpm.com.mx",      ini:"SE",  dept:"Producción",                   phone:"528125977586"},
  {id:16, name:"Almacén",                    email:"almacen@fpm.com.mx",         ini:"AL",  dept:"Logistica/IT",                 phone:"528112197661"},
  {id:17, name:"Cobranza",                   email:"cobranzas@fpm.com.mx",       ini:"CB",  dept:"Finanzas",                     phone:"528120747829"},
  {id:18, name:"Investigación y Desarrollo", email:"laboratorio@fpm.com.mx",     ini:"JL",  dept:"Investigación y Desarrollo",   phone:"528110665019"},
  {id:19, name:"Recepción",                  email:"recepcion@fpm.com.mx",       ini:"RC",  dept:"Recepción",                    phone:"528126586174"},
];
USERS.forEach(u => { u.uc = DEPT_COLORS[u.dept]; });

export const DEPTS = [...new Set(USERS.map(u => u.dept))];
export const USERS_BY_DEPT = DEPTS.map(dept=>({dept,users:USERS.filter(u=>u.dept===dept)}));

// ids que cada departamento puede seleccionar como responsable
export const ASSIGN_MATRIX = {
  "Dirección":  null,        // null = todos
  "Ingenieria": [9],         // SMT
  "Calidad":    [8, 11, 12], // Mantenimiento, Auxiliar calidad, Inspector calidad
  "Producción":  [13, 14, 15],// Supervisores V, N, E
  "Logistica/IT":[16],        // Almacén
  "Finanzas":    [17],        // Cobranza
};

// ════════════════════════════════════════
// MÓDULO DE AUSENCIAS
// ════════════════════════════════════════
export const PUEDE_REGISTRAR_AUSENCIAS = [1,2,3,4,5,6,7,10];

export const TIPO_AUSENCIA_CONFIG = {
  vacaciones:       {label:"Vacaciones",       bg:"#E1F5EE", text:"#0F6E56"},
  permiso:          {label:"Permiso",          bg:"#E6F1FB", text:"#185FA5"},
  dia_asignado:     {label:"Día asignado",     bg:"#FAEEDA", text:"#854F0B"},
  esquema_reducido: {label:"Esquema reducido", bg:"#EEEDFE", text:"#3C3489"},
};

export const TIPO_AUSENCIA_ABBR = {vacaciones:"Vac",permiso:"Perm",dia_asignado:"Día",esquema_reducido:"E.Red"};

export const DIAS_SEMANA_OPTS = [{n:1,l:"L"},{n:2,l:"M"},{n:3,l:"X"},{n:4,l:"J"},{n:5,l:"V"}];

// ════════════════════════════════════════
// CONFIGURACIÓN DE TAREAS
// ════════════════════════════════════════
export const TT = {
  "Operativa":     {c:"#2563EB", bg:"#EFF6FF"},
  "Administrativa":{c:"#7C3AED", bg:"#F5F3FF"},
  "Proyecto":      {c:"#059669", bg:"#ECFDF5"},
};

export const SC = {
  "Pendiente":  {c:"#6B7280", bg:"#F9FAFB"},
  "En proceso": {c:"#D97706", bg:"#FFFBEB"},
  "Bloqueada":  {c:"#DC2626", bg:"#FEF2F2"},
  "Completada": {c:"#059669", bg:"#ECFDF5"},
  "Cancelada":  {c:"#9CA3AF", bg:"#F9FAFB"},
};

export const PC = {Alta:{c:"#DC2626",bg:"#FEF2F2"},Media:{c:"#D97706",bg:"#FFFBEB"},Baja:{c:"#059669",bg:"#ECFDF5"}};

export const FS_CFG = {
  "Pendiente": {c:"#6B7280",bg:"#F1F5F9",icon:"○"},
  "En proceso":{c:"#D97706",bg:"#FFFBEB",icon:"◑"},
  "Completado":{c:"#059669",bg:"#ECFDF5",icon:"●"},
};

export const BLANK = {type:"",title:"",description:"",respId:"",invIds:[],deadline:"",priority:"Media",origin:"Sistema",notes:"",notifyOnComplete:[]};

// ════════════════════════════════════════
// DATOS DE FECHA/CALENDARIO
// ════════════════════════════════════════
export const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
export const DAYS_ES   = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
export const DAYS_WORK = ["Lun","Mar","Mié","Jue","Vie"]; // Días laborales Lun-Vie

// ════════════════════════════════════════
// INITIAL TASKS (Datos de ejemplo)
// ════════════════════════════════════════
export const IT = [
  {
    id:"TSK-001",type:"Operativa",priority:"Alta",origin:"Verbal",status:"En proceso",
    title:"Defectos de soldadura en horno de reflujo — línea SMT 3",
    description:"Se detectaron puentes de soldadura y soldadura fría en componentes QFP-64 procesados en línea SMT 3. Se requiere ajuste del perfil térmico del horno de reflujo, revisión del esténcil y evaluación del lote afectado bajo criterio IPC-A-610 clase 2.",
    creator:USERS[3], responsible:USERS[12],
    invIds:[9,8,12,13],
    flowStates:{9:"En proceso",8:"Pendiente",12:"Pendiente",13:"Pendiente"},
    deadline:"2026-05-29", createdAt:"2026-05-24", flowLog:[],
    comments:[
      {user:USERS[12],text:"Se inició diagnóstico del perfil térmico. Temperatura pico fuera de rango en zona 5 del horno.",time:"24 may 2026 08:30"},
      {user:USERS[7], text:"Revisando termopar zona 5. Se detectó deriva de ±12 °C respecto al setpoint. Pieza de repuesto en solicitud a almacén.",time:"24 may 2026 10:15"},
    ],
    confirmed:[],
  },
  {
    id:"TSK-002",type:"Operativa",priority:"Alta",origin:"Sistema",status:"En proceso",
    title:"Inspección IPC-A-610 lote PCB-2026-044 — 320 piezas exportación",
    description:"Inspección visual y eléctrica del lote PCB-2026-044 bajo norma IPC-A-610 clase 2. El lote consta de 320 tarjetas destinadas a cliente de exportación. Se requiere reporte de hallazgos, segregación de rechazos y disposición formal antes del embarque del 30 de mayo.",
    creator:USERS[2], responsible:USERS[11],
    invIds:[12,11,4],
    flowStates:{12:"En proceso",11:"Pendiente",4:"Pendiente"},
    deadline:"2026-05-30", createdAt:"2026-05-22", flowLog:[],
    comments:[
      {user:USERS[11],text:"Inicio de inspección visual. Se detectaron 4 piezas con soldadura fría en zona J3. Segregadas para retrabajo. Continúa revisión eléctrica.",time:"22 may 2026 14:00"},
    ],
    confirmed:[],
  },
  {
    id:"TSK-003",type:"Operativa",priority:"Alta",origin:"Sistema",status:"En proceso",
    title:"Desabasto de flux WS-820 — gestión de compra de emergencia",
    description:"Stock de flux WS-820 en punto crítico: consumo diario de 3 litros, inventario actual para 1.5 días de producción. Coordinar compra de emergencia con proveedor Kester, recepción en almacén y continuidad de línea. Evitar paro no programado.",
    creator:USERS[3], responsible:USERS[5],
    invIds:[6,16,5],
    flowStates:{6:"En proceso",16:"Pendiente",5:"Pendiente"},
    deadline:"2026-05-27", createdAt:"2026-05-25", flowLog:[],
    comments:[
      {user:USERS[5], text:"Contacto con Kester confirmado. Entrega express disponible en 24 h con costo adicional de $1,200 MXN. Se solicita autorización a Dirección.",time:"25 may 2026 11:20"},
    ],
    confirmed:[],
  },
  {
    id:"TSK-004",type:"Proyecto",priority:"Media",origin:"Junta",status:"En proceso",
    title:"Implementación metodología 5S en área de ensamble manual",
    description:"Implementar las 5 etapas de la metodología 5S (Clasificar, Ordenar, Limpiar, Estandarizar, Sostener) en el área de ensamble manual para reducir tiempos de búsqueda de herramientas, mejorar ergonomía de estaciones y reducir defectos atribuibles al entorno. Incluye capacitación a operadores y auditoría de cierre.",
    creator:USERS[0], responsible:USERS[3],
    invIds:[4,13,14,15,3],
    flowStates:{4:"En proceso",13:"En proceso",14:"Pendiente",15:"Pendiente",3:"Pendiente"},
    deadline:"2026-06-13", createdAt:"2026-05-19", flowLog:[],
    comments:[
      {user:USERS[3], text:"Kick-off con supervisores realizado. Asignación de zonas: Sup1 → área A (inserción), Sup2 → área B (pruebas), Sup3 → área C (empaque).",time:"20 may 2026 09:00"},
      {user:USERS[12],text:"Área A clasificada. Se retiraron 23 herramientas obsoletas y 2 equipos sin uso. Inicio de etiquetado esta semana.",time:"22 may 2026 16:45"},
    ],
    confirmed:[],
  },
  {
    id:"TSK-005",type:"Administrativa",priority:"Media",origin:"Sistema",status:"Pendiente",
    title:"Conciliación de inventario SMD críticos vs ERP — cierre mayo",
    description:"Conciliación de inventario físico versus sistema ERP para componentes SMD críticos: resistencias 0402 (1k, 10k, 100k), capacitores 0603 (100nF, 10µF) y CIs de la familia STM32F4. Detectar discrepancias, identificar causas raíz y ajustar registros antes del cierre contable del 31 de mayo.",
    creator:USERS[4], responsible:USERS[10],
    invIds:[11,16,9,5],
    flowStates:{11:"Pendiente",16:"Pendiente",9:"Pendiente",5:"Pendiente"},
    deadline:"2026-05-31", createdAt:"2026-05-26", flowLog:[],
    comments:[],
    confirmed:[],
  },
];

// ════════════════════════════════════════
// DESIGN TOKENS
// ════════════════════════════════════════
export const BG="#F0F4FF";
export const CARD="#FFFFFF";
export const BD="#DDE3F0";
export const T1="#1E1B4B";
export const T2="#64748B";
export const T3="#94A3B8";
export const PR="#4338CA";
export const PRl="#EEF2FF";

export const SH="0 1px 3px rgba(15,23,42,.08),0 1px 2px rgba(15,23,42,.04)";
export const SHm="0 8px 28px rgba(15,23,42,.14)";

export const fnt={fontFamily:"'Plus Jakarta Sans',system-ui,sans-serif"};
export const inp={background:CARD,border:`1px solid ${BD}`,color:T1,padding:"10px 14px",fontSize:13,outline:"none",borderRadius:8,...fnt,width:"100%"};

export const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
body,#root{min-height:100vh;background:${BG};font-family:'Plus Jakarta Sans',system-ui,sans-serif;}
::-webkit-scrollbar{width:5px;} ::-webkit-scrollbar-thumb{background:#C7D2E8;border-radius:10px;}
.rw:hover{background:#F8FAFF!important;} .rw{transition:background .12s;cursor:pointer;}
.ub:hover{background:${PR}!important;color:#fff!important;border-color:${PR}!important;} .ub{transition:all .15s;}
.hl:hover{color:${PR}!important;} .hl{transition:color .1s;}
.dc:hover{box-shadow:0 6px 24px rgba(67,56,202,.18)!important;transform:translateY(-2px);} .dc{transition:all .18s ease;cursor:pointer;}
.dp-item:hover{background:${PRl}!important;cursor:pointer;} .dp-item{transition:background .1s;}
.im:hover{border-color:${PR}!important;} .im{transition:border-color .12s;}
.im.on{border-color:${PR}!important;background:${PRl}!important;}
.fab:hover{transform:scale(1.1);box-shadow:0 8px 28px rgba(67,56,202,.45)!important;} .fab{transition:all .15s ease;}
.pl{animation:pl 1.4s ease-in-out infinite;} @keyframes pl{0%,100%{opacity:1}50%{opacity:.25}}
.fn-pulse{animation:fnp 1.9s ease-in-out infinite;} @keyframes fnp{0%,100%{box-shadow:0 0 0 0 rgba(67,56,202,0);border-color:#4338CA44}50%{box-shadow:0 0 0 5px rgba(67,56,202,.22);border-color:#4338CA}}
.sp{animation:sp .9s linear infinite;display:inline-block;} @keyframes sp{to{transform:rotate(360deg)}}
.nb{border:1px solid ${BD};color:${T2};background:none;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:5px;font-family:inherit;transition:all .12s;}
.nb:hover{background:${PRl}!important;color:${PR}!important;border-color:${PR}!important;}
.nb.active{background:${PRl};color:${PR};border-color:${PR};}
`;
