import { useState, useMemo, useRef, useEffect } from "react";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

/* ════════════════════════════════════════
   DATA & CONSTANTS
════════════════════════════════════════ */
const DEPT_COLORS = {
  "Dirección":"#4338CA","Ingenieria":"#2563EB","Calidad":"#059669",
  "Producción":"#D97706","Compras":"#7C3AED","Logistica":"#0891B2",
  "Finanzas":"#BE185D","Mantenimiento":"#B45309","SMT":"#0F766E","RR.HH":"#DC2626",
};
const DEPT_PWD = {
  "Dirección":"","Ingenieria":"ing2024","Calidad":"cal2024","Producción":"prod2024",
  "Compras":"comp2024","Logistica":"log2024","Finanzas":"fin2024",
  "Mantenimiento":"mant2024","SMT":"smt2024","RR.HH":"rrhh2024",
};
const USERS = [
  {id:1,  name:"Dir. General",          ini:"DG",  dept:"Dirección"},
  {id:2,  name:"Gerente de Ingeniería",  ini:"GI",  dept:"Ingenieria"},
  {id:3,  name:"Gerente de Calidad",     ini:"GC",  dept:"Calidad"},
  {id:4,  name:"Gerente de Producción",  ini:"GP",  dept:"Producción"},
  {id:5,  name:"Gerente de Compras",     ini:"GCo", dept:"Compras"},
  {id:6,  name:"Gerente de Logística",   ini:"GL",  dept:"Logistica"},
  {id:7,  name:"Gerente de Finanzas",    ini:"GF",  dept:"Finanzas"},
  {id:8,  name:"Mantenimiento",          ini:"MT",  dept:"Mantenimiento"},
  {id:9,  name:"SMT",                    ini:"SM",  dept:"SMT"},
  {id:10, name:"Gerente de RR.HH",       ini:"RH",  dept:"RR.HH"},
];
USERS.forEach(u => { u.uc = DEPT_COLORS[u.dept]; });
const DEPTS = USERS.map(u => u.dept);
const TT = {
  "Operativa":     {c:"#2563EB", bg:"#EFF6FF"},
  "Administrativa":{c:"#7C3AED", bg:"#F5F3FF"},
  "Proyecto":      {c:"#059669", bg:"#ECFDF5"},
};
const SC = {
  "Pendiente":  {c:"#6B7280", bg:"#F9FAFB"},
  "En proceso": {c:"#D97706", bg:"#FFFBEB"},
  "Bloqueada":  {c:"#DC2626", bg:"#FEF2F2"},
  "Completada": {c:"#059669", bg:"#ECFDF5"},
  "Cancelada":  {c:"#9CA3AF", bg:"#F9FAFB"},
};
const PC = {Alta:{c:"#DC2626",bg:"#FEF2F2"},Media:{c:"#D97706",bg:"#FFFBEB"},Baja:{c:"#059669",bg:"#ECFDF5"}};
const FS_CFG = {
  "Pendiente": {c:"#6B7280",bg:"#F1F5F9",icon:"○"},
  "En proceso":{c:"#D97706",bg:"#FFFBEB",icon:"◑"},
  "Completado":{c:"#059669",bg:"#ECFDF5",icon:"●"},
};
const BLANK = {type:"",title:"",description:"",respId:"",invIds:[],deadline:"",priority:"Media",origin:"Sistema"};
const STORAGE_KEY = "taskops-v2-tasks";
const store = {
  get: async k => {
    try { if(window.storage) return await window.storage.get(k); } catch(e){}
    const v = localStorage.getItem(k); if(!v) throw new Error('not found'); return {value:v};
  },
  set: async (k,v) => {
    try { if(window.storage) return await window.storage.set(k,v); } catch(e){}
    try { localStorage.setItem(k,v); } catch(e){}
  }
};
const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DAYS_ES   = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];

const IT = [
  {id:"TSK-001",type:"Operativa",title:"Falla en línea SMT 2",description:"Errores de colocación en componentes 0402. Requiere diagnóstico y calibración.",creator:USERS[0],responsible:USERS[8],invIds:[2,4,8],flowStates:{2:"Completado",4:"En proceso",8:"Pendiente"},deadline:"2026-05-20",priority:"Alta",origin:"Verbal",status:"En proceso",comments:[{user:USERS[8],text:"Iniciando diagnóstico.",time:"09:00"},{user:USERS[1],text:"Revisando parámetros.",time:"09:45"}],confirmed:[9,2]},
  {id:"TSK-002",type:"Operativa",title:"Resina epoxi — stock crítico",description:"OC urgente para evitar paro de línea. Stock: 2 días.",creator:USERS[3],responsible:USERS[4],invIds:[1,4],flowStates:{1:"Pendiente",4:"Pendiente"},deadline:"2026-05-22",priority:"Alta",origin:"Sistema",status:"Pendiente",comments:[],confirmed:[]},
  {id:"TSK-003",type:"Proyecto",title:"Nuevo proceso de inspección visual",description:"Definir e implementar flujo de inspección visual en ensamble manual.",creator:USERS[0],responsible:USERS[2],invIds:[2,4,9],flowStates:{2:"Completado",4:"En proceso",9:"Pendiente"},deadline:"2026-06-01",priority:"Media",origin:"Junta",status:"En proceso",comments:[{user:USERS[2],text:"Documento en revisión interna.",time:"10:00"}],confirmed:[2,3,4,9]},
  {id:"TSK-004",type:"Operativa",title:"Ajuste parámetros soldadura ola",description:"Revisar temperatura soldadura ola en línea 3 por defectos.",creator:USERS[1],responsible:USERS[3],invIds:[3,8],flowStates:{3:"Pendiente",8:"Pendiente"},deadline:"2026-05-21",priority:"Alta",origin:"Junta",status:"Bloqueada",comments:[{user:USERS[3],text:"Esperando refacción de termocupla.",time:"15:30"}],confirmed:[4]},
  {id:"TSK-005",type:"Administrativa",title:"Actualización procedimiento QC-12",description:"Actualizar QC-12 conforme a nueva normativa ISO.",creator:USERS[2],responsible:USERS[2],invIds:[2,1],flowStates:{2:"En proceso",1:"Pendiente"},deadline:"2026-05-30",priority:"Baja",origin:"Sistema",status:"Pendiente",comments:[],confirmed:[]},
  {id:"TSK-006",type:"Operativa",title:"Recepción de componentes RF",description:"Coordinar recepción e inspección de lote RF con proveedor.",creator:USERS[5],responsible:USERS[5],invIds:[5,3],flowStates:{5:"En proceso",3:"Pendiente"},deadline:"2026-05-23",priority:"Media",origin:"WhatsApp-Correo",status:"En proceso",comments:[],confirmed:[6]},
  {id:"TSK-007",type:"Operativa",title:"Mantenimiento preventivo compresor A",description:"Mantenimiento preventivo programado trimestral.",creator:USERS[0],responsible:USERS[7],invIds:[4],flowStates:{4:"Pendiente"},deadline:"2026-05-25",priority:"Media",origin:"Sistema",status:"Pendiente",comments:[],confirmed:[]},
  {id:"TSK-008",type:"Proyecto",title:"Migración ERP módulo finanzas",description:"Coordinación módulo finanzas en migración al nuevo ERP.",creator:USERS[0],responsible:USERS[6],invIds:[2,5],flowStates:{2:"Pendiente",5:"Pendiente"},deadline:"2026-06-15",priority:"Media",origin:"Junta",status:"En proceso",comments:[],confirmed:[7]},
  {id:"TSK-009",type:"Operativa",title:"Calibración equipos de medición",description:"Calibración semestral de equipos en área de calidad.",creator:USERS[2],responsible:USERS[2],invIds:[2],flowStates:{2:"Pendiente"},deadline:"2026-05-28",priority:"Baja",origin:"Sistema",status:"Pendiente",comments:[],confirmed:[]},
  {id:"TSK-010",type:"Operativa",title:"OC conectores JST",description:"Generar OC conectores JST 2.54mm. Stock agotado en 3 días.",creator:USERS[4],responsible:USERS[4],invIds:[4,1],flowStates:{4:"En proceso",1:"Pendiente"},deadline:"2026-05-20",priority:"Alta",origin:"Sistema",status:"En proceso",comments:[],confirmed:[5]},
  {id:"TSK-011",type:"Administrativa",title:"Auditoría interna RR.HH — expedientes",description:"Revisión y actualización de expedientes del personal activo.",creator:USERS[9],responsible:USERS[9],invIds:[1],flowStates:{1:"Pendiente"},deadline:"2026-06-05",priority:"Media",origin:"Junta",status:"Pendiente",comments:[],confirmed:[]},
  {id:"TSK-012",type:"Proyecto",title:"Implementación control de asistencia digital",description:"Migración de registro de asistencia a sistema digital.",creator:USERS[9],responsible:USERS[9],invIds:[2,7],flowStates:{2:"Pendiente",7:"Pendiente"},deadline:"2026-06-20",priority:"Baja",origin:"Junta",status:"Pendiente",comments:[],confirmed:[]},
];

/* ════════════════════════════════════════
   DESIGN TOKENS & CSS
════════════════════════════════════════ */
const BG="#F0F4FF",CARD="#FFFFFF",BD="#DDE3F0",T1="#1E1B4B",T2="#64748B",T3="#94A3B8",PR="#4338CA",PRl="#EEF2FF";
const SH="0 1px 3px rgba(15,23,42,.08),0 1px 2px rgba(15,23,42,.04)";
const SHm="0 8px 28px rgba(15,23,42,.14)";
const fnt={fontFamily:"'Plus Jakarta Sans',system-ui,sans-serif"};
const inp={background:CARD,border:`1px solid ${BD}`,color:T1,padding:"10px 14px",fontSize:13,outline:"none",borderRadius:8,...fnt,width:"100%"};

const CSS=`
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
.sp{animation:sp .9s linear infinite;display:inline-block;} @keyframes sp{to{transform:rotate(360deg)}}
.nb{border:1px solid ${BD};color:${T2};background:none;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:5px;font-family:inherit;transition:all .12s;}
.nb:hover{background:${PRl}!important;color:${PR}!important;border-color:${PR}!important;}
.nb.active{background:${PRl};color:${PR};border-color:${PR};}
.cal-day:hover{background:${PRl}!important;cursor:pointer;} .cal-day{transition:background .1s;}
select{appearance:none;-webkit-appearance:none;} select option{background:#fff;color:${T1};}
input[type=date]{color-scheme:light;}
input::placeholder,textarea::placeholder{color:${T3};}
textarea{resize:vertical;}
.dz{border:2px dashed ${BD};transition:all .2s;border-radius:8px;}
.dz:hover,.dz.ov{border-color:${PR}!important;background:${PRl}!important;}
button{font-family:'Plus Jakarta Sans',system-ui,sans-serif;}
`;

/* ════════════════════════════════════════
   UTILITIES
════════════════════════════════════════ */
const dc = dept => DEPT_COLORS[dept] || "#6B7280";
const getInvolved = ids => (ids||[]).map(id=>USERS.find(u=>u.id===id)).filter(Boolean);
const shortName = n => n.replace("Gerente de ","");
const isOver   = (d,st) => new Date(d)<new Date()&&st!=="Completada"&&st!=="Cancelada";
const isActive = t => t.status!=="Completada"&&t.status!=="Cancelada";
const isTodayDeadline = d => {
  const dt=new Date(d+"T12:00:00"), now=new Date();
  return dt.toDateString()===now.toDateString();
};
const calcProgress = (invIds,flowStates) => {
  if(!invIds||!invIds.length) return null;
  const vals=invIds.map(id=>{const s=flowStates?.[id]||"Pendiente";return s==="Completado"?100:s==="En proceso"?50:0;});
  return Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
};
function fmtDate(d){
  if(!d) return "";
  const dt=new Date(d+"T12:00:00"),today=new Date(); today.setHours(0,0,0,0);
  const diff=Math.round((dt-today)/86400000);
  if(diff<0)   return `Vencida hace ${Math.abs(diff)}d`;
  if(diff===0) return "Vence HOY";
  if(diff===1) return "Vence mañana";
  return dt.toLocaleDateString("es-MX",{day:"numeric",month:"short"});
}

/* ════════════════════════════════════════
   UI PRIMITIVES
════════════════════════════════════════ */
function Av({u,size=36}){
  const uu=u||{uc:"#6B7280",ini:"?"};
  return <div style={{width:size,height:size,borderRadius:"50%",background:uu.uc||"#6B7280",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
    <span style={{color:"#fff",fontSize:size*.33,fontWeight:700}}>{uu.ini||"?"}</span>
  </div>;
}
function Badge({ch,c,bg}){
  return <span style={{background:bg,color:c,padding:"2px 9px",borderRadius:20,fontSize:11,fontWeight:600,whiteSpace:"nowrap",...fnt}}>{ch}</span>;
}
function Lbl({ch}){return <div style={{fontSize:11,fontWeight:600,color:T2,letterSpacing:.5,marginBottom:8}}>{ch}</div>;}
function Card({children,sx={},cls="",onClick}){return <div className={cls} style={{background:CARD,borderRadius:12,boxShadow:SH,border:`1px solid ${BD}`,...sx}} onClick={onClick}>{children}</div>;}

function ProgressBar({pct,color}){
  if(pct===null) return null;
  return(
    <div style={{marginTop:8,display:"flex",alignItems:"center",gap:8}}>
      <div style={{flex:1,height:4,background:BD,borderRadius:4,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${pct}%`,background:color||PR,borderRadius:4,transition:"width .3s ease"}}/>
      </div>
      <span style={{fontSize:10,color:T3,fontWeight:600,minWidth:28}}>{pct}%</span>
    </div>
  );
}

function NavBar({left,center,right}){
  return <div style={{background:CARD,borderBottom:`1px solid ${BD}`,padding:"0 20px",display:"flex",alignItems:"center",justifyContent:"space-between",height:60,position:"sticky",top:0,zIndex:50,boxShadow:"0 1px 4px rgba(15,23,42,.06)"}}>
    <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>{left}</div>
    <div style={{display:"flex",alignItems:"center",gap:8,flex:1,justifyContent:"center",flexWrap:"wrap"}}>{center}</div>
    <div style={{display:"flex",alignItems:"center",gap:8,position:"relative",flexShrink:0}}>{right}</div>
  </div>;
}
function Logo(){return <><span style={{fontSize:18}}>⚡</span><span style={{fontWeight:700,fontSize:15,color:T1,letterSpacing:.5}}>TASKOPS</span></>;}
function BackBtn({onClick}){return <button onClick={onClick} className="hl" style={{background:"none",border:"none",color:T2,cursor:"pointer",fontSize:22,lineHeight:1,padding:"4px"}}>←</button>;}

function TRow({t,onClick}){
  const tt=TT[t.type]||{c:T2,bg:"#F9FAFB"};
  const sc=SC[t.status];const pc=PC[t.priority];const ov=isOver(t.deadline,t.status);
  const pct=calcProgress(t.invIds,t.flowStates);
  const pctColor=pct===100?"#059669":pct>=50?"#D97706":"#6B7280";
  return(
    <Card cls="rw" sx={{padding:"14px 18px",marginBottom:8,borderLeft:`3px solid ${dc(t.responsible?.dept||"Dirección")}`}} onClick={onClick}>
      <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:6,flexWrap:"wrap"}}>
            <span style={{fontSize:10,color:T3,fontWeight:500}}>{t.id}</span>
            <Badge ch={t.type}     c={tt.c} bg={tt.bg}/>
            <Badge ch={t.priority} c={pc.c} bg={pc.bg}/>
            <Badge ch={t.status}   c={sc.c} bg={sc.bg}/>
            {ov&&<Badge ch="⚠ Vencida" c="#DC2626" bg="#FEF2F2"/>}
            {isTodayDeadline(t.deadline)&&isActive(t)&&<Badge ch="📅 HOY" c="#4338CA" bg="#EEF2FF"/>}
          </div>
          <div style={{fontSize:14,fontWeight:600,color:T1,marginBottom:4}}>{t.title}</div>
          <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
            {t.responsible&&<div style={{display:"flex",alignItems:"center",gap:5}}>
              <Av u={t.responsible} size={18}/><span style={{fontSize:11,color:T2}}>{t.responsible.name}</span>
            </div>}
            <span style={{fontSize:11,color:ov?"#DC2626":isTodayDeadline(t.deadline)?"#4338CA":"#D97706",fontWeight:ov||isTodayDeadline(t.deadline)?700:500}}>{fmtDate(t.deadline)}</span>
          </div>
          {pct!==null&&<ProgressBar pct={pct} color={pctColor}/>}
        </div>
        <span style={{color:T3,fontSize:18,flexShrink:0,paddingTop:4}}>›</span>
      </div>
    </Card>
  );
}

/* ════════════════════════════════════════
   FLOW DIAGRAM
════════════════════════════════════════ */
function FlowDiagram({invIds,flowStates,onReorder,onStateChange,canEdit}){
  const nodes=getInvolved(invIds);
  if(!nodes.length) return <div style={{color:T3,fontSize:13,textAlign:"center",padding:"16px 0"}}>Sin involucrados definidos</div>;
  const moveUp=i=>{const a=[...invIds];[a[i-1],a[i]]=[a[i],a[i-1]];onReorder(a);};
  const moveDown=i=>{const a=[...invIds];[a[i],a[i+1]]=[a[i+1],a[i]];onReorder(a);};
  return(
    <div style={{display:"flex",flexDirection:"column"}}>
      {nodes.map((u,i)=>{
        const st=flowStates[u.id]||"Pendiente";const fc=FS_CFG[st];const isLast=i===nodes.length-1;
        return(
          <div key={u.id} style={{display:"flex",flexDirection:"column",alignItems:"flex-start"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,width:"100%",background:fc.bg,border:`1.5px solid ${fc.c}33`,borderRadius:10,padding:"12px 16px"}}>
              <div style={{width:28,height:28,borderRadius:"50%",background:fc.c,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <span style={{color:"#fff",fontWeight:700,fontSize:12}}>{i+1}</span>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:T1}}>{u.name}</div>
                <div style={{fontSize:11,color:T2}}>{u.dept}</div>
              </div>
              {canEdit?(
                <div style={{display:"flex",gap:4,flexWrap:"wrap",justifyContent:"flex-end"}}>
                  {Object.entries(FS_CFG).map(([s,c])=>(
                    <button key={s} onClick={()=>onStateChange(u.id,s)}
                      style={{background:st===s?c.c:CARD,color:st===s?"#fff":c.c,border:`1px solid ${c.c}`,padding:"4px 10px",borderRadius:20,cursor:"pointer",fontSize:11,fontWeight:600,transition:"all .1s"}}>
                      {c.icon} {s}
                    </button>
                  ))}
                </div>
              ):<Badge ch={`${fc.icon} ${st}`} c={fc.c} bg={fc.bg}/>}
              {canEdit&&(
                <div style={{display:"flex",flexDirection:"column",gap:2,marginLeft:4}}>
                  <button onClick={()=>moveUp(i)} disabled={i===0} style={{background:"none",border:`1px solid ${BD}`,borderRadius:4,width:22,height:22,cursor:i===0?"not-allowed":"pointer",color:i===0?T3:T2,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>↑</button>
                  <button onClick={()=>moveDown(i)} disabled={isLast} style={{background:"none",border:`1px solid ${BD}`,borderRadius:4,width:22,height:22,cursor:isLast?"not-allowed":"pointer",color:isLast?T3:T2,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>↓</button>
                </div>
              )}
            </div>
            {!isLast&&<div style={{paddingLeft:30}}><div style={{width:2,height:8,background:BD,marginLeft:13}}/><div style={{color:T3,fontSize:14,lineHeight:1,marginLeft:7}}>▼</div><div style={{width:2,height:8,background:BD,marginLeft:13}}/></div>}
          </div>
        );
      })}
    </div>
  );
}

/* ════════════════════════════════════════
   ALERT BANNER
════════════════════════════════════════ */
function AlertBanner({tasks,onClickOverdue,onClickToday}){
  const overdue = tasks.filter(t=>isOver(t.deadline,t.status));
  const today   = tasks.filter(t=>isTodayDeadline(t.deadline)&&isActive(t)&&!isOver(t.deadline,t.status));
  if(!overdue.length&&!today.length) return null;
  return(
    <div style={{padding:"0 24px",maxWidth:1100,margin:"0 auto"}}>
      <div style={{display:"flex",gap:10,paddingTop:16,flexWrap:"wrap"}}>
        {overdue.length>0&&(
          <button onClick={onClickOverdue}
            style={{background:"#FEF2F2",border:"1px solid #FECACA",color:"#DC2626",padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,display:"flex",alignItems:"center",gap:6,...fnt,transition:"all .12s"}}>
            ⚠️ {overdue.length} tarea{overdue.length>1?"s":""} vencida{overdue.length>1?"s":""} — Ver ahora
          </button>
        )}
        {today.length>0&&(
          <button onClick={onClickToday}
            style={{background:"#EEF2FF",border:"1px solid #C7D2FE",color:"#4338CA",padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,display:"flex",alignItems:"center",gap:6,...fnt,transition:"all .12s"}}>
            📅 {today.length} tarea{today.length>1?"s":""} vence{today.length===1?"":"n"} HOY
          </button>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   MODALS
════════════════════════════════════════ */
function PasswordModal({dept,onSuccess,onViewOnly,onCancel}){
  const [pwd,setPwd]=useState(""); const [err,setErr]=useState(false);
  const check=()=>{if(!DEPT_PWD[dept]||DEPT_PWD[dept]===pwd)onSuccess();else{setErr(true);setPwd("");}};
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.6)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:CARD,borderRadius:16,padding:28,width:"100%",maxWidth:360,boxShadow:SHm}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          <div style={{width:36,height:36,borderRadius:10,background:DEPT_COLORS[dept]||PR,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{color:"#fff",fontSize:16}}>🔒</span></div>
          <div><div style={{fontSize:15,fontWeight:700,color:T1}}>Acceso a {dept}</div><div style={{fontSize:12,color:T2}}>Contraseña para agregar tareas</div></div>
        </div>
        <input type="password" value={pwd} onChange={e=>{setPwd(e.target.value);setErr(false);}} onKeyDown={e=>e.key==="Enter"&&check()} placeholder="Contraseña..." style={{...inp,marginBottom:8,borderColor:err?"#DC2626":BD}}/>
        {err&&<div style={{fontSize:12,color:"#DC2626",marginBottom:10}}>Contraseña incorrecta.</div>}
        <button onClick={check} style={{width:"100%",background:PR,color:"#fff",border:"none",padding:"11px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",marginBottom:8}}>Acceder con contraseña</button>
        <div style={{display:"flex",gap:8}}>
          <button onClick={onViewOnly} style={{flex:1,background:BG,border:`1px solid ${BD}`,color:T2,padding:"9px",borderRadius:8,fontSize:12,cursor:"pointer",fontWeight:500}}>Solo ver</button>
          <button onClick={onCancel} style={{flex:1,background:BG,border:`1px solid ${BD}`,color:T2,padding:"9px",borderRadius:8,fontSize:12,cursor:"pointer",fontWeight:500}}>Cancelar</button>
        </div>
        <div style={{marginTop:12,fontSize:11,color:T3,textAlign:"center"}}>Sin contraseña podrás ver tareas pero no agregar ni editar.</div>
      </div>
    </div>
  );
}
function DeleteModal({task,onConfirm,onCancel}){
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.6)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:CARD,borderRadius:16,padding:28,width:"100%",maxWidth:340,boxShadow:SHm,textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:16}}>🗑️</div>
        <h3 style={{fontSize:16,fontWeight:700,color:T1,marginBottom:8}}>¿Eliminar esta tarea?</h3>
        <p style={{fontSize:13,color:T2,marginBottom:4}}>"{task.title}"</p>
        <p style={{fontSize:12,color:"#DC2626",marginBottom:20}}>Esta acción no se puede deshacer.</p>
        <div style={{display:"flex",gap:10}}>
          <button onClick={onCancel} style={{flex:1,background:BG,border:`1px solid ${BD}`,color:T2,padding:"11px",borderRadius:8,fontSize:13,cursor:"pointer",fontWeight:500}}>Cancelar</button>
          <button onClick={onConfirm} style={{flex:1,background:"#DC2626",color:"#fff",border:"none",padding:"11px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer"}}>Eliminar</button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   SCREEN: LOGIN
════════════════════════════════════════ */
function ScreenLogin({onLogin}){
  return(
    <div style={{minHeight:"100vh",background:BG,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{width:"100%",maxWidth:420,padding:"0 24px"}}>
        <div style={{textAlign:"center",marginBottom:40}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:8,background:PR,borderRadius:12,padding:"10px 20px",marginBottom:28}}>
            <span style={{color:"#fff",fontSize:18}}>⚡</span><span style={{color:"#fff",fontWeight:700,fontSize:15,letterSpacing:.5}}>TASKOPS</span>
          </div>
          <h1 style={{color:T1,fontSize:26,fontWeight:700,marginBottom:6}}>Control de Tareas</h1>
          <p style={{color:T2,fontSize:13}}>Selecciona tu perfil para continuar</p>
        </div>
        <Card sx={{padding:8}}>
          {USERS.map(u=>(
            <button key={u.id} className="ub" onClick={()=>onLogin(u)}
              style={{width:"100%",background:"transparent",border:`1px solid ${BD}`,color:T1,padding:"11px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12,borderRadius:8,marginBottom:6,fontSize:13}}>
              <Av u={u} size={34}/>
              <div style={{textAlign:"left"}}><div style={{fontWeight:600,color:T1}}>{u.name}</div><div style={{fontSize:12,color:T2}}>{u.dept}</div></div>
            </button>
          ))}
        </Card>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   SCREEN: DASHBOARD
════════════════════════════════════════ */
function ScreenDashboard({tasks,user,onStatClick,onDeptClick,onPickerDeptClick,onNewTask,onSearch,onStats,onMyTasks,onCalendar}){
  const [pickerOpen,setPickerOpen]=useState(false);

  const deptCards=useMemo(()=>DEPTS.map(dept=>{
    const mine=tasks.filter(t=>t.responsible?.dept===dept||(t.invIds||[]).some(id=>USERS.find(x=>x.id===id)?.dept===dept));
    const active=mine.filter(isActive);
    const sorted=[...active].sort((a,b)=>({Alta:0,Media:1,Baja:2}[a.priority]||1)-({Alta:0,Media:1,Baja:2}[b.priority]||1));
    return{dept,active,nearest:sorted[0]||null,altas:active.filter(t=>t.priority==="Alta").length,venc:active.filter(t=>isOver(t.deadline,t.status)).length,today:active.filter(t=>isTodayDeadline(t.deadline)).length};
  }),[tasks]);

  const totals=useMemo(()=>({
    active:tasks.filter(isActive).length,
    alta:tasks.filter(t=>t.priority==="Alta"&&isActive(t)).length,
    venc:tasks.filter(t=>isOver(t.deadline,t.status)).length,
  }),[tasks]);

  return(
    <div style={{minHeight:"100vh",background:BG}}>
      <NavBar
        left={<Logo/>}
        center={<>
          <button className="nb" onClick={onSearch}>🔍 Buscar</button>
          <button className="nb" onClick={onMyTasks}>👤 Mis Tareas</button>
          <button className="nb" onClick={onCalendar}>📅 Calendario</button>
          <button className="nb" onClick={onStats}>📊 Estadísticas</button>
        </>}
        right={<>
          <button onClick={()=>setPickerOpen(p=>!p)}
            className={`nb${pickerOpen?" active":""}`}>
            <span>Departamentos</span><span style={{fontSize:10}}>{pickerOpen?"▲":"▼"}</span>
          </button>
          {pickerOpen&&(
            <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,background:CARD,border:`1px solid ${BD}`,borderRadius:12,boxShadow:SHm,width:240,padding:8,zIndex:100}}>
              {deptCards.map(d2=>(
                <div key={d2.dept} className="dp-item" onClick={()=>{onPickerDeptClick(d2.dept);setPickerOpen(false);}}
                  style={{padding:"10px 12px",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:10,height:10,borderRadius:"50%",background:dc(d2.dept),flexShrink:0}}/>
                    <span style={{fontSize:13,fontWeight:500,color:T1}}>{d2.dept}</span>
                  </div>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    {d2.venc>0&&<span style={{fontSize:10,color:"#DC2626",fontWeight:700}}>⚠{d2.venc}</span>}
                    <span style={{fontSize:12,fontWeight:700,color:dc(d2.dept),background:dc(d2.dept)+"15",padding:"2px 8px",borderRadius:20}}>{d2.active.length}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Av u={user} size={36}/>
        </>}
      />

      {/* Alert banner */}
      <AlertBanner tasks={tasks} onClickOverdue={()=>onStatClick("vencidas")} onClickToday={()=>onStatClick("today")}/>

      <div style={{maxWidth:1100,margin:"0 auto",padding:"20px 24px"}}>
        {/* Stats */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:24}}>
          {[
            {key:"active",   l:"Tareas activas",  v:totals.active, c:PR,        bg:PRl,       icon:"📋"},
            {key:"alta",     l:"Alta prioridad",   v:totals.alta,   c:"#DC2626", bg:"#FEF2F2", icon:"🔥"},
            {key:"vencidas", l:"Tareas vencidas",  v:totals.venc,   c:"#D97706", bg:"#FFFBEB", icon:"⚠️"},
          ].map(s=>(
            <Card key={s.key} cls="dc" sx={{padding:"16px 18px",display:"flex",alignItems:"center",gap:12,borderTop:`3px solid ${s.c}`}} onClick={()=>onStatClick(s.key)}>
              <div style={{width:40,height:40,borderRadius:10,background:s.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{s.icon}</div>
              <div>
                <div style={{fontSize:26,fontWeight:700,color:s.c,lineHeight:1}}>{s.v}</div>
                <div style={{fontSize:11,color:T2,marginTop:3}}>{s.l}</div>
              </div>
            </Card>
          ))}
        </div>

        {/* Dept widgets */}
        <div style={{fontSize:12,fontWeight:600,color:T2,marginBottom:12,letterSpacing:.5}}>PENDIENTES POR DEPARTAMENTO</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
          {deptCards.map(d2=>(
            <Card key={d2.dept} cls="dc" sx={{padding:18,borderLeft:`4px solid ${dc(d2.dept)}`}} onClick={()=>onDeptClick(d2.dept)}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                <div>
                  <div style={{width:9,height:9,borderRadius:"50%",background:dc(d2.dept),marginBottom:7}}/>
                  <div style={{fontSize:15,fontWeight:700,color:T1}}>{d2.dept}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:30,fontWeight:700,color:dc(d2.dept),lineHeight:1}}>{d2.active.length}</div>
                  <div style={{fontSize:10,color:T3}}>activas</div>
                </div>
              </div>
              {d2.nearest&&(
                <div style={{background:BG,borderRadius:8,padding:"9px 11px",marginBottom:10}}>
                  <div style={{fontSize:11,fontWeight:600,color:T2,marginBottom:2}}>Más urgente</div>
                  <div style={{fontSize:12,color:T1,fontWeight:500,marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d2.nearest.title}</div>
                  <div style={{fontSize:11,color:isOver(d2.nearest.deadline,d2.nearest.status)?"#DC2626":isTodayDeadline(d2.nearest.deadline)?"#4338CA":"#D97706",fontWeight:600}}>{fmtDate(d2.nearest.deadline)}</div>
                </div>
              )}
              {d2.active.length===0&&<div style={{fontSize:12,color:T3,fontStyle:"italic",marginBottom:10}}>Sin tareas activas</div>}
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {d2.altas>0&&<Badge ch={`🔥 ${d2.altas} Alta`}   c="#DC2626" bg="#FEF2F2"/>}
                {d2.venc>0 &&<Badge ch={`⚠️ ${d2.venc} Venc.`}  c="#D97706" bg="#FFFBEB"/>}
                {d2.today>0&&<Badge ch={`📅 ${d2.today} Hoy`}   c="#4338CA" bg="#EEF2FF"/>}
                {d2.altas===0&&d2.venc===0&&d2.today===0&&<span style={{fontSize:11,color:T3}}>Sin alertas</span>}
              </div>
            </Card>
          ))}
        </div>
      </div>

      <button onClick={onNewTask} className="fab"
        style={{position:"fixed",bottom:28,right:28,background:PR,color:"#fff",border:"none",width:56,height:56,fontSize:26,cursor:"pointer",borderRadius:"50%",boxShadow:"0 4px 20px rgba(67,56,202,.35)",zIndex:40,lineHeight:1}}>
        +
      </button>
    </div>
  );
}

/* ════════════════════════════════════════
   SCREEN: MIS TAREAS
════════════════════════════════════════ */
function ScreenMyTasks({tasks,user,onBack,onTaskClick}){
  const [tab,setTab]=useState("resp");

  const respTasks=useMemo(()=>tasks.filter(t=>t.responsible?.id===user.id&&isActive(t)).sort((a,b)=>({Alta:0,Media:1,Baja:2}[a.priority]||1)-({Alta:0,Media:1,Baja:2}[b.priority]||1)),[tasks,user]);
  const invTasks =useMemo(()=>tasks.filter(t=>(t.invIds||[]).includes(user.id)&&t.responsible?.id!==user.id&&isActive(t)).sort((a,b)=>({Alta:0,Media:1,Baja:2}[a.priority]||1)-({Alta:0,Media:1,Baja:2}[b.priority]||1)),[tasks,user]);
  const doneTasks=useMemo(()=>tasks.filter(t=>t.responsible?.id===user.id&&t.status==="Completada"),[tasks,user]);

  const list=tab==="resp"?respTasks:tab==="inv"?invTasks:doneTasks;

  return(
    <div style={{minHeight:"100vh",background:BG}}>
      <NavBar
        left={<><BackBtn onClick={onBack}/><div>
          <div style={{fontWeight:700,fontSize:15,color:T1}}>Mis Tareas</div>
          <div style={{fontSize:11,color:T2}}>{user.name} · {user.dept}</div>
        </div></>}
        center={null}
        right={<Av u={user} size={36}/>}
      />
      <div style={{maxWidth:900,margin:"0 auto",padding:"24px"}}>
        {/* Summary cards */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:24}}>
          {[
            {tab:"resp",label:"Soy responsable",v:respTasks.length,c:PR,bg:PRl},
            {tab:"inv", label:"Soy involucrado", v:invTasks.length, c:"#059669",bg:"#ECFDF5"},
            {tab:"done",label:"Completadas",      v:doneTasks.length,c:"#6B7280",bg:"#F9FAFB"},
          ].map(s=>(
            <Card key={s.tab} cls="dc" sx={{padding:"14px 16px",borderTop:`2px solid ${s.c}`,cursor:"pointer",outline:tab===s.tab?`2px solid ${s.c}`:"none"}} onClick={()=>setTab(s.tab)}>
              <div style={{fontSize:24,fontWeight:700,color:s.c,lineHeight:1}}>{s.v}</div>
              <div style={{fontSize:11,color:T2,marginTop:4}}>{s.label}</div>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <div style={{display:"flex",gap:8,marginBottom:20}}>
          {[["resp","Soy responsable"],["inv","Soy involucrado"],["done","Completadas"]].map(([v,l])=>(
            <button key={v} onClick={()=>setTab(v)}
              style={{background:tab===v?PR:CARD,color:tab===v?"#fff":T2,border:`1px solid ${tab===v?PR:BD}`,padding:"7px 14px",borderRadius:20,cursor:"pointer",fontSize:12,fontWeight:500,transition:"all .12s"}}>
              {l}
            </button>
          ))}
        </div>

        {list.length===0&&<div style={{textAlign:"center",padding:"60px 0",color:T3,fontSize:14}}>Sin tareas en esta sección</div>}
        {list.map(t=><TRow key={t.id} t={t} onClick={()=>onTaskClick(t)}/>)}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   SCREEN: FILTERED LIST
════════════════════════════════════════ */
function ScreenFilteredList({tasks,filter,user,onBack,onTaskClick}){
  const FCFG={
    active:  {label:"Tareas Activas",   fn:isActive},
    alta:    {label:"Alta Prioridad",   fn:t=>t.priority==="Alta"&&isActive(t)},
    vencidas:{label:"Tareas Vencidas",  fn:t=>isOver(t.deadline,t.status)},
    today:   {label:"Vencen Hoy",       fn:t=>isTodayDeadline(t.deadline)&&isActive(t)},
  };
  const cfg=FCFG[filter]||FCFG.active;
  const list=useMemo(()=>[...tasks.filter(cfg.fn)].sort((a,b)=>({Alta:0,Media:1,Baja:2}[a.priority]||1)-({Alta:0,Media:1,Baja:2}[b.priority]||1)),[tasks,filter]);
  return(
    <div style={{minHeight:"100vh",background:BG}}>
      <NavBar left={<><BackBtn onClick={onBack}/><div><div style={{fontWeight:700,fontSize:15,color:T1}}>{cfg.label}</div><div style={{fontSize:11,color:T2}}>{list.length} tarea{list.length!==1?"s":""}</div></div></>} center={null} right={null}/>
      <div style={{maxWidth:900,margin:"0 auto",padding:"24px"}}>
        {list.length===0&&<div style={{textAlign:"center",padding:"60px 0",color:T3,fontSize:14}}>No hay tareas con este filtro</div>}
        {list.map(t=><TRow key={t.id} t={t} onClick={()=>onTaskClick(t)}/>)}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   SCREEN: SEARCH
════════════════════════════════════════ */
function ScreenSearch({tasks,user,onBack,onTaskClick}){
  const [q,setQ]=useState("");
  const results=useMemo(()=>{
    if(!q.trim()) return [];
    const lq=q.toLowerCase();
    return tasks.filter(t=>t.title.toLowerCase().includes(lq)||t.description?.toLowerCase().includes(lq)||t.id.toLowerCase().includes(lq)||t.responsible?.name?.toLowerCase().includes(lq)||t.responsible?.dept?.toLowerCase().includes(lq)||t.type?.toLowerCase().includes(lq)).slice(0,20);
  },[tasks,q]);
  return(
    <div style={{minHeight:"100vh",background:BG}}>
      <NavBar
        left={<><BackBtn onClick={onBack}/><Logo/></>}
        center={<input value={q} onChange={e=>setQ(e.target.value)} autoFocus placeholder="Buscar por título, ID, responsable, departamento, tipo..." style={{...inp,width:"min(400px,60vw)",borderRadius:20}}/>}
        right={null}
      />
      <div style={{maxWidth:900,margin:"0 auto",padding:"24px"}}>
        {!q.trim()&&<div style={{textAlign:"center",padding:"60px 0",color:T3,fontSize:14}}>Empieza a escribir para buscar tareas...</div>}
        {q.trim()&&results.length===0&&<div style={{textAlign:"center",padding:"60px 0",color:T3,fontSize:14}}>Sin resultados para "{q}"</div>}
        {results.map(t=><TRow key={t.id} t={t} onClick={()=>onTaskClick(t)}/>)}
        {results.length>0&&<div style={{textAlign:"center",marginTop:12,fontSize:12,color:T3}}>{results.length} resultado{results.length!==1?"s":""}</div>}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   SCREEN: CALENDAR
════════════════════════════════════════ */
function ScreenCalendar({tasks,user,onBack,onTaskClick}){
  const now=new Date();
  const [month,setMonth]=useState(now.getMonth());
  const [year,setYear] =useState(now.getFullYear());
  const [selDay,setSelDay]=useState(null);

  const monthTasks=useMemo(()=>tasks.filter(t=>{
    if(!t.deadline) return false;
    const d=new Date(t.deadline+"T12:00:00");
    return d.getMonth()===month&&d.getFullYear()===year;
  }),[tasks,month,year]);

  const dayMap=useMemo(()=>{
    const m={};
    monthTasks.forEach(t=>{
      const day=new Date(t.deadline+"T12:00:00").getDate();
      if(!m[day]) m[day]=[];
      m[day].push(t);
    });
    return m;
  },[monthTasks]);

  const selDayTasks=useMemo(()=>selDay?(dayMap[selDay]||[]):[],[dayMap,selDay]);

  const firstDayOfMonth=new Date(year,month,1).getDay();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const prevMonth=()=>{if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1);setSelDay(null);};
  const nextMonth=()=>{if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1);setSelDay(null);};

  const todayDay=now.getDate(),todayMonth=now.getMonth(),todayYear=now.getFullYear();
  const isToday=(d)=>d===todayDay&&month===todayMonth&&year===todayYear;

  // Build grid
  const cells=[];
  for(let i=0;i<firstDayOfMonth;i++) cells.push(null);
  for(let d=1;d<=daysInMonth;d++) cells.push(d);
  while(cells.length%7!==0) cells.push(null);

  return(
    <div style={{minHeight:"100vh",background:BG}}>
      <NavBar
        left={<><BackBtn onClick={onBack}/><div><div style={{fontWeight:700,fontSize:15,color:T1}}>Calendario</div><div style={{fontSize:11,color:T2}}>{MONTHS_ES[month]} {year}</div></div></>}
        center={null}
        right={<div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={prevMonth} className="nb" style={{padding:"6px 10px"}}>←</button>
          <button onClick={()=>{setMonth(now.getMonth());setYear(now.getFullYear());setSelDay(now.getDate());}} className="nb" style={{padding:"6px 12px",fontSize:12}}>Hoy</button>
          <button onClick={nextMonth} className="nb" style={{padding:"6px 10px"}}>→</button>
        </div>}
      />
      <div style={{maxWidth:900,margin:"0 auto",padding:"24px"}}>
        <Card sx={{padding:20,marginBottom:20}}>
          {/* Day labels */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:8}}>
            {DAYS_ES.map(d=><div key={d} style={{textAlign:"center",fontSize:11,fontWeight:600,color:T3,padding:"4px 0"}}>{d}</div>)}
          </div>
          {/* Calendar grid */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
            {cells.map((day,i)=>{
              if(!day) return <div key={i}/>;
              const dayTasks=dayMap[day]||[];
              const hasTasks=dayTasks.length>0;
              const hasOverdue=dayTasks.some(t=>isOver(t.deadline,t.status));
              const hasAlta=dayTasks.some(t=>t.priority==="Alta"&&isActive(t));
              const selected=selDay===day;
              const today=isToday(day);
              return(
                <div key={i} className="cal-day" onClick={()=>setSelDay(selected?null:day)}
                  style={{borderRadius:8,padding:"8px 4px",minHeight:60,textAlign:"center",background:selected?PRl:today?"#EEF2FF":"transparent",border:selected?`1.5px solid ${PR}`:today?`1.5px solid ${PR}33`:"1px solid transparent",cursor:hasTasks?"pointer":"default"}}>
                  <div style={{fontSize:13,fontWeight:today||selected?700:400,color:today?PR:T1,marginBottom:4}}>{day}</div>
                  {hasTasks&&(
                    <div style={{display:"flex",gap:3,flexWrap:"wrap",justifyContent:"center"}}>
                      {dayTasks.slice(0,4).map((t,j)=>(
                        <div key={j} style={{width:7,height:7,borderRadius:"50%",background:hasOverdue?"#DC2626":hasAlta?"#F59E0B":dc(t.responsible?.dept||"Dirección"),flexShrink:0}}/>
                      ))}
                      {dayTasks.length>4&&<div style={{fontSize:9,color:T3}}>+{dayTasks.length-4}</div>}
                    </div>
                  )}
                  {hasTasks&&<div style={{fontSize:10,color:T3,marginTop:2}}>{dayTasks.length}</div>}
                </div>
              );
            })}
          </div>
        </Card>

        {/* Legend */}
        <div style={{display:"flex",gap:16,marginBottom:20,flexWrap:"wrap"}}>
          {[["⚫","Vencida","#DC2626"],["🟡","Alta prio.","#F59E0B"],["●","Por depto.","#4338CA"]].map(([i,l,c])=>(
            <div key={l} style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:c}}/>
              <span style={{fontSize:11,color:T2}}>{l}</span>
            </div>
          ))}
          <span style={{fontSize:11,color:T3}}>Haz clic en un día para ver sus tareas</span>
        </div>

        {/* Selected day tasks */}
        {selDay&&(
          <>
            <div style={{fontSize:12,fontWeight:600,color:T2,marginBottom:12}}>
              {selDayTasks.length>0?`TAREAS DEL ${selDay} DE ${MONTHS_ES[month].toUpperCase()}`:`SIN TAREAS EL ${selDay} DE ${MONTHS_ES[month].toUpperCase()}`}
            </div>
            {selDayTasks.length===0&&<div style={{textAlign:"center",padding:"40px 0",color:T3,fontSize:13}}>Ninguna tarea tiene deadline este día</div>}
            {selDayTasks.map(t=><TRow key={t.id} t={t} onClick={()=>onTaskClick(t)}/>)}
          </>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   SCREEN: STATS
════════════════════════════════════════ */
function ScreenStats({tasks,user,onBack,onResetData}){
  const statusData=useMemo(()=>Object.entries(SC).map(([s,c])=>({name:s,value:tasks.filter(t=>t.status===s).length,color:c.c})).filter(d=>d.value>0),[tasks]);
  const typeData  =useMemo(()=>Object.entries(TT).map(([t,c])=>({name:t,value:tasks.filter(tk=>tk.type===t).length,color:c.c})).filter(d=>d.value>0),[tasks]);
  const deptData  =useMemo(()=>DEPTS.map(dept=>({dept:dept.length>11?dept.substring(0,11)+"…":dept,tasks:tasks.filter(t=>t.responsible?.dept===dept&&isActive(t)).length,color:dc(dept)})).filter(d=>d.tasks>0).sort((a,b)=>b.tasks-a.tasks),[tasks]);
  const prioData  =useMemo(()=>Object.entries(PC).map(([p,c])=>({name:p,value:tasks.filter(t=>t.priority===p&&isActive(t)).length,color:c.c})),[tasks]);
  const completed=tasks.filter(t=>t.status==="Completada").length;
  const completedPct=tasks.length>0?Math.round(completed/tasks.length*100):0;

  return(
    <div style={{minHeight:"100vh",background:BG}}>
      <NavBar
        left={<><BackBtn onClick={onBack}/><div><div style={{fontWeight:700,fontSize:15,color:T1}}>Estadísticas</div><div style={{fontSize:11,color:T2}}>{tasks.length} tareas en total</div></div></>}
        center={null}
        right={user.dept==="Dirección"&&<button onClick={onResetData} style={{background:"#FEF2F2",border:"1px solid #FECACA",color:"#DC2626",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>Reiniciar datos</button>}
      />
      <div style={{maxWidth:1100,margin:"0 auto",padding:"28px 24px"}}>
        {/* KPIs */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
          {[
            {l:"Total tareas",    v:tasks.length,                                   c:PR,        bg:PRl},
            {l:"Activas",         v:tasks.filter(isActive).length,                  c:"#D97706", bg:"#FFFBEB"},
            {l:"Completadas",     v:completed,                                       c:"#059669", bg:"#ECFDF5"},
            {l:"% Completadas",   v:`${completedPct}%`,                             c:"#4338CA", bg:"#EEF2FF"},
          ].map(s=>(
            <Card key={s.l} sx={{padding:"16px 18px",borderTop:`2px solid ${s.c}`}}>
              <div style={{fontSize:26,fontWeight:700,color:s.c,lineHeight:1}}>{s.v}</div>
              <div style={{fontSize:11,color:T2,marginTop:4}}>{s.l}</div>
            </Card>
          ))}
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginBottom:20}}>
          <Card sx={{padding:20}}>
            <Lbl ch="TAREAS POR ESTADO"/>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={statusData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({name,value})=>`${name}:${value}`} labelLine={false} fontSize={10}>
                  {statusData.map((d,i)=><Cell key={i} fill={d.color}/>)}
                </Pie>
                <Tooltip/>
              </PieChart>
            </ResponsiveContainer>
          </Card>
          <Card sx={{padding:20}}>
            <Lbl ch="TAREAS POR TIPO"/>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={typeData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({name,value})=>`${name}:${value}`} fontSize={10}>
                  {typeData.map((d,i)=><Cell key={i} fill={d.color}/>)}
                </Pie>
                <Tooltip/>
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </div>

        <Card sx={{padding:20,marginBottom:20}}>
          <Lbl ch="TAREAS ACTIVAS POR PRIORIDAD"/>
          <ResponsiveContainer width="100%" height={80}>
            <BarChart data={prioData} layout="vertical" margin={{left:50}}>
              <XAxis type="number" hide/>
              <YAxis type="category" dataKey="name" tick={{fontSize:12,fill:T2}} axisLine={false} tickLine={false}/>
              <Tooltip/>
              <Bar dataKey="value" radius={[0,4,4,0]}>{prioData.map((d,i)=><Cell key={i} fill={d.color}/>)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {deptData.length>0&&(
          <Card sx={{padding:20}}>
            <Lbl ch="CARGA POR DEPARTAMENTO (responsable de tarea activa)"/>
            <ResponsiveContainer width="100%" height={Math.max(deptData.length*36,100)}>
              <BarChart data={deptData} layout="vertical" margin={{left:100}}>
                <XAxis type="number" hide/>
                <YAxis type="category" dataKey="dept" tick={{fontSize:11,fill:T2}} axisLine={false} tickLine={false}/>
                <Tooltip formatter={v=>[`${v} tareas`,""]}/>
                <Bar dataKey="tasks" radius={[0,4,4,0]}>{deptData.map((d,i)=><Cell key={i} fill={d.color}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   SCREEN: DEPT DETAIL
════════════════════════════════════════ */
function ScreenDeptDetail({dept,tasks,user,onBack,onTaskClick,onNewTask,canAdd}){
  const [filter,setFilter]=useState("all");
  const deptTasks=useMemo(()=>{
    const mine=tasks.filter(t=>t.responsible?.dept===dept||(t.invIds||[]).some(id=>USERS.find(x=>x.id===id)?.dept===dept));
    const active=mine.filter(isActive);
    const filtered=filter==="all"?active:active.filter(t=>t.status===filter||t.priority===filter);
    return [...filtered].sort((a,b)=>({Alta:0,Media:1,Baja:2}[a.priority]||1)-({Alta:0,Media:1,Baja:2}[b.priority]||1));
  },[tasks,dept,filter]);
  const FILTERS=[["all","Todas"],["Alta","Alta prio."],["Bloqueada","Bloqueadas"],["En proceso","En proceso"],["Pendiente","Pendientes"]];
  return(
    <div style={{minHeight:"100vh",background:BG}}>
      <NavBar
        left={<><BackBtn onClick={onBack}/><div>
          <div style={{fontWeight:700,fontSize:15,color:T1,display:"flex",alignItems:"center",gap:8}}><div style={{width:9,height:9,borderRadius:"50%",background:dc(dept)}}/>{dept}</div>
          <div style={{fontSize:11,color:T2}}>{deptTasks.length} tarea{deptTasks.length!==1?"s":""} activa{deptTasks.length!==1?"s":""}</div>
        </div></>}
        center={null}
        right={<>
          {!canAdd&&<Badge ch="🔒 Solo vista" c={T2} bg={BG}/>}
          {canAdd&&<button onClick={onNewTask} style={{background:PR,color:"#fff",border:"none",padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>+ Nueva tarea</button>}
        </>}
      />
      <div style={{maxWidth:900,margin:"0 auto",padding:"24px"}}>
        <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
          {FILTERS.map(([v,l])=>(
            <button key={v} onClick={()=>setFilter(v)}
              style={{background:filter===v?PR:CARD,color:filter===v?"#fff":T2,border:`1px solid ${filter===v?PR:BD}`,padding:"7px 14px",borderRadius:20,cursor:"pointer",fontSize:12,fontWeight:500,transition:"all .12s"}}>
              {l}
            </button>
          ))}
        </div>
        {deptTasks.length===0&&<div style={{textAlign:"center",padding:"60px 0",color:T3,fontSize:14}}>Sin tareas con este filtro</div>}
        {deptTasks.map(t=><TRow key={t.id} t={t} onClick={()=>onTaskClick(t)}/>)}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   SCREEN: TASK DETAIL
════════════════════════════════════════ */
function ScreenTaskDetail({taskId,tasks,user,onBack,onUpdate,onEdit,onDelete}){
  const [comment,setComment]=useState("");
  const [recOn,setRecOn]=useState(false);
  const [recErr,setRecErr]=useState(false);
  const recRef=useRef(null);
  const task=useMemo(()=>tasks.find(t=>t.id===taskId)||null,[tasks,taskId]);

  const startVoice=()=>{
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){setRecErr(true);return;}
    const r=new SR();r.lang="es-MX";r.continuous=false;r.interimResults=false;
    r.onresult=e=>{setComment(p=>(p+" "+e.results[0][0].transcript).trim());};
    r.onerror=()=>{setRecErr(true);setRecOn(false);};r.onend=()=>setRecOn(false);
    r.start();recRef.current=r;setRecOn(true);setRecErr(false);
  };
  const stopVoice=()=>{recRef.current?.stop();setRecOn(false);};
  const sendComment=()=>{
    if(!comment.trim()) return;
    const c={user,text:comment,time:new Date().toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"})};
    onUpdate(taskId,{comments:[...(task?.comments||[]),c]});setComment("");
  };

  if(!task) return <div style={{padding:40,color:T2}}>Tarea no encontrada</div>;
  const tt=TT[task.type]||{c:T2,bg:"#F9FAFB"};
  const sc=SC[task.status];const pc=PC[task.priority];const ov=isOver(task.deadline,task.status);
  const canEdit=task.responsible?.id===user.id||user.dept==="Dirección";
  const invIds=task.invIds||[];const flowStates=task.flowStates||{};
  const pct=calcProgress(invIds,flowStates);

  return(
    <div style={{minHeight:"100vh",background:BG}}>
      <NavBar
        left={<><BackBtn onClick={onBack}/><div>
          <div style={{fontWeight:700,fontSize:14,color:T1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:260}}>{task.title}</div>
          <div style={{fontSize:11,color:T2}}>{task.id} · {task.type}</div>
        </div></>}
        center={null}
        right={<div style={{display:"flex",gap:8}}>
          {canEdit&&<button onClick={()=>onEdit(task)} style={{background:PRl,color:PR,border:`1px solid ${PR}`,padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>✏️ Editar</button>}
          {user.dept==="Dirección"&&<button onClick={()=>onDelete(task)} style={{background:"#FEF2F2",color:"#DC2626",border:"1px solid #FECACA",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>🗑️</button>}
        </div>}
      />
      <div style={{maxWidth:860,margin:"0 auto",padding:"24px"}}>
        {/* Header card */}
        <Card sx={{padding:24,marginBottom:16,borderLeft:`4px solid ${dc(task.responsible?.dept||"Dirección")}`}}>
          <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
            <Badge ch={task.type} c={tt.c} bg={tt.bg}/><Badge ch={task.priority} c={pc.c} bg={pc.bg}/><Badge ch={task.status} c={sc.c} bg={sc.bg}/>
            {ov&&<Badge ch="⚠ VENCIDA" c="#DC2626" bg="#FEF2F2"/>}
            {isTodayDeadline(task.deadline)&&isActive(task)&&<Badge ch="📅 Vence HOY" c="#4338CA" bg="#EEF2FF"/>}
          </div>
          <h2 style={{fontSize:20,fontWeight:700,color:T1,marginBottom:8}}>{task.title}</h2>
          <p style={{fontSize:13,color:T2,lineHeight:1.7,marginBottom:pct!==null?12:0}}>{task.description||"Sin descripción."}</p>
          {pct!==null&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:11,color:T2,fontWeight:600}}>Progreso del flujo</span>
                <span style={{fontSize:11,fontWeight:700,color:pct===100?"#059669":pct>=50?"#D97706":"#6B7280"}}>{pct}%</span>
              </div>
              <div style={{height:6,background:BD,borderRadius:4,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${pct}%`,background:pct===100?"#059669":pct>=50?"#D97706":"#6B7280",borderRadius:4,transition:"width .3s"}}/>
              </div>
            </div>
          )}
        </Card>

        <div style={{display:"grid",gridTemplateColumns:"1fr 260px",gap:16}}>
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            {/* Status */}
            {canEdit&&(
              <Card sx={{padding:18}}>
                <Lbl ch="CAMBIAR ESTADO"/>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {Object.entries(SC).map(([s,c])=>(
                    <button key={s} onClick={()=>onUpdate(taskId,{status:s})}
                      style={{background:task.status===s?c.c:CARD,color:task.status===s?"#fff":c.c,border:`1.5px solid ${c.c}`,padding:"8px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,transition:"all .12s"}}>
                      {s}
                    </button>
                  ))}
                </div>
              </Card>
            )}
            {/* Flow diagram */}
            <Card sx={{padding:20}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                <Lbl ch="DIAGRAMA DE FLUJO — INVOLUCRADOS"/>
                {canEdit&&<span style={{fontSize:11,color:T3}}>↑↓ para reordenar</span>}
              </div>
              <FlowDiagram invIds={invIds} flowStates={flowStates}
                onReorder={ids=>onUpdate(taskId,{invIds:ids})}
                onStateChange={(uid,st)=>onUpdate(taskId,{flowStates:{...flowStates,[uid]:st}})}
                canEdit={canEdit}/>
            </Card>
            {/* Comments */}
            <Card sx={{padding:20}}>
              <Lbl ch="COMENTARIOS Y SEGUIMIENTO"/>
              {task.comments.length===0&&<div style={{color:T3,fontSize:13,textAlign:"center",padding:"20px 0"}}>Sin comentarios aún</div>}
              <div style={{display:"flex",flexDirection:"column",gap:14,marginBottom:16}}>
                {task.comments.map((c,i)=>(
                  <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                    <Av u={c.user} size={30}/>
                    <div style={{flex:1,background:BG,borderRadius:10,padding:"10px 14px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                        <span style={{fontSize:12,fontWeight:600,color:T1}}>{c.user.name}</span>
                        <span style={{fontSize:11,color:T3}}>{c.time}</span>
                      </div>
                      <p style={{fontSize:13,color:T2,lineHeight:1.6}}>{c.text}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{border:`1px solid ${BD}`,borderRadius:10,overflow:"hidden"}}>
                <textarea value={comment} onChange={e=>setComment(e.target.value)} rows={3} placeholder="Escribe o dicta una actualización..." style={{...inp,border:"none",borderRadius:0,padding:"12px 14px"}}/>
                <div style={{background:BG,padding:"8px 12px",display:"flex",justifyContent:"space-between",alignItems:"center",borderTop:`1px solid ${BD}`}}>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <button onClick={recOn?stopVoice:startVoice} className={recOn?"pl":""}
                      style={{background:recOn?"#FEF2F2":CARD,border:`1px solid ${recOn?"#DC2626":BD}`,color:recOn?"#DC2626":T2,padding:"6px 12px",borderRadius:8,cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",gap:6}}>
                      <span>{recOn?"⏹":"🎙️"}</span><span>{recOn?"Detener":"Dictar"}</span>
                    </button>
                    {recErr&&<span style={{fontSize:11,color:"#DC2626"}}>Usa Chrome</span>}
                  </div>
                  <button onClick={sendComment} style={{background:comment.trim()?PR:"#E2E8F0",color:comment.trim()?"#fff":T3,border:"none",padding:"8px 18px",borderRadius:8,cursor:comment.trim()?"pointer":"default",fontSize:13,fontWeight:600,transition:"all .12s"}}>Enviar</button>
                </div>
              </div>
            </Card>
          </div>
          {/* Sidebar */}
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <Card sx={{padding:16}}><Lbl ch="RESPONSABLE"/>{task.responsible&&<div style={{display:"flex",alignItems:"center",gap:10}}><Av u={task.responsible} size={36}/><div><div style={{fontSize:13,fontWeight:600,color:T1}}>{task.responsible.name}</div><div style={{fontSize:11,color:T2}}>{task.responsible.dept}</div></div></div>}</Card>
            <Card sx={{padding:16}}><Lbl ch="DEPTO. ORIGEN"/><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:9,height:9,borderRadius:"50%",background:dc(task.creator?.dept||"Dirección")}}/><span style={{fontSize:13,color:T1,fontWeight:500}}>{task.creator?.dept||"—"}</span></div></Card>
            <Card sx={{padding:16}}><Lbl ch="FECHA LÍMITE"/><div style={{fontSize:15,fontWeight:700,color:ov?"#DC2626":isTodayDeadline(task.deadline)?"#4338CA":"#D97706"}}>{fmtDate(task.deadline)}</div><div style={{fontSize:11,color:T3,marginTop:2}}>{task.deadline}</div></Card>
            <Card sx={{padding:16}}><Lbl ch="TIPO · PRIORIDAD"/><div style={{display:"flex",gap:6,flexWrap:"wrap"}}><Badge ch={task.type} c={tt.c} bg={tt.bg}/><Badge ch={task.priority} c={pc.c} bg={pc.bg}/></div></Card>
            <Card sx={{padding:16}}><Lbl ch="ORIGEN"/><div style={{fontSize:13,color:T1}}>{task.origin}</div></Card>
            {invIds.length>0&&(
              <Card sx={{padding:16}}><Lbl ch="INVOLUCRADOS (en orden)"/>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {getInvolved(invIds).map((inv,i)=>(
                    <div key={inv.id} style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:20,height:20,borderRadius:"50%",background:dc(inv.dept),display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{color:"#fff",fontSize:10,fontWeight:700}}>{i+1}</span></div>
                      <div><div style={{fontSize:12,fontWeight:500,color:T1}}>{inv.name}</div><div style={{fontSize:10,color:T2}}>{inv.dept}</div></div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   SCREEN: CREATE / EDIT TASK
════════════════════════════════════════ */
function ScreenCreate({user,taskCount,onSave,onCancel,defaultDept,taskToEdit}){
  const isEdit=!!taskToEdit;
  const [step,setStep]=useState(isEdit?"form":"capture");
  const [mode,setMode]=useState(""); const [rawText,setRawText]=useState("");
  const [imgFile,setImgFile]=useState(null); const [imgPrev,setImgPrev]=useState(null);
  const [recOn,setRecOn]=useState(false); const [loading,setLoading]=useState(false);
  const [aiDone,setAiDone]=useState(false); const [err,setErr]=useState(""); const [drag,setDrag]=useState(false);
  const [form,setForm]=useState(()=>{
    if(isEdit) return{type:taskToEdit.type||"",title:taskToEdit.title||"",description:taskToEdit.description||"",respId:taskToEdit.responsible?String(taskToEdit.responsible.id):"",invIds:taskToEdit.invIds||[],deadline:taskToEdit.deadline||"",priority:taskToEdit.priority||"Media",origin:taskToEdit.origin||"Sistema"};
    const dr=defaultDept?USERS.find(u=>u.dept===defaultDept):null;
    return{...BLANK,respId:dr?String(dr.id):""};
  });
  const recRef=useRef(null); const fileRef=useRef(null);

  const startRec=()=>{const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){setErr("Voz no disponible. Usa Chrome.");return;}const r=new SR();r.lang="es-MX";r.continuous=true;r.interimResults=false;r.onresult=e=>{const t=Array.from(e.results).map(x=>x[0].transcript).join(" ");setRawText(p=>(p+" "+t).trim());};r.onerror=()=>{setErr("Error de micrófono.");setRecOn(false);};r.onend=()=>setRecOn(false);r.start();recRef.current=r;setRecOn(true);setErr("");};
  const stopRec=()=>{recRef.current?.stop();setRecOn(false);};
  const pickImg=f=>{if(!f||!f.type.startsWith("image/")){setErr("Imagen inválida.");return;}setImgFile(f);setErr("");const rd=new FileReader();rd.onload=e=>setImgPrev(e.target.result);rd.readAsDataURL(f);};
  const runAI=async()=>{
    const hasT=mode!=="image"&&rawText.trim().length>2,hasI=mode==="image"&&imgFile;
    if(!hasT&&!hasI){setErr("Agrega contenido primero.");return;}
    setLoading(true);setErr("");
    try{
      const sys=`Extrae info de tarea. Solo JSON:\n{"title":"","description":"","type":"Operativa|Administrativa|Proyecto","priority":"Alta|Media|Baja","origin":"Verbal|Junta|WhatsApp-Correo|Sistema","responsibleDept":"${DEPTS.join("|")}","involvedDepts":[],"deadlineDays":3}`;
      const msgs=mode==="image"?[{role:"user",content:[{type:"image",source:{type:"base64",media_type:imgFile.type,data:imgPrev.split(",")[1]}},{type:"text",text:"Extrae info de tarea. JSON."}]}]:[{role:"user",content:`Extrae: "${rawText}"`}];
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:800,system:sys,messages:msgs})});
      const data=await res.json();
      const raw=(data.content||[]).map(c=>c.text||"").join("").replace(/```json|```/g,"").trim();
      const p=JSON.parse(raw);
      const dl=new Date();dl.setDate(dl.getDate()+(parseInt(p.deadlineDays)||3));
      const resp=USERS.find(u=>u.dept===p.responsibleDept);
      const ids=(p.involvedDepts||[]).map(d=>USERS.find(u=>u.dept===d)?.id).filter(Boolean);
      setForm({type:Object.keys(TT).includes(p.type)?p.type:"",title:p.title||"",description:p.description||"",priority:["Alta","Media","Baja"].includes(p.priority)?p.priority:"Media",origin:["Verbal","Junta","WhatsApp-Correo","Sistema"].includes(p.origin)?p.origin:"Sistema",respId:resp?String(resp.id):"",invIds:ids,deadline:dl.toISOString().split("T")[0]});
      setAiDone(true);setStep("form");
    }catch(e){setErr("No se pudo procesar. Intenta manualmente.");}
    setLoading(false);
  };

  const toggleInv=id=>setForm(p=>({...p,invIds:p.invIds.includes(id)?p.invIds.filter(x=>x!==id):[...p.invIds,id]}));
  const canSave=form.type&&form.title&&form.respId&&form.deadline;
  const doSave=()=>{
    if(!canSave) return;
    const fs=form.invIds.reduce((acc,id)=>({...acc,[id]:isEdit?(taskToEdit.flowStates?.[id]||"Pendiente"):"Pendiente"}),{});
    if(isEdit) onSave({type:form.type,title:form.title,description:form.description,responsible:USERS.find(u=>u.id===parseInt(form.respId)),invIds:form.invIds,flowStates:fs,deadline:form.deadline,priority:form.priority,origin:form.origin});
    else onSave({id:`TSK-${String(taskCount+1).padStart(3,"0")}`,type:form.type,title:form.title,description:form.description,creator:user,responsible:USERS.find(u=>u.id===parseInt(form.respId)),invIds:form.invIds,flowStates:fs,deadline:form.deadline,priority:form.priority,origin:form.origin,status:"Pendiente",comments:[],confirmed:[]});
  };

  return(
    <div style={{minHeight:"100vh",background:BG}}>
      <NavBar
        left={<><BackBtn onClick={onCancel}/><div style={{fontWeight:700,fontSize:15,color:T1}}>{isEdit?"Editar Tarea":"Nueva Tarea"}</div></>}
        center={null}
        right={!isEdit&&<div style={{display:"flex",gap:6,alignItems:"center"}}>{["capture","form"].map((s,i)=>(
          <div key={s} style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:22,height:22,borderRadius:"50%",background:step===s?PR:BD,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{color:step===s?"#fff":T3,fontSize:11,fontWeight:700}}>{i+1}</span></div>
            {i<1&&<div style={{width:18,height:2,background:step==="form"?PR:BD,borderRadius:2}}/>}
          </div>
        ))}</div>}
      />
      <div style={{maxWidth:680,margin:"0 auto",padding:"28px 24px"}}>
        {step==="capture"&&(
          <div style={{display:"flex",flexDirection:"column",gap:20}}>
            <div><h2 style={{fontSize:18,fontWeight:700,color:T1,marginBottom:4}}>¿Cómo capturas la tarea?</h2><p style={{fontSize:13,color:T2}}>La IA extrae automáticamente toda la información</p></div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
              {[["text","✍️","Texto","Escribe libremente"],["voice","🎙️","Voz","Habla y se transcribe"],["image","📷","Imagen","Foto o captura"]].map(([id,ic,lb,dd])=>(
                <button key={id} className={"im"+(mode===id?" on":"")} onClick={()=>{setMode(id);setRawText("");setImgFile(null);setImgPrev(null);setErr("");}}
                  style={{background:mode===id?PRl:CARD,border:`2px solid ${mode===id?PR:BD}`,borderRadius:12,padding:"20px 12px",cursor:"pointer",textAlign:"center",boxShadow:SH}}>
                  <div style={{fontSize:28,marginBottom:8}}>{ic}</div><div style={{fontSize:13,fontWeight:600,color:mode===id?PR:T1,marginBottom:3}}>{lb}</div><div style={{fontSize:11,color:T3}}>{dd}</div>
                </button>
              ))}
            </div>
            {mode==="text"&&<div><Lbl ch="DESCRIBE LA TAREA"/><textarea value={rawText} onChange={e=>setRawText(e.target.value)} rows={5} placeholder="Ej: Producción necesita revisar soldadura en línea 2. Cliente exige entrega mañana..." style={{...inp,lineHeight:1.7,borderRadius:10}}/></div>}
            {mode==="voice"&&<div><Lbl ch="GRABACIÓN"/>
              <div style={{background:CARD,border:`1px solid ${BD}`,borderRadius:12,padding:28,textAlign:"center",boxShadow:SH}}>
                {recOn?<button onClick={stopRec} className="pl" style={{background:"#FEF2F2",border:"3px solid #FECACA",color:"#DC2626",borderRadius:"50%",width:72,height:72,fontSize:26,cursor:"pointer",marginBottom:12}}>⏹</button>:<button onClick={startRec} style={{background:"#FEF2F2",border:"none",color:"#DC2626",borderRadius:"50%",width:72,height:72,fontSize:26,cursor:"pointer",marginBottom:12}}>🎙️</button>}
                <div style={{fontSize:12,fontWeight:600,color:recOn?"#DC2626":T3}}>{recOn?"● GRABANDO — toca para detener":"Toca para hablar"}</div>
              </div>
              {rawText&&<div style={{marginTop:12}}><Lbl ch="TRANSCRIPCIÓN (editable)"/><textarea value={rawText} onChange={e=>setRawText(e.target.value)} rows={4} style={{...inp,borderRadius:10,lineHeight:1.7}}/></div>}
            </div>}
            {mode==="image"&&<div><Lbl ch="IMAGEN"/>
              <div className={"dz"+(drag?" ov":"")} style={{padding:32,textAlign:"center",cursor:"pointer"}} onClick={()=>fileRef.current?.click()} onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);pickImg(e.dataTransfer.files[0]);}}>
                {imgPrev?<div><img src={imgPrev} alt="" style={{maxHeight:180,maxWidth:"100%",borderRadius:8,marginBottom:8}}/><div style={{fontSize:12,color:PR,fontWeight:600}}>Imagen lista · toca para cambiar</div></div>:<div><div style={{fontSize:36,marginBottom:10}}>📷</div><div style={{fontSize:13,fontWeight:600,color:T2}}>Pizarra, nota, captura</div><div style={{fontSize:12,color:T3,marginTop:4}}>Arrastra o toca</div></div>}
              </div>
              <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>pickImg(e.target.files[0])}/>
            </div>}
            {err&&<div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#DC2626"}}>{err}</div>}
            {mode&&<button onClick={runAI} disabled={loading} style={{background:loading?"#E2E8F0":PR,color:loading?T3:"#fff",border:"none",padding:"14px",fontSize:13,fontWeight:700,cursor:loading?"not-allowed":"pointer",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>{loading&&<span className="sp">⟳</span>}{loading?"Analizando con IA...":"⚡ Procesar con IA y continuar"}</button>}
            <div style={{display:"flex",alignItems:"center",gap:10,color:T3}}><div style={{flex:1,height:1,background:BD}}/><span style={{fontSize:12}}>o</span><div style={{flex:1,height:1,background:BD}}/></div>
            <button onClick={()=>setStep("form")} style={{background:CARD,border:`1px solid ${BD}`,color:T2,padding:"12px",fontSize:13,cursor:"pointer",borderRadius:10,fontWeight:500}}>Llenar formulario manualmente →</button>
          </div>
        )}
        {step==="form"&&(
          <div style={{display:"flex",flexDirection:"column",gap:22}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <h2 style={{fontSize:18,fontWeight:700,color:T1,marginBottom:6}}>{isEdit?"Editar detalles":"Detalles de la tarea"}</h2>
                {aiDone&&<div style={{background:"#ECFDF5",border:"1px solid #A7F3D0",borderRadius:8,padding:"6px 12px",display:"inline-flex",alignItems:"center",gap:6}}><span>⚡</span><span style={{fontSize:12,fontWeight:600,color:"#059669"}}>Rellenado por IA — verifica</span></div>}
              </div>
              {!isEdit&&<button onClick={()=>setStep("capture")} style={{background:"none",border:"none",color:T2,cursor:"pointer",fontSize:13}}>← Volver</button>}
            </div>
            <div><Lbl ch="TIPO DE TAREA *"/>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                {Object.entries(TT).map(([tp,tt2])=>{const a=form.type===tp;return<button key={tp} onClick={()=>setForm(p=>({...p,type:tp}))} style={{background:a?tt2.c:CARD,color:a?"#fff":tt2.c,border:`2px solid ${a?tt2.c:tt2.bg}`,padding:"12px 8px",borderRadius:10,cursor:"pointer",fontSize:12,fontWeight:600,transition:"all .12s"}}>{tp}</button>;})}
              </div>
            </div>
            <div><Lbl ch="PRIORIDAD"/>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                {Object.entries(PC).map(([p,pc2])=>{const a=form.priority===p;return<button key={p} onClick={()=>setForm(prev=>({...prev,priority:p}))} style={{background:a?pc2.c:CARD,color:a?"#fff":pc2.c,border:`2px solid ${a?pc2.c:pc2.bg}`,padding:"12px",borderRadius:10,cursor:"pointer",fontSize:13,fontWeight:600,transition:"all .12s"}}>{p}</button>;})}
              </div>
            </div>
            <div><Lbl ch="ORIGEN"/>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {["Verbal","Junta","WhatsApp-Correo","Sistema"].map(o=>{const a=form.origin===o;return<button key={o} onClick={()=>setForm(p=>({...p,origin:o}))} style={{background:a?PRl:CARD,color:a?PR:T2,border:`1.5px solid ${a?PR:BD}`,padding:"8px 14px",borderRadius:20,cursor:"pointer",fontSize:12,fontWeight:a?600:400,transition:"all .12s"}}>{o}</button>;})}
              </div>
            </div>
            <div><Lbl ch="RESPONSABLE PRINCIPAL *"/>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                {USERS.filter(u=>u.id!==user.id).map(u=>{const a=form.respId===String(u.id);return(
                  <button key={u.id} onClick={()=>setForm(p=>({...p,respId:String(u.id)}))} style={{background:a?u.uc:CARD,color:a?"#fff":T1,border:`1.5px solid ${a?u.uc:BD}`,padding:"10px",borderRadius:10,cursor:"pointer",display:"flex",alignItems:"center",gap:8,transition:"all .12s"}}>
                    <div style={{width:26,height:26,borderRadius:"50%",background:a?"rgba(255,255,255,.3)":u.uc+"22",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{color:a?"#fff":u.uc,fontSize:10,fontWeight:700}}>{u.ini}</span></div>
                    <div style={{textAlign:"left",minWidth:0}}><div style={{fontSize:11,fontWeight:600,lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{shortName(u.name)}</div><div style={{fontSize:10,opacity:.75}}>{u.dept}</div></div>
                  </button>
                );})}
              </div>
            </div>
            <div><Lbl ch={`INVOLUCRADOS — orden de flujo (${form.invIds.length})`}/>
              <div style={{fontSize:11,color:T3,marginBottom:8}}>El orden de selección define el flujo de seguimiento.</div>
              {form.invIds.length>0&&<div style={{background:BG,borderRadius:8,padding:"10px 12px",marginBottom:10,display:"flex",gap:6,flexWrap:"wrap"}}>
                {form.invIds.map((id,i)=>{const u=USERS.find(x=>x.id===id);if(!u) return null;return(
                  <div key={id} style={{display:"flex",alignItems:"center",gap:6,background:CARD,border:`1px solid ${u.uc}`,borderRadius:20,padding:"4px 10px"}}>
                    <div style={{width:18,height:18,borderRadius:"50%",background:u.uc,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{color:"#fff",fontSize:9,fontWeight:700}}>{i+1}</span></div>
                    <span style={{fontSize:12,color:T1,fontWeight:500}}>{shortName(u.name)}</span>
                    <button onClick={()=>toggleInv(id)} style={{background:"none",border:"none",color:T3,cursor:"pointer",fontSize:14,lineHeight:1,padding:"0 2px"}}>×</button>
                  </div>
                );})}
              </div>}
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {USERS.filter(u=>u.id!==user.id).map(u=>{const idx=form.invIds.indexOf(u.id),sel=idx>=0;const isResp=u.id===parseInt(form.respId);return(
                  <button key={u.id} onClick={()=>toggleInv(u.id)} style={{background:sel?u.uc+"15":CARD,color:sel?u.uc:T2,border:`1.5px solid ${sel?u.uc:BD}`,padding:"7px 12px",borderRadius:20,cursor:"pointer",fontSize:12,fontWeight:sel?700:400,display:"flex",alignItems:"center",gap:6,transition:"all .12s"}}>
                    {sel&&<span style={{background:u.uc,color:"#fff",borderRadius:"50%",width:16,height:16,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700}}>{idx+1}</span>}
                    <span>{shortName(u.name)}</span>
                  </button>
                );})}
              </div>
            </div>
            <div><Lbl ch="FECHA LÍMITE *"/><input type="date" value={form.deadline} onChange={e=>setForm(p=>({...p,deadline:e.target.value}))} style={{...inp,borderRadius:10}}/></div>
            <div><Lbl ch="TÍTULO *"/><input value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))} placeholder="Descripción corta de la tarea" style={{...inp,borderRadius:10}}/></div>
            <div><Lbl ch="DESCRIPCIÓN (opcional)"/><textarea value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} rows={3} placeholder="Contexto adicional..." style={{...inp,borderRadius:10,lineHeight:1.7}}/></div>
            <button onClick={doSave} disabled={!canSave} style={{background:canSave?PR:"#E2E8F0",color:canSave?"#fff":T3,border:"none",padding:"15px",fontSize:14,fontWeight:700,cursor:canSave?"pointer":"not-allowed",borderRadius:12,transition:"background .12s"}}>{isEdit?"Guardar Cambios":"Crear Tarea"}</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   ROOT APP — ALL HOOKS FIRST, ALWAYS
════════════════════════════════════════ */
export default function App(){
  const [user,         setUser]         = useState(null);
  const [screen,       setScreen]       = useState("dash");
  const [tasks,        setTasks]        = useState(IT);
  const [selDept,      setSelDept]      = useState(null);
  const [selTask,      setSelTask]      = useState(null);
  const [fromScr,      setFromScr]      = useState("dash");
  const [filter,       setFilter]       = useState(null);
  const [authedDepts,  setAuthedDepts]  = useState([]);
  const [pwdModal,     setPwdModal]     = useState(null);
  const [deptCanAdd,   setDeptCanAdd]   = useState(false);
  const [createDept,   setCreateDept]   = useState(null);
  const [storageReady, setStorageReady] = useState(false);
  const [editingTask,  setEditingTask]  = useState(null);
  const [deleteTask,   setDeleteTask]   = useState(null);

  // Storage load
  useEffect(()=>{
    async function load(){
      try{const r=await store.get(STORAGE_KEY);if(r&&r.value)setTasks(JSON.parse(r.value));}
      catch(e){}
      setStorageReady(true);
    }
    load();
  },[]);

  // Storage save
  useEffect(()=>{
    if(!storageReady) return;
    async function save(){try{await store.set(STORAGE_KEY,JSON.stringify(tasks));}catch(e){}}
    save();
  },[tasks,storageReady]);

  const updateTask=(id,patch)=>setTasks(p=>p.map(t=>t.id===id?{...t,...patch}:t));
  const deleteTaskFn=id=>setTasks(p=>p.filter(t=>t.id!==id));
  const goTask=(t,from)=>{setSelTask(t);setFromScr(from||screen);setScreen("task");};
  const canAddInDept=dept=>{if(!user)return false;if(user.dept==="Dirección")return true;if(user.dept===dept)return true;return authedDepts.includes(dept);};
  const onPickerDeptClick=dept=>{if(canAddInDept(dept)){setSelDept(dept);setDeptCanAdd(true);setScreen("dept");}else setPwdModal({dept});};
  const onWidgetDeptClick=dept=>{setSelDept(dept);setDeptCanAdd(canAddInDept(dept));setScreen("dept");};
  const handlePwdSuccess=()=>{const d=pwdModal.dept;setAuthedDepts(p=>[...p,d]);setSelDept(d);setDeptCanAdd(true);setScreen("dept");setPwdModal(null);};
  const handleViewOnly=()=>{const d=pwdModal.dept;setSelDept(d);setDeptCanAdd(false);setScreen("dept");setPwdModal(null);};
  const resetData=()=>{if(window.confirm("¿Reiniciar todos los datos de ejemplo?"))setTasks(IT);};

  if(!user) return <><style>{CSS}</style><ScreenLogin onLogin={u=>{setUser(u);setScreen("dash");}}/></>;

  if(screen==="create") return <><style>{CSS}</style><ScreenCreate user={user} taskCount={tasks.length} defaultDept={createDept} onSave={t=>{setTasks(p=>[t,...p]);setScreen(createDept?"dept":"dash");}} onCancel={()=>setScreen(createDept?"dept":"dash")}/></>;

  if(screen==="edit"&&editingTask) return <><style>{CSS}</style><ScreenCreate user={user} taskCount={tasks.length} taskToEdit={editingTask} onSave={patch=>{updateTask(editingTask.id,patch);setEditingTask(null);setScreen("task");}} onCancel={()=>{setEditingTask(null);setScreen("task");}}/></>;

  if(screen==="task"&&selTask){
    const live=tasks.find(t=>t.id===selTask.id)||selTask;
    return <><style>{CSS}</style>
      <ScreenTaskDetail taskId={live.id} tasks={tasks} user={user} onBack={()=>setScreen(fromScr)} onUpdate={updateTask} onEdit={t=>{setEditingTask(t);setScreen("edit");}} onDelete={t=>setDeleteTask(t)}/>
      {deleteTask&&<DeleteModal task={deleteTask} onConfirm={()=>{deleteTaskFn(deleteTask.id);setDeleteTask(null);setScreen(fromScr);}} onCancel={()=>setDeleteTask(null)}/>}
    </>;
  }

  if(screen==="dept"&&selDept) return <><style>{CSS}</style><ScreenDeptDetail dept={selDept} tasks={tasks} user={user} canAdd={deptCanAdd} onBack={()=>setScreen("dash")} onTaskClick={t=>goTask(t,"dept")} onNewTask={()=>{setCreateDept(selDept);setScreen("create");}}/></>;

  if(screen==="filtered"&&filter) return <><style>{CSS}</style><ScreenFilteredList tasks={tasks} filter={filter} user={user} onBack={()=>setScreen("dash")} onTaskClick={t=>goTask(t,"filtered")}/></>;

  if(screen==="search") return <><style>{CSS}</style><ScreenSearch tasks={tasks} user={user} onBack={()=>setScreen("dash")} onTaskClick={t=>goTask(t,"search")}/></>;

  if(screen==="myTasks") return <><style>{CSS}</style><ScreenMyTasks tasks={tasks} user={user} onBack={()=>setScreen("dash")} onTaskClick={t=>goTask(t,"myTasks")}/></>;

  if(screen==="calendar") return <><style>{CSS}</style><ScreenCalendar tasks={tasks} user={user} onBack={()=>setScreen("dash")} onTaskClick={t=>goTask(t,"calendar")}/></>;

  if(screen==="stats") return <><style>{CSS}</style><ScreenStats tasks={tasks} user={user} onBack={()=>setScreen("dash")} onResetData={resetData}/></>;

  return(
    <>
      <style>{CSS}</style>
      <ScreenDashboard tasks={tasks} user={user}
        onStatClick={f=>{setFilter(f);setScreen("filtered");}}
        onDeptClick={onWidgetDeptClick}
        onPickerDeptClick={onPickerDeptClick}
        onNewTask={()=>{setCreateDept(null);setScreen("create");}}
        onSearch={()=>setScreen("search")}
        onStats={()=>setScreen("stats")}
        onMyTasks={()=>setScreen("myTasks")}
        onCalendar={()=>setScreen("calendar")}
      />
      {pwdModal&&<PasswordModal dept={pwdModal.dept} onSuccess={handlePwdSuccess} onViewOnly={handleViewOnly} onCancel={()=>setPwdModal(null)}/>}
      {deleteTask&&<DeleteModal task={deleteTask} onConfirm={()=>{deleteTaskFn(deleteTask.id);setDeleteTask(null);}} onCancel={()=>setDeleteTask(null)}/>}
    </>
  );
}
