import { useState, useMemo, useRef, useEffect, useCallback, Fragment, createContext, useContext } from "react";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import supabase, { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase";
import {
  MAX_ATTACHMENT_SIZE, VAPID_PUBLIC_KEY, DEPT_COLORS, USERS,
  DEPTS, USERS_BY_DEPT, ASSIGN_MATRIX, PUEDE_REGISTRAR_AUSENCIAS,
  TIPO_AUSENCIA_CONFIG, TIPO_AUSENCIA_ABBR, DIAS_SEMANA_OPTS,
  TT, SC, PC, FS_CFG, BLANK, MONTHS_ES, DAYS_ES, DAYS_WORK, IT, LOGO_URL,
  BG, CARD, BD, T1, T2, T3, PR, PRl, SH, SHm, fnt, inp, CSS
} from "./lib/constants";
import {
  safeDate, safeDays, fmtDT, fmtCompletedDate, fmtDate, fmtISODateLocal, isoWeekday, isTodayDeadline,
  diasHabilesAusencia, fmtFechaCortaAusencia, fmtRangoAusencia, puedeRegistrarAusencias, esRHAusencias, rolRegistroAusencia,
  dc, getInvolved, shortName, isOver, isActive, isAtRisk, dlStatus, isActiveStatus,
  avisoRecipients, avisoIncludesUser, genStageId, getStageIds, calcProgress,
  getAssignableIds, verifyDeptPassword
} from "./lib/helpers";

// Funciones utilitarias movidas a src/lib/helpers.js

/* ════════════════════════════════════════
   REALTIME CONTEXT
════════════════════════════════════════ */
// Context para compartir el estado de conexión Realtime en toda la app
const RealtimeContext = createContext({
  status: "connecting",
  lastSyncTime: Date.now()
});

/* ════════════════════════════════════════
   HOOK: SCROLL RESTORE
════════════════════════════════════════ */
// Hook para restaurar posición de scroll al regresar a una lista.
// Usa doble estrategia para compatibilidad con iOS PWA:
// 1. requestAnimationFrame para intento inmediato
// 2. setTimeout de 50ms como respaldo (iOS puede resetear scrollTop después del render)
function useScrollRestore(screenName) {
  const scrollRef = useRef(null);
  const scrollPositions = useRef({});

  // Guardar posición al desmontar
  useEffect(() => {
    return () => {
      if (scrollRef.current) {
        scrollPositions.current[screenName] = scrollRef.current.scrollTop;
      }
    };
  }, [screenName]);

  // Restaurar posición al montar (doble estrategia iOS)
  useEffect(() => {
    const savedPosition = scrollPositions.current[screenName];

    // Solo restaurar si hay una posición guardada > 0
    if (scrollRef.current && savedPosition && savedPosition > 0) {
      // Intento 1: requestAnimationFrame (inmediato después del render)
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = savedPosition;
        }
      });

      // Intento 2: setTimeout 50ms (respaldo para iOS PWA)
      setTimeout(() => {
        if (scrollRef.current && scrollRef.current.scrollTop !== savedPosition) {
          scrollRef.current.scrollTop = savedPosition;
        }
      }, 50);
    }
  }, [screenName]);

  return scrollRef;
}

/* ════════════════════════════════════════
   PUSH NOTIFICATIONS
════════════════════════════════════════ */

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function showUpdateBanner() {
  if (document.getElementById("taskops-update-banner")) return;
  const bar = document.createElement("div");
  bar.id = "taskops-update-banner";
  bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#1E293B;color:#fff;padding:12px 16px;display:flex;align-items:center;justify-content:center;gap:12px;font-family:inherit;font-size:13px;box-shadow:0 -2px 12px rgba(0,0,0,.25);flex-wrap:wrap;";
  const msg = document.createElement("span");
  msg.textContent = "🔄 Hay una nueva versión disponible.";
  const btn = document.createElement("button");
  btn.textContent = "Actualizar ahora";
  btn.style.cssText = "background:#fff;color:#1E293B;border:none;padding:7px 14px;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;";
  btn.onclick = () => window.location.reload();
  bar.appendChild(msg);
  bar.appendChild(btn);
  document.body.appendChild(bar);
}

async function registerPush(user) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  try {
    const permission = await Notification.requestPermission();
    if (permission === "denied") {
      console.warn("[Push] Permiso denegado permanentemente para:", user.name);
      return;
    }
    if (permission !== "granted") return;
    // Registrar SW y esperar al registration activo antes de suscribir
    const swReg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    console.log("[Push] SW registrado:", swReg.scope);
    const readyReg = await navigator.serviceWorker.ready;
    console.log("[Push] SW activo:", readyReg.active?.scriptURL);
    const subscription = await readyReg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const subJson = typeof subscription.toJSON === "function"
      ? subscription.toJSON()
      : JSON.parse(JSON.stringify(subscription));
    if (!subJson?.endpoint) {
      console.error("[Push] Subscription inválida — sin endpoint");
      return;
    }
    const { error } = await supabase.from("push_tokens").upsert({
      id: String(user.id),
      user_name: user.name,
      dept: user.dept,
      subscription: subJson,
      updated_at: new Date().toISOString(),
    });
    if (error) console.error("[Push] Error guardando subscription:", error.message);
    else console.log("[Push] Subscription registrada para:", user.name);
  } catch (err) {
    console.error("[Push] Error al registrar push:", err.message);
  }
}

async function downloadAttachmentIOS(att) {
  try {
    const { data, error } = await supabase.storage.from("task-attachments").createSignedUrl(att.url, 60);
    if (error) {
      alert("No se pudo generar el enlace de descarga: " + error.message);
      return;
    }
    // Fetch del blob para compatibilidad con iOS Safari
    const response = await fetch(data.signedUrl);
    if (!response.ok) throw new Error("Error al descargar el archivo");
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = att.nombre || "archivo";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    console.error("[Download] Error descargando adjunto:", err);
    alert("Error al descargar el archivo: " + err.message);
  }
}

async function sendPushNotification(userIds, title, body, url="/") {
  if (!userIds || !userIds.length) return;
  try {
    const { error } = await supabase.functions.invoke("send-push", {
      body: { userIds: userIds.map(String), title, body, url },
    });
    if (error) console.error("[Push] send-push error:", error.message);
    else console.log(`[Push] Enviadas a ${userIds.length} usuario(s): ${title}`);
  } catch (err) {
    console.error("[Push] Error invocando send-push:", err.message);
  }
}

async function sendEmailNotification(type, to, data) {
  if (!to || !to.length) return;
  try {
    const { error } = await supabase.functions.invoke("send-email", {
      body: { type, to, data },
    });
    if (error) console.error("[Email] send-email error:", error.message);
    else console.log(`[Email] Enviado tipo '${type}' a ${to.length} destinatario(s)`);
  } catch (err) {
    console.error("[Email] Error invocando send-email:", err.message);
  }
}

async function sendWhatsAppNotification(type, toPhones, data) {
  if (!toPhones || !toPhones.length) return;
  try {
    const { error } = await supabase.functions.invoke("send-whatsapp", {
      body: { type, to: toPhones, data },
    });
    if (error) console.error("[WhatsApp] error:", error.message);
    else console.log(`[WhatsApp] Enviado tipo '${type}' a ${toPhones.length} destinatario(s)`);
  } catch (err) {
    console.error("[WhatsApp] Error:", err.message);
  }
}

async function sendSMSNotification(type, toPhones, data) {
  if (!toPhones || !toPhones.length) return;
  try {
    const { error } = await supabase.functions.invoke("send-sms", {
      body: { type, to: toPhones, data },
    });
    if (error) console.error("[SMS] error:", error.message);
    else console.log(`[SMS] Enviado tipo '${type}' a ${toPhones.length} destinatario(s)`);
  } catch (err) {
    console.error("[SMS] Error:", err.message);
  }
}

/* ════════════════════════════════════════
   DATA & CONSTANTS
════════════════════════════════════════ */
// (Constantes movidas a src/lib/constants.js)

// verifyDeptPassword y getAssignableIds movidas a src/lib/helpers.js
// ════════════════════════════════════════
// MÓDULO DE AUSENCIAS — FASE 1
// ════════════════════════════════════════
// Funciones de ausencias movidas a src/lib/helpers.js

/* ════════════════════════════════════════
   DESIGN TOKENS & CSS
════════════════════════════════════════ */
// Design tokens importados desde src/lib/constants.js

/* ════════════════════════════════════════
   UTILITIES
════════════════════════════════════════ */
// Funciones utilitarias movidas a src/lib/helpers.js

function useIsMobile(){
  const [m,setM]=useState(()=>window.innerWidth<768);
  useEffect(()=>{const fn=()=>setM(window.innerWidth<768);window.addEventListener("resize",fn);return()=>window.removeEventListener("resize",fn);},[]);
  return m;
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

function RealtimeStatus({status,lastSyncTime}){
  const [isMobile,setIsMobile]=useState(window.innerWidth<480);
  useEffect(()=>{
    const handler=()=>setIsMobile(window.innerWidth<480);
    window.addEventListener("resize",handler);
    return ()=>window.removeEventListener("resize",handler);
  },[]);

  const fmtTime=(ts)=>{
    return new Date(ts).toLocaleTimeString("es-MX",{
      hour:"numeric",
      minute:"2-digit",
      hour12:true
    }).toLowerCase();
  };

  const dotColor=status==="connected"?"#059669":status==="connecting"?"#94A3B8":"#DC2626";
  const timeStr=fmtTime(lastSyncTime);

  return(
    <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:T3,userSelect:"none"}}>
      <span style={{color:dotColor,fontSize:14,lineHeight:1}}>●</span>
      {!isMobile&&(
        status==="connected"?(
          <span>{timeStr}</span>
        ):status==="connecting"?(
          <span style={{color:"#94A3B8",fontWeight:500}}>Conectando...</span>
        ):(
          <span style={{color:"#DC2626",fontWeight:500}}>Desconectado — {timeStr}</span>
        )
      )}
    </div>
  );
}

function NavBar({left,center,right}){
  const realtimeStatus=useContext(RealtimeContext);
  return <div style={{background:CARD,borderBottom:`1px solid ${BD}`,padding:"0 20px",display:"flex",alignItems:"center",justifyContent:"space-between",height:60,position:"sticky",top:0,zIndex:50,boxShadow:"0 1px 4px rgba(15,23,42,.06)"}}>
    <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>{left}</div>
    <div style={{display:"flex",alignItems:"center",gap:8,flex:1,justifyContent:"center",flexWrap:"wrap"}}>{center}</div>
    <div style={{display:"flex",alignItems:"center",gap:12,position:"relative",flexShrink:0}}>
      <RealtimeStatus status={realtimeStatus.status} lastSyncTime={realtimeStatus.lastSyncTime}/>
      {right}
    </div>
  </div>;
}
function Logo(){
  if(LOGO_URL) return (
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      <img src={LOGO_URL} height={36} style={{display:"block",objectFit:"contain",maxWidth:80}} alt="FPM Logo"/>
      <span style={{fontWeight:800,fontSize:16,color:T1,letterSpacing:1}}>NEXUS</span>
    </div>
  );
  return <><span style={{fontSize:18}}>⚡</span><span style={{fontWeight:700,fontSize:15,color:T1,letterSpacing:.5}}>NEXUS</span></>;
}
function BackBtn({onClick}){return <button onClick={onClick} className="hl" style={{background:"none",border:"none",color:T2,cursor:"pointer",fontSize:22,lineHeight:1,padding:"4px"}}>←</button>;}

function TRow({t,onClick,roleBadge}){
  const tt=TT[t.type]||{c:T2,bg:"#F9FAFB"};
  const sc=SC[t.status];const pc=PC[t.priority];
  const dl=dlStatus(t.deadline,t.status);
  const pct=calcProgress(t.invIds,t.flowStates,t.flowStageIds);
  const pctColor=pct===100?"#059669":pct>=50?"#D97706":"#6B7280";
  return(
    <Card cls="rw" sx={{padding:"14px 18px",marginBottom:8,borderLeft:`3px solid ${dc(t.responsible?.dept||"Dirección")}`}} onClick={onClick}>
      <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:6,flexWrap:"wrap"}}>
            <span style={{fontSize:10,color:T3,fontWeight:500}}>{t.id}</span>
            {roleBadge&&<Badge ch={roleBadge} c={roleBadge==="Responsable"?PR:"#059669"} bg={roleBadge==="Responsable"?PRl:"#ECFDF5"}/>}
            <Badge ch={t.type}     c={tt.c} bg={tt.bg}/>
            <Badge ch={t.priority} c={pc.c} bg={pc.bg}/>
            <Badge ch={t.status}   c={sc.c} bg={sc.bg}/>
            {dl.isOver&&<Badge ch="⚠ Vencida" c="#DC2626" bg="#FEF2F2"/>}
            {dl.isToday&&<Badge ch="🟠 Vence hoy" c="#EA580C" bg="#FFF7ED"/>}
          </div>
          <div style={{fontSize:14,fontWeight:600,color:T1,marginBottom:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div>
          <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
            {t.responsible&&<div style={{display:"flex",alignItems:"center",gap:5}}>
              <Av u={t.responsible} size={18}/><span style={{fontSize:11,color:T2}}>{t.responsible.name}</span>
            </div>}
            <span style={{fontSize:11,color:dl.c,fontWeight:dl.isOver||dl.isToday?700:500}}>{dl.label}</span>
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
function FlowDiagram({invIds,flowStates,flowStageIds,onReorder,onStateChange,canReorder,canChangeState,nodeNotes,onNoteChange,canEditNotes,myInvIndex,canChangeOwnStep,attachments,taskId,user,onAttachmentsChange}){
  const nodes=getInvolved(invIds);
  const sids=getStageIds(invIds,flowStageIds);
  const [editNotes,setEditNotes]=useState({});
  const [expandedNotes,setExpandedNotes]=useState({});
  const [showAll,setShowAll]=useState(false);
  const [uploading,setUploading]=useState({});
  const [uploadErr,setUploadErr]=useState({});
  const [completedBlockMsg,setCompletedBlockMsg]=useState(null);
  if(!nodes.length) return <div style={{color:T3,fontSize:13,textAlign:"center",padding:"16px 0"}}>Sin involucrados definidos</div>;
  const handleUpload=async(idx,file)=>{
    if(!file) return;
    if(file.size>MAX_ATTACHMENT_SIZE){setUploadErr(p=>({...p,[idx]:"El archivo supera 20MB"}));return;}
    setUploadErr(p=>({...p,[idx]:null}));
    setUploading(p=>({...p,[idx]:true}));
    const sid=sids[idx];
    const path=`${taskId}/${sid}/${Date.now()}_${file.name}`;
    const{error}=await supabase.storage.from("task-attachments").upload(path,file);
    setUploading(p=>({...p,[idx]:false}));
    if(error){setUploadErr(p=>({...p,[idx]:error.message}));return;}
    const newAtt={nombre:file.name,url:path,nodeIndex:sid,subidoPor:{id:user.id,name:user.name,ini:user.ini,uc:user.uc},fecha:new Date().toISOString()};
    onAttachmentsChange([...(attachments||[]),newAtt]);
  };
  const handleDownload=async att=>{
    await downloadAttachmentIOS(att);
  };
  const handleDeleteAttachment=async att=>{
    await supabase.storage.from("task-attachments").remove([att.url]);
    onAttachmentsChange((attachments||[]).filter(a=>a.url!==att.url));
  };
  const moveUp=i=>{
    const a=[...invIds];[a[i-1],a[i]]=[a[i],a[i-1]];
    const s=[...sids];[s[i-1],s[i]]=[s[i],s[i-1]];
    onReorder(a,s);
  };
  const moveDown=i=>{
    const a=[...invIds];[a[i],a[i+1]]=[a[i+1],a[i]];
    const s=[...sids];[s[i],s[i+1]]=[s[i+1],s[i]];
    onReorder(a,s);
  };
  const nextIdx=nodes.findIndex((_,idx)=>(flowStates[sids[idx]]||"Pendiente")!=="Completado");
  const getNoteVal=idx=>editNotes[idx]!==undefined?editNotes[idx]:(nodeNotes?.[sids[idx]]||"");
  const activeIdx=nextIdx===-1?nodes.length-1:nextIdx;
  const visibleIndexes=showAll?nodes.map((_,vi)=>vi):[...new Set([activeIdx-1,activeIdx,activeIdx+1].filter(vi=>vi>=0&&vi<nodes.length))];
  return(
    <div style={{display:"flex",flexDirection:"column"}}>
      {nodes.map((u,i)=>{
        if(!visibleIndexes.includes(i)) return null;
        const st=flowStates[sids[i]]||"Pendiente";const fc=FS_CFG[st];const isLast=i===nodes.length-1;const isLastVisible=i===visibleIndexes[visibleIndexes.length-1];
        const isPulse=nextIdx>=0&&i===nextIdx&&st==="Pendiente";
        const note=nodeNotes?.[sids[i]]||"";
        const LIMIT=80;
        const noteIsLong=note.length>LIMIT;
        const noteExpanded=!!expandedNotes[i];
        const nodeCanChange=canChangeState||(canChangeOwnStep&&myInvIndex===i);
        const nodeCanEditNote=canEditNotes||(canChangeOwnStep&&myInvIndex===i);
        const nodeAttachments=(attachments||[]).filter(a=>String(a.nodeIndex)===String(sids[i]));
        return(
          <div key={i} style={{display:"flex",flexDirection:"column",alignItems:"flex-start"}}>
            <div className={isPulse?"fn-pulse":""} style={{display:"flex",flexDirection:"column",width:"100%",background:isPulse?"#EEF2FF":fc.bg,border:`1.5px solid ${isPulse?"#4338CA44":fc.c+"33"}`,borderRadius:10,padding:"12px 16px"}}>
              {/* Fila superior: número + nombre/dept + botones */}
              <div style={{display:"flex",alignItems:"flex-start",gap:12,width:"100%"}}>
                <div style={{width:28,height:28,borderRadius:"50%",background:fc.c,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:2}}>
                  <span style={{color:"#fff",fontWeight:700,fontSize:12}}>{i+1}</span>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:T1}}>{u.name}</div>
                  <div style={{fontSize:11,color:T2}}>{u.dept}</div>
                </div>
                {nodeCanChange?(
                  <div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"flex-end",flexShrink:0}}>
                    <div style={{display:"flex",gap:4,flexWrap:"wrap",justifyContent:"flex-end"}}>
                      {Object.entries(FS_CFG).map(([s,c])=>{
                        const isLast=i===nodes.length-1;
                        const allPrevCompleted=isLast?nodes.slice(0,-1).every((_,idx)=>(flowStates[sids[idx]]||"Pendiente")==="Completado"):true;
                        const isBlocked=isLast&&s==="Completado"&&!allPrevCompleted;
                        return(
                          <button key={s}
                            onClick={()=>{
                              if(isBlocked){
                                setCompletedBlockMsg(i);
                                setTimeout(()=>setCompletedBlockMsg(null),3000);
                                return;
                              }
                              onStateChange(sids[i],s);
                            }}
                            disabled={isBlocked}
                            style={{background:st===s?c.c:CARD,color:st===s?"#fff":c.c,border:`1px solid ${c.c}`,padding:"4px 10px",borderRadius:20,cursor:isBlocked?"not-allowed":"pointer",fontSize:11,fontWeight:600,transition:"all .1s",opacity:isBlocked?0.5:1}}>
                            {c.icon} {s}
                          </button>
                        );
                      })}
                    </div>
                    {completedBlockMsg===i&&(
                      <div style={{fontSize:11,color:"#DC2626",marginTop:4,fontWeight:600}}>
                        ⚠️ Todos los pasos anteriores deben estar completos
                      </div>
                    )}
                  </div>
                ):(
                  <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:2,flexShrink:0}}>
                    <Badge ch={`${fc.icon} ${st}`} c={fc.c} bg={fc.bg}/>
                    {!nodeCanChange&&myInvIndex===i&&myInvIndex!==-1&&(
                      <div style={{fontSize:11,color:T3,marginTop:4,fontStyle:"italic"}}>⏳ Disponible cuando la etapa anterior inicie</div>
                    )}
                  </div>
                )}
                {canReorder&&(
                  <div style={{display:"flex",flexDirection:"column",gap:2,marginLeft:4,flexShrink:0}}>
                    <button onClick={()=>moveUp(i)} disabled={i===0} style={{background:"none",border:`1px solid ${BD}`,borderRadius:4,width:22,height:22,cursor:i===0?"not-allowed":"pointer",color:i===0?T3:T2,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>↑</button>
                    <button onClick={()=>moveDown(i)} disabled={isLast} style={{background:"none",border:`1px solid ${BD}`,borderRadius:4,width:22,height:22,cursor:isLast?"not-allowed":"pointer",color:isLast?T3:T2,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>↓</button>
                  </div>
                )}
              </div>
              {/* Fila inferior: nota (ancho completo) */}
              {(nodeCanEditNote||(note&&!nodeCanEditNote))&&(
                <div style={{width:"100%",marginTop:8}}>
                  {nodeCanEditNote?(
                    <textarea
                      value={getNoteVal(i)}
                      onChange={e=>{
                        setEditNotes(p=>({...p,[i]:e.target.value}));
                        e.target.style.height="auto";
                        e.target.style.height=e.target.scrollHeight+"px";
                      }}
                      onBlur={()=>{
                        const val=editNotes[i];
                        if(val!==undefined&&val!==(nodeNotes?.[sids[i]]||"")) onNoteChange(sids[i],val);
                      }}
                      rows={2}
                      placeholder="Nota para esta etapa..."
                      style={{fontSize:13,color:"#374151",background:"rgba(255,255,255,.9)",border:`1px solid ${BD}`,borderRadius:8,padding:"10px 12px",width:"100%",minHeight:80,outline:"none",fontFamily:"inherit",resize:"vertical",lineHeight:1.5,display:"block",boxSizing:"border-box"}}
                    />
                  ):note?(
                    <div style={{padding:"7px 10px",background:"rgba(0,0,0,.05)",borderRadius:6,borderLeft:`3px solid ${fc.c}88`}}>
                      <p style={{margin:0,fontSize:12,color:"#374151",lineHeight:1.55,wordBreak:"break-word",whiteSpace:"pre-wrap"}}>
                        {noteIsLong&&!noteExpanded?note.slice(0,LIMIT)+"…":note}
                      </p>
                      {noteIsLong&&(
                        <button onClick={()=>setExpandedNotes(p=>({...p,[i]:!noteExpanded}))}
                          style={{marginTop:4,background:"none",border:"none",color:fc.c,fontSize:11,fontWeight:700,cursor:"pointer",padding:0,fontFamily:"inherit"}}>
                          {noteExpanded?"▲ Mostrar menos":"▼ Mostrar más"}
                        </button>
                      )}
                    </div>
                  ):null}
                </div>
              )}
              {/* Fila de adjuntos (ancho completo) - siempre visible si hay adjuntos o si se puede editar */}
              {(nodeAttachments.length>0||nodeCanChange)&&(
                <div style={{width:"100%",marginTop:8}}>
                  <div style={{fontSize:11,fontWeight:600,color:T2,letterSpacing:.4,marginBottom:6}}>📎 ARCHIVOS ADJUNTOS</div>
                  {nodeAttachments.length>0&&(
                    <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:8}}>
                      {nodeAttachments.map((att,ai)=>(
                        <div key={ai} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,background:"rgba(255,255,255,.7)",borderRadius:6,padding:"6px 10px"}}>
                          <div style={{minWidth:0,flex:1}}>
                            <div style={{fontSize:12,color:"#374151",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{att.nombre}</div>
                            <div style={{fontSize:10,color:T3}}>{att.subidoPor?.name||"—"} · {fmtDT(att.fecha)}</div>
                          </div>
                          <div style={{display:"flex",gap:6,flexShrink:0}}>
                            <button onClick={()=>handleDownload(att)}
                              style={{background:"none",border:`1px solid ${BD}`,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:600,color:fc.c,fontFamily:"inherit"}}>
                              ⬇ Descargar
                            </button>
                            {nodeCanChange&&(
                              <button onClick={()=>handleDeleteAttachment(att)} title="Borrar adjunto"
                                style={{background:"none",border:`1px solid ${BD}`,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:600,color:"#DC2626",fontFamily:"inherit"}}>
                                🗑️
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {nodeCanChange&&(
                    <>
                      <label style={{display:"inline-flex",alignItems:"center",gap:6,background:"rgba(255,255,255,.7)",border:`1px dashed ${BD}`,borderRadius:6,padding:"6px 12px",cursor:uploading[i]?"default":"pointer",fontSize:12,fontWeight:600,color:T2}}>
                        {uploading[i]?"Subiendo...":"+ Adjuntar archivo"}
                        <input type="file" disabled={!!uploading[i]} style={{display:"none"}}
                          onChange={e=>{const f=e.target.files?.[0];handleUpload(i,f);e.target.value="";}}/>
                      </label>
                      {uploadErr[i]&&<div style={{fontSize:11,color:"#DC2626",marginTop:4}}>{uploadErr[i]}</div>}
                    </>
                  )}
                </div>
              )}
            </div>
            {!isLastVisible&&<div style={{paddingLeft:30}}><div style={{width:2,height:8,background:BD,marginLeft:13}}/><div style={{color:T3,fontSize:14,lineHeight:1,marginLeft:7}}>▼</div><div style={{width:2,height:8,background:BD,marginLeft:13}}/></div>}
          </div>
        );
      })}
      {(showAll||visibleIndexes.length<nodes.length)&&(
        <button onClick={()=>setShowAll(p=>!p)}
          style={{width:"100%",marginTop:8,background:"none",border:`1px solid ${BD}`,borderRadius:8,padding:"8px",cursor:"pointer",fontSize:12,color:T2,fontWeight:600,fontFamily:"inherit"}}>
          {showAll?"▲ Mostrar menos":`▼ Mostrar todo el flujo (${nodes.length} etapas)`}
        </button>
      )}
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
            style={{background:"#FFF7ED",border:"1px solid #FED7AA",color:"#EA580C",padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,display:"flex",alignItems:"center",gap:6,...fnt,transition:"all .12s"}}>
            🟠 {today.length} tarea{today.length>1?"s":""} vence{today.length===1?"":"n"} HOY
          </button>
        )}
      </div>
    </div>
  );
}

// Mini-widget de ausentes hoy (sidebar/dashboard). Vive aquí porque se usa
// en ScreenDashboard; consulta el RPC ya creado en Supabase para "hoy" y
// se refresca cuando cambia `ausencias` (la suscripción Realtime central
// vive en App() y empuja un nuevo array cada vez que la tabla cambia).
function AusentesHoyWidget({ausencias,onVerMas,onOpenDetalle}){
  const [hoyList,setHoyList]=useState([]);

  // Recargar ausentes hoy - siempre con fecha fresca
  const cargarHoy=useCallback(()=>{
    const hoy=fmtISODateLocal(new Date());
    supabase.rpc("get_ausencias_en_rango",{fecha_desde:hoy,fecha_hasta:hoy})
      .then(({data,error})=>{
        if(error){console.error("[Supabase] Error get_ausencias_en_rango (hoy):",error.message);return;}
        setHoyList(data||[]); // Reemplazar completo
      });
  },[]);

  useEffect(()=>{
    cargarHoy();
  },[cargarHoy,ausencias]); // Recargar cuando ausencias cambie (realtime)
  const visibles=hoyList.slice(0,4);
  return(
    <Card sx={{padding:16,marginBottom:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:hoyList.length?10:0}}>
        <div style={{fontSize:12,fontWeight:600,color:T2,letterSpacing:.5}}>📆 AUSENTES HOY{hoyList.length>0?` (${hoyList.length})`:""}</div>
        {hoyList.length>4&&<button onClick={onVerMas} className="hl" style={{background:"none",border:"none",color:PR,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Ver más →</button>}
      </div>
      {hoyList.length===0?(
        <div style={{fontSize:12,color:T3}}>Nadie ausente hoy.</div>
      ):(
        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
          {visibles.map(a=>{
            const cfg=TIPO_AUSENCIA_CONFIG[a.tipo]||{};
            const u=USERS.find(x=>x.name===a.empleado_nombre);
            return(
              <div key={a.id} onClick={()=>onOpenDetalle&&onOpenDetalle(a)} style={{display:"flex",alignItems:"center",gap:6,background:cfg.bg,borderRadius:20,padding:"3px 10px 3px 3px",cursor:"pointer"}} className="hl">
                <Av u={u||{ini:a.empleado_iniciales,uc:cfg.text}} size={22}/>
                <span style={{fontSize:12,fontWeight:600,color:T1}}>{shortName(a.empleado_nombre)}</span>
                <span style={{fontSize:10,fontWeight:600,color:cfg.text}}>{cfg.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* ════════════════════════════════════════
   MODALS
════════════════════════════════════════ */
function PasswordModal({dept,onSuccess,onViewOnly,onCancel,hideViewOnly}){
  const [pwd,setPwd]=useState("");
  const [err,setErr]=useState(false);
  const [loading,setLoading]=useState(false);

  const check = async () => {
    if (loading) return;
    setLoading(true);

    const isValid = await verifyDeptPassword(dept, pwd);

    setLoading(false);

    if (isValid) {
      onSuccess();
    } else {
      setErr(true);
      setPwd("");
    }
  };

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.6)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:CARD,borderRadius:16,padding:28,width:"100%",maxWidth:360,boxShadow:SHm}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          <div style={{width:36,height:36,borderRadius:10,background:DEPT_COLORS[dept]||PR,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{color:"#fff",fontSize:16}}>🔒</span></div>
          <div><div style={{fontSize:15,fontWeight:700,color:T1}}>Acceso a {dept}</div><div style={{fontSize:12,color:T2}}>{hideViewOnly?"Se requiere autenticación para continuar":"Contraseña para agregar tareas"}</div></div>
        </div>
        <input type="password" value={pwd} onChange={e=>{setPwd(e.target.value);setErr(false);}} onKeyDown={async (e)=>{if(e.key==="Enter"&&!loading)await check()}} placeholder="Contraseña..." style={{...inp,marginBottom:8,borderColor:err?"#DC2626":BD}} disabled={loading}/>
        {err&&<div style={{fontSize:12,color:"#DC2626",marginBottom:10}}>Contraseña incorrecta.</div>}
        <button onClick={check} disabled={!pwd.trim()||loading} style={{width:"100%",background:PR,color:"#fff",border:"none",padding:"11px",borderRadius:8,fontSize:13,fontWeight:700,cursor:loading||!pwd.trim()?"not-allowed":"pointer",marginBottom:8,opacity:loading||!pwd.trim()?0.6:1}}>{loading?"Verificando...":"Acceder con contraseña"}</button>
        <div style={{display:"flex",gap:8}}>
          {!hideViewOnly&&<button onClick={onViewOnly} style={{flex:1,background:BG,border:`1px solid ${BD}`,color:T2,padding:"9px",borderRadius:8,fontSize:12,cursor:"pointer",fontWeight:500}} disabled={loading}>Solo ver</button>}
          <button onClick={onCancel} style={{flex:hideViewOnly?undefined:1,background:BG,border:`1px solid ${BD}`,color:T2,padding:"9px",borderRadius:8,fontSize:12,cursor:"pointer",fontWeight:500,width:hideViewOnly?"100%":undefined}} disabled={loading}>Cancelar</button>
        </div>
        {!hideViewOnly&&<div style={{marginTop:12,fontSize:11,color:T3,textAlign:"center"}}>Sin contraseña podrás ver tareas pero no agregar ni editar.</div>}
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

function DeleteAvisoModal({onConfirm,onCancel}){
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.6)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:CARD,borderRadius:16,padding:28,width:"100%",maxWidth:340,boxShadow:SHm,textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:16}}>🗑️</div>
        <h3 style={{fontSize:16,fontWeight:700,color:T1,marginBottom:8}}>¿Seguro que quieres eliminar este aviso?</h3>
        <p style={{fontSize:12,color:"#DC2626",marginBottom:20}}>Esta acción no se puede deshacer.</p>
        <div style={{display:"flex",gap:10}}>
          <button onClick={onCancel} style={{flex:1,background:BG,border:`1px solid ${BD}`,color:T2,padding:"11px",borderRadius:8,fontSize:13,cursor:"pointer",fontWeight:500}}>Cancelar</button>
          <button onClick={onConfirm} style={{flex:1,background:"#DC2626",color:"#fff",border:"none",padding:"11px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer"}}>Eliminar</button>
        </div>
      </div>
    </div>
  );
}

function DeleteAusenciaModal({ausencia,onConfirm,onCancel}){
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.6)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:CARD,borderRadius:16,padding:28,width:"100%",maxWidth:340,boxShadow:SHm,textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:16}}>🗑️</div>
        <h3 style={{fontSize:16,fontWeight:700,color:T1,marginBottom:8}}>¿Eliminar esta ausencia?</h3>
        <p style={{fontSize:13,color:T2,marginBottom:4}}>{ausencia.empleado_nombre}</p>
        <p style={{fontSize:12,color:T3,marginBottom:4}}>{TIPO_AUSENCIA_CONFIG[ausencia.tipo]?.label} · {ausencia.fecha_efectiva}</p>
        <p style={{fontSize:12,color:"#DC2626",marginBottom:20}}>Esta acción no se puede deshacer.</p>
        <div style={{display:"flex",gap:10}}>
          <button onClick={onCancel} style={{flex:1,background:BG,border:`1px solid ${BD}`,color:T2,padding:"11px",borderRadius:8,fontSize:13,cursor:"pointer",fontWeight:500}}>Cancelar</button>
          <button onClick={onConfirm} style={{flex:1,background:"#DC2626",color:"#fff",border:"none",padding:"11px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer"}}>Eliminar</button>
        </div>
      </div>
    </div>
  );
}

// Modal de detalle universal para ausencias
function ModalDetalleAusencia({ausencia,onClose,onEditar,onEliminar,user}){
  const cfg=TIPO_AUSENCIA_CONFIG[ausencia.tipo];
  const esRH=esRHAusencias(user);
  const [showDeleteConfirm,setShowDeleteConfirm]=useState(false);

  return(
    <>
      <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.7)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:24}} onClick={onClose}>
        <div style={{background:CARD,borderRadius:16,padding:28,width:"100%",maxWidth:480,boxShadow:SHm}} onClick={e=>e.stopPropagation()}>
          {/* Header */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:48,height:48,borderRadius:"50%",background:dc(ausencia.departamento),color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,flexShrink:0}}>
                {ausencia.empleado_iniciales}
              </div>
              <div>
                <div style={{fontSize:16,fontWeight:700,color:T1}}>{ausencia.empleado_nombre}</div>
                <div style={{fontSize:12,color:T3}}>{ausencia.departamento}</div>
              </div>
            </div>
            <button onClick={onClose} style={{background:"none",border:"none",color:T3,cursor:"pointer",fontSize:22,lineHeight:1,padding:0}}>×</button>
          </div>

          {/* Tipo */}
          <div style={{marginBottom:16}}>
            <div style={{fontSize:10,fontWeight:600,color:T3,marginBottom:6,letterSpacing:.5}}>TIPO DE AUSENCIA</div>
            <div style={{background:cfg.bg,color:cfg.text,padding:"6px 12px",borderRadius:8,fontSize:13,fontWeight:600,display:"inline-block"}}>
              {cfg.label}
            </div>
          </div>

          {/* Fechas */}
          <div style={{marginBottom:16}}>
            <div style={{fontSize:10,fontWeight:600,color:T3,marginBottom:6,letterSpacing:.5}}>FECHAS</div>
            <div style={{fontSize:13,color:T1}}>
              {ausencia.fecha_efectiva}
              {ausencia.recurrencia&&ausencia.recurrencia!=="ninguna"&&<span style={{color:T3,marginLeft:8}}>({ausencia.recurrencia})</span>}
            </div>
          </div>

          {/* Horario (si aplica) */}
          {(ausencia.hora_entrada||ausencia.hora_salida)&&(
            <div style={{marginBottom:16}}>
              <div style={{fontSize:10,fontWeight:600,color:T3,marginBottom:6,letterSpacing:.5}}>HORARIO</div>
              <div style={{fontSize:13,color:T1}}>
                {ausencia.hora_entrada&&<div>Entrada: {typeof ausencia.hora_entrada==='string'?ausencia.hora_entrada.slice(0,5):ausencia.hora_entrada}</div>}
                {ausencia.hora_salida&&<div>Salida: {typeof ausencia.hora_salida==='string'?ausencia.hora_salida.slice(0,5):ausencia.hora_salida}</div>}
              </div>
            </div>
          )}

          {/* Tipo de permiso (si aplica) */}
          {ausencia.tipo==="permiso"&&ausencia.tipo_permiso&&(
            <div style={{marginBottom:16}}>
              <div style={{fontSize:10,fontWeight:600,color:T3,marginBottom:6,letterSpacing:.5}}>DETALLE</div>
              <div style={{fontSize:13,color:T1}}>
                {ausencia.tipo_permiso==="entrada_tarde"?"Entrada tarde":"Salida temprana"}
                {ausencia.hora_permiso&&<span> a las {ausencia.hora_permiso.slice(0,5)}</span>}
              </div>
            </div>
          )}

          {/* Días de la semana (si aplica) */}
          {ausencia.dias_semana&&ausencia.dias_semana.length>0&&(
            <div style={{marginBottom:16}}>
              <div style={{fontSize:10,fontWeight:600,color:T3,marginBottom:6,letterSpacing:.5}}>DÍAS QUE APLICA</div>
              <div style={{fontSize:13,color:T1}}>
                {ausencia.dias_semana.map(n=>{
                  const nombres={1:"Lunes",2:"Martes",3:"Miércoles",4:"Jueves",5:"Viernes"};
                  return nombres[n]||"";
                }).filter(Boolean).join(", ")}
              </div>
            </div>
          )}

          {/* Registrado por */}
          <div style={{marginBottom:16,paddingTop:16,borderTop:`1px solid ${BD}`}}>
            <div style={{fontSize:10,fontWeight:600,color:T3,marginBottom:6,letterSpacing:.5}}>REGISTRADO POR</div>
            <div style={{fontSize:13,color:T2}}>
              {ausencia.registrado_por} · {ausencia.registrado_por_rol==="rh"?"RH":"Gerente"}
            </div>
          </div>

          {/* Nota interna (solo RH) */}
          {esRH&&ausencia.nota_interna&&(
            <div style={{marginBottom:16,padding:12,background:BG,borderRadius:8,borderLeft:`3px solid ${PR}`}}>
              <div style={{fontSize:10,fontWeight:600,color:T3,marginBottom:6,letterSpacing:.5}}>NOTA INTERNA (SOLO RH)</div>
              <div style={{fontSize:12,color:T2}}>{ausencia.nota_interna}</div>
            </div>
          )}

          {/* Botones (solo RH) */}
          {esRH&&(
            <div style={{display:"flex",gap:10,marginTop:20}}>
              <button onClick={onEditar} style={{flex:1,background:PR,color:"#fff",border:"none",padding:"11px",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"}}>
                ✏️ Editar
              </button>
              <button onClick={()=>setShowDeleteConfirm(true)} style={{flex:1,background:"#DC2626",color:"#fff",border:"none",padding:"11px",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"}}>
                🗑️ Eliminar
              </button>
            </div>
          )}
        </div>
      </div>
      {showDeleteConfirm&&<DeleteAusenciaModal ausencia={ausencia} onConfirm={onEliminar} onCancel={()=>setShowDeleteConfirm(false)}/>}
    </>
  );
}

/* ════════════════════════════════════════
   SCREEN: LOGIN
════════════════════════════════════════ */
function ScreenLogin({onLogin,onBack}){
  const [selUser,setSelUser]=useState(null);
  const [pwd,setPwd]=useState("");
  const [err,setErr]=useState(false);
  const [loading,setLoading]=useState(false);

  const check = async () => {
    if (!selUser || loading) return;
    setLoading(true);

    const isValid = await verifyDeptPassword(selUser.dept, pwd);

    setLoading(false);

    if (isValid) {
      onLogin(selUser);
    } else {
      setErr(true);
      setPwd("");
    }
  };

  return(
    <div style={{minHeight:"100vh",background:BG,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{width:"100%",maxWidth:460}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:8,marginBottom:8}}><Logo/></div>
          <div style={{fontSize:13,color:T2,marginTop:4}}>Sistema de gestión de tareas — Fine Pitch de México</div>
        </div>
        {onBack&&<button onClick={onBack} style={{width:"100%",background:"none",border:`1px solid ${BD}`,color:T2,padding:"10px",borderRadius:8,cursor:"pointer",fontSize:12,marginBottom:12,...fnt}}>← Continuar como invitado</button>}
        {!selUser?(
          <Card sx={{padding:20}}>
            <Lbl ch="SELECCIONA TU USUARIO"/>
            <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:"60vh",overflowY:"auto"}}>
              {USERS.map(u=>(
                <button key={u.id} className="rw" onClick={()=>{setSelUser(u);setPwd("");setErr(false);}}
                  style={{background:CARD,border:`1px solid ${BD}`,borderRadius:10,padding:"11px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:12,textAlign:"left",width:"100%"}}>
                  <Av u={u} size={34}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:T1}}>{u.name}</div>
                    <div style={{fontSize:11,color:T2}}>{u.dept}</div>
                  </div>
                  <span style={{color:T3,fontSize:16}}>›</span>
                </button>
              ))}
            </div>
          </Card>
        ):(
          <Card sx={{padding:24}}>
            <button onClick={()=>{setSelUser(null);setPwd("");setErr(false);}}
              style={{background:"none",border:"none",color:T2,cursor:"pointer",fontSize:13,marginBottom:20,padding:0,display:"flex",alignItems:"center",gap:6}}>
              ← Cambiar usuario
            </button>
            <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:24}}>
              <Av u={selUser} size={48}/>
              <div>
                <div style={{fontSize:16,fontWeight:700,color:T1}}>{selUser.name}</div>
                <div style={{fontSize:12,color:T2}}>{selUser.dept}</div>
              </div>
            </div>
            <Lbl ch="CONTRASEÑA DEL DEPARTAMENTO"/>
            <input type="password" value={pwd} onChange={e=>{setPwd(e.target.value);setErr(false);}} onKeyDown={async (e)=>{if(e.key==="Enter"&&!loading)await check()}} placeholder="Contraseña..." autoFocus style={{...inp,marginBottom:8,borderColor:err?"#DC2626":BD}} disabled={loading}/>
            {err&&<div style={{fontSize:12,color:"#DC2626",marginBottom:10}}>Contraseña incorrecta.</div>}
            <button onClick={check} disabled={!pwd.trim()||loading} style={{width:"100%",background:PR,color:"#fff",border:"none",padding:"12px",borderRadius:8,fontSize:13,fontWeight:700,cursor:loading||!pwd.trim()?"not-allowed":"pointer",opacity:loading||!pwd.trim()?0.6:1}}>{loading?"Verificando...":"Ingresar"}</button>
          </Card>
        )}
      </div>
    </div>
  );
}

// Componente: FormularioAusencia
function FormularioAusencia({user,onClose,onSave,ausenciaEditar}){
  const modoEdicion=!!ausenciaEditar;

  // Precargar datos si estamos en modo edición
  const empInit=modoEdicion?USERS.find(u=>u.name===ausenciaEditar.empleado_nombre)?.id||"":"";
  const [empleadoId,setEmpleadoId]=useState(empInit);
  const [tipo,setTipo]=useState(modoEdicion?ausenciaEditar.tipo:"vacaciones");
  const [fechaInicio,setFechaInicio]=useState(modoEdicion?ausenciaEditar.fecha_efectiva:"");
  const [fechaFin,setFechaFin]=useState(modoEdicion?(ausenciaEditar.fecha_fin||ausenciaEditar.fecha_efectiva):"");
  const [horaPermiso,setHoraPermiso]=useState(modoEdicion?(ausenciaEditar.hora_permiso||""):"");
  const [tipoPermiso,setTipoPermiso]=useState(modoEdicion?(ausenciaEditar.tipo_permiso||"entrada_tarde"):"entrada_tarde");
  const [horaEntrada,setHoraEntrada]=useState(modoEdicion?(ausenciaEditar.hora_entrada||""):"");
  const [horaSalida,setHoraSalida]=useState(modoEdicion?(ausenciaEditar.hora_salida||""):"");
  const [recurrencia,setRecurrencia]=useState(modoEdicion?(ausenciaEditar.recurrencia||"ninguna"):"ninguna");
  const [diasSemana,setDiasSemana]=useState(modoEdicion?(ausenciaEditar.dias_semana||[]):[]);
  const [notaInterna,setNotaInterna]=useState(modoEdicion?(ausenciaEditar.nota_interna||""):"");
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");

  const empleado=USERS.find(u=>u.id===parseInt(empleadoId));

  // Calcular días hábiles para vacaciones
  const diasHabiles=useMemo(()=>{
    if(tipo!=="vacaciones"||!fechaInicio||!fechaFin)return 0;
    const inicio=new Date(fechaInicio+"T12:00:00");
    const fin=new Date(fechaFin+"T12:00:00");
    let count=0,current=new Date(inicio);
    while(current<=fin){
      const dow=current.getDay();
      if(dow!==0&&dow!==6)count++;
      current.setDate(current.getDate()+1);
    }
    return count;
  },[tipo,fechaInicio,fechaFin]);

  // Vista previa
  const vistaPrevia=useMemo(()=>{
    if(!empleado||!tipo)return "";
    const cfg=TIPO_AUSENCIA_CONFIG[tipo];
    let texto=`${empleado.name} · ${cfg.label}`;
    if(tipo==="vacaciones"&&fechaInicio&&fechaFin){
      const fi=new Date(fechaInicio+"T12:00:00");
      const ff=new Date(fechaFin+"T12:00:00");
      texto+=` · ${fi.getDate()}/${fi.getMonth()+1}–${ff.getDate()}/${ff.getMonth()+1}`;
      if(diasHabiles>0)texto+=` · ${diasHabiles} día${diasHabiles>1?"s":""}`;
    }else if(tipo==="permiso"&&fechaInicio&&horaPermiso){
      const fi=new Date(fechaInicio+"T12:00:00");
      texto+=` · ${fi.getDate()}/${fi.getMonth()+1} · ${tipoPermiso==="entrada_tarde"?"Entrada tarde":"Salida temprana"} ${horaPermiso}`;
    }else if((tipo==="dia_asignado"||tipo==="esquema_reducido")&&fechaInicio){
      const fi=new Date(fechaInicio+"T12:00:00");
      texto+=` · desde ${fi.getDate()}/${fi.getMonth()+1}`;
      if(fechaFin){
        const ff=new Date(fechaFin+"T12:00:00");
        texto+=` hasta ${ff.getDate()}/${ff.getMonth()+1}`;
      }
      if(diasSemana.length>0){
        const labels=diasSemana.map(n=>DIAS_SEMANA_OPTS.find(d=>d.n===n)?.l).join(",");
        texto+=` · ${labels}`;
      }
      if(recurrencia!=="ninguna")texto+=` · ${recurrencia}`;
    }
    return texto;
  },[empleado,tipo,fechaInicio,fechaFin,horaPermiso,tipoPermiso,recurrencia,diasSemana,diasHabiles]);

  // Validaciones
  const validar=()=>{
    if(!empleado){setError("Selecciona un empleado");return false;}
    if(!tipo){setError("Selecciona un tipo de ausencia");return false;}
    if(!fechaInicio){setError("Selecciona la fecha de inicio");return false;}
    const fi=new Date(fechaInicio+"T12:00:00");
    const hoy=new Date();hoy.setHours(0,0,0,0);
    const hace30Dias=new Date();hace30Dias.setDate(hace30Dias.getDate()-30);hace30Dias.setHours(0,0,0,0);
    if(fi<hace30Dias){setError("La fecha de inicio no puede estar más de 30 días en el pasado");return false;}
    if(tipo==="vacaciones"&&!fechaFin){setError("Selecciona la fecha de fin");return false;}
    if(fechaFin){
      const ff=new Date(fechaFin+"T12:00:00");
      if(ff<fi){setError("La fecha de fin debe ser posterior o igual a la de inicio");return false;}
    }
    if(tipo==="permiso"&&!horaPermiso){setError("Ingresa la hora del permiso");return false;}
    // Para dia_asignado y esquema_reducido con recurrencia (no "ninguna"), validar días de semana
    if((tipo==="dia_asignado"||tipo==="esquema_reducido")&&recurrencia!=="ninguna"&&diasSemana.length===0){
      setError("Selecciona al menos un día de la semana para la recurrencia elegida");return false;
    }
    return true;
  };

  const handleGuardar=async()=>{
    if(!validar())return;

    // Validar que el usuario exista
    if(!user){
      setError("No hay usuario autenticado");
      console.error("[FormularioAusencia] No user found");
      return;
    }

    setSaving(true);
    setError("");

    // Debug: verificar valores de hora_entrada y hora_salida antes de armar el payload
    console.log('[DEBUG] hora_entrada:', horaEntrada, 'hora_salida:', horaSalida);

    const payload={
      empleado_nombre:empleado.name,
      empleado_iniciales:empleado.ini,
      departamento:empleado.dept,
      tipo,
      fecha_inicio:fechaInicio, // Ya es string 'YYYY-MM-DD'
      fecha_fin:tipo==="permiso"?fechaInicio:(fechaFin||fechaInicio),
      hora_permiso:tipo==="permiso"?horaPermiso:null,
      tipo_permiso:tipo==="permiso"?tipoPermiso:null,
      hora_entrada:horaEntrada||null,
      hora_salida:horaSalida||null,
      recurrencia:tipo==="vacaciones"?"ninguna":(recurrencia||"ninguna"),
      dias_semana:(tipo==="dia_asignado"||tipo==="esquema_reducido")&&recurrencia!=="ninguna"?(diasSemana.length>0?diasSemana:null):null,
      nota_interna:notaInterna.trim()||null,
      registrado_por:user.name||"Usuario",
      registrado_por_rol:rolRegistroAusencia(user)||"gerente",
    };

    console.log(`[FormularioAusencia] Payload a ${modoEdicion?"actualizar":"insertar"}:`,payload);
    console.log(`[FormularioAusencia] diasSemana array:`,diasSemana,`→ payload.dias_semana:`,payload.dias_semana);

    let data,err;
    if(modoEdicion){
      // UPDATE
      const res=await supabase.from("ausencias").update(payload).eq("id",ausenciaEditar.id);
      data=res.data;
      err=res.error;
    }else{
      // INSERT
      const res=await supabase.from("ausencias").insert(payload);
      data=res.data;
      err=res.error;
    }

    setSaving(false);

    if(err){
      const errorMsg=`Error al guardar: ${err.message}`;
      setError(errorMsg);
      console.error(`[Supabase] Error ${modoEdicion?"UPDATE":"INSERT"} ausencias:`,err);
      console.error("[Supabase] Error details:",{
        message:err.message,
        details:err.details,
        hint:err.hint,
        code:err.code,
        payload
      });
      return;
    }

    console.log(`[Supabase] ${modoEdicion?"UPDATE":"INSERT"} ausencias exitoso:`,data);

    // Notificar que se guardó exitosamente - el realtime recargará automáticamente
    console.log("[FormularioAusencia] Guardado exitoso, cerrando modal");
    onClose();
  };

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.7)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:24,overflowY:"auto"}}>
      <div style={{background:CARD,borderRadius:16,padding:28,width:"100%",maxWidth:520,boxShadow:SHm,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div style={{fontSize:16,fontWeight:700,color:T1}}>{modoEdicion?"Editar ausencia":"Nueva ausencia"}</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:T3,cursor:"pointer",fontSize:22,lineHeight:1,padding:0}}>×</button>
        </div>

        {/* Empleado */}
        <Lbl ch="EMPLEADO"/>
        <select value={empleadoId} onChange={e=>setEmpleadoId(e.target.value)} style={{...inp,marginBottom:16}}>
          <option value="">Selecciona...</option>
          {USERS.map(u=><option key={u.id} value={u.id}>{u.name} ({u.dept})</option>)}
        </select>

        {/* Tipo */}
        <Lbl ch="TIPO DE AUSENCIA"/>
        <select value={tipo} onChange={e=>{setTipo(e.target.value);setRecurrencia(e.target.value==="vacaciones"?"ninguna":"ninguna");}} style={{...inp,marginBottom:16}}>
          {Object.entries(TIPO_AUSENCIA_CONFIG).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
        </select>

        {/* Fecha inicio */}
        <Lbl ch="FECHA INICIO"/>
        <input type="date" value={fechaInicio} onChange={e=>setFechaInicio(e.target.value)} style={{...inp,marginBottom:16}}/>

        {/* Fecha fin (no para permiso) */}
        {tipo!=="permiso"&&(<>
          <Lbl ch={tipo==="vacaciones"?"FECHA FIN (obligatorio)":"FECHA FIN (opcional)"}/>
          <input type="date" value={fechaFin} onChange={e=>setFechaFin(e.target.value)} style={{...inp,marginBottom:16}}/>
        </>)}

        {/* Permiso: hora y tipo */}
        {tipo==="permiso"&&(<>
          <Lbl ch="TIPO DE PERMISO"/>
          <select value={tipoPermiso} onChange={e=>setTipoPermiso(e.target.value)} style={{...inp,marginBottom:16}}>
            <option value="entrada_tarde">Entrada tarde</option>
            <option value="salida_temprana">Salida temprana</option>
          </select>
          <Lbl ch="HORA"/>
          <input type="time" value={horaPermiso} onChange={e=>setHoraPermiso(e.target.value)} style={{...inp,marginBottom:16}}/>
          <Lbl ch="HORA DE ENTRADA (opcional)"/>
          <input type="time" value={horaEntrada} onChange={e=>setHoraEntrada(e.target.value)} style={{...inp,marginBottom:16}}/>
          <Lbl ch="HORA DE SALIDA (opcional)"/>
          <input type="time" value={horaSalida} onChange={e=>setHoraSalida(e.target.value)} style={{...inp,marginBottom:16}}/>
        </>)}

        {/* Día asignado / esquema reducido: recurrencia + días de semana condicionales */}
        {(tipo==="dia_asignado"||tipo==="esquema_reducido")&&(<>
          <Lbl ch="RECURRENCIA (opcional)"/>
          <select value={recurrencia} onChange={e=>{
            const newRec=e.target.value;
            setRecurrencia(newRec);
            // Si cambia a "ninguna", limpiar días de semana
            if(newRec==="ninguna")setDiasSemana([]);
          }} style={{...inp,marginBottom:16}}>
            <option value="ninguna">Sin repetición</option>
            <option value="semanal">Semanal</option>
            <option value="quincenal">Quincenal</option>
            <option value="mensual">Mensual</option>
          </select>
          {/* Días de la semana: solo mostrar si hay recurrencia */}
          {recurrencia!=="ninguna"&&(<>
            <Lbl ch="DÍAS DE LA SEMANA"/>
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              {DIAS_SEMANA_OPTS.map(d=>(
                <button key={d.n} onClick={()=>setDiasSemana(p=>p.includes(d.n)?p.filter(x=>x!==d.n):[...p,d.n])}
                  style={{background:diasSemana.includes(d.n)?PR:BG,color:diasSemana.includes(d.n)?"#fff":T2,border:`1px solid ${diasSemana.includes(d.n)?PR:BD}`,width:40,height:40,borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,transition:"all .12s"}}>
                  {d.l}
                </button>
              ))}
            </div>
          </>)}
          {tipo==="esquema_reducido"&&(<>
            <Lbl ch="HORA DE ENTRADA (opcional)"/>
            <input type="time" value={horaEntrada} onChange={e=>setHoraEntrada(e.target.value)} style={{...inp,marginBottom:16}}/>
            <Lbl ch="HORA DE SALIDA (opcional)"/>
            <input type="time" value={horaSalida} onChange={e=>setHoraSalida(e.target.value)} style={{...inp,marginBottom:16}}/>
          </>)}
        </>)}

        {/* Vacaciones: mostrar días hábiles calculados */}
        {tipo==="vacaciones"&&fechaInicio&&fechaFin&&diasHabiles>0&&(
          <div style={{padding:10,background:PRl+"40",borderRadius:8,marginBottom:16,fontSize:12,color:PR,fontWeight:600}}>
            📆 {diasHabiles} día{diasHabiles>1?"s":""} hábil{diasHabiles>1?"es":""}
          </div>
        )}

        {/* Nota interna */}
        <Lbl ch="NOTA INTERNA (solo visible para RH)"/>
        <textarea value={notaInterna} onChange={e=>setNotaInterna(e.target.value)} placeholder="Ej. aprobado por gerente vía email..." style={{...inp,minHeight:60,resize:"vertical",marginBottom:16}}/>

        {/* Vista previa */}
        {vistaPrevia&&(
          <div style={{padding:12,background:BG,borderRadius:8,marginBottom:16,fontSize:12,color:T2}}>
            <div style={{fontSize:10,fontWeight:600,color:T3,marginBottom:4}}>VISTA PREVIA</div>
            {vistaPrevia}
          </div>
        )}

        {/* Error */}
        {error&&<div style={{padding:10,background:"#FEF2F2",border:"1px solid #FCA5A5",borderRadius:8,fontSize:12,color:"#DC2626",marginBottom:16}}>{error}</div>}

        {/* Botones */}
        <div style={{display:"flex",gap:10}}>
          <button onClick={onClose} disabled={saving} style={{flex:1,background:BG,border:`1px solid ${BD}`,color:T2,padding:"11px",borderRadius:8,fontSize:13,cursor:saving?"not-allowed":"pointer",fontWeight:500}}>Cancelar</button>
          <button onClick={handleGuardar} disabled={saving} style={{flex:1,background:saving?"#94A3B8":PR,color:"#fff",border:"none",padding:"11px",borderRadius:8,fontSize:13,fontWeight:700,cursor:saving?"not-allowed":"pointer"}}>
            {saving?"Guardando...":"Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   SCREEN: DASHBOARD
════════════════════════════════════════ */
function ScreenDashboard({tasks,user,onStatClick,onDeptClick,onPickerDeptClick,onTaskClick,onNewTask,onSearch,onStats,onMyTasks,onCalendar,onDelays,onDeleted,onStuck,userIsAuthed,onRequestAuth,deptIsAuthed,dbConnected,onAvisos,unreadAvisos,isGuest,onLogin,onNotif,onLogout,unreadNotif,onAusencias,onQuickTasks,quickTasksCount,ausencias,cargarAusencias}){
  const scrollRef=useScrollRestore("dashboard");
  const [pickerOpen,setPickerOpen]=useState(false);
  const [tab,setTab]=useState("active");
  const [detalleAusencia,setDetalleAusencia]=useState(null);
  const isMobile=useIsMobile();

  const deptCards=useMemo(()=>DEPTS.map(dept=>{
    const mine=tasks.filter(t=>t.responsible?.dept===dept||(t.invIds||[]).some(id=>USERS.find(x=>x.id===id)?.dept===dept));
    const active=mine.filter(isActive);
    const sorted=[...active].sort((a,b)=>({Alta:0,Media:1,Baja:2}[a.priority]||1)-({Alta:0,Media:1,Baja:2}[b.priority]||1));
    const deptMembers=USERS.filter(u=>u.dept===dept).map(m=>{
      const taskCount=mine.filter(t=>{
        if(!isActive(t)||t.status==="Bloqueada") return false;
        if(t.responsible?.id===m.id) return true;
        const idx=(t.invIds||[]).indexOf(m.id);
        if(idx===-1) return false;
        const sids=getStageIds(t.invIds||[],t.flowStageIds);
        return (t.flowStates?.[sids[idx]]||"Pendiente")!=="Completado";
      }).length;
      return{...m,taskCount};
    });
    return{dept,active,nearest:sorted[0]||null,altas:active.filter(t=>t.priority==="Alta").length,venc:active.filter(t=>isOver(t.deadline,t.status)).length,today:active.filter(t=>isTodayDeadline(t.deadline)).length,riesgo:active.filter(isAtRisk).length,members:deptMembers};
  }),[tasks]);

  const totals=useMemo(()=>({
    active:tasks.filter(isActive).length,
    alta:tasks.filter(t=>t.priority==="Alta"&&isActive(t)).length,
    venc:tasks.filter(t=>isOver(t.deadline,t.status)).length,
  }),[tasks]);

  const doneCards=useMemo(()=>DEPTS.map(dept=>{
    const mine=tasks.filter(t=>t.responsible?.dept===dept||(t.invIds||[]).some(id=>USERS.find(x=>x.id===id)?.dept===dept));
    const done=[...mine.filter(t=>t.status==="Completada")].sort((a,b)=>new Date(b.completedAt||b.createdAt||0)-new Date(a.completedAt||a.createdAt||0));
    return{dept,done};
  }),[tasks]);

  return(
    <div ref={scrollRef} style={{minHeight:"100vh",background:BG,overflowY:"auto"}}>
      <NavBar left={<Logo/>}
        center={null}
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
          {!isGuest&&<button onClick={onAvisos} style={{position:"relative",background:"none",border:`1px solid ${BD}`,borderRadius:20,width:36,height:36,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0,transition:"all .15s"}}
            className="ub" title="Avisos">
            🔔
            {unreadAvisos>0&&<span style={{position:"absolute",top:-4,right:-4,background:"#DC2626",color:"#fff",borderRadius:20,fontSize:9,fontWeight:700,padding:"1px 6px",lineHeight:"14px",minWidth:16,textAlign:"center"}}>{unreadAvisos}</span>}
          </button>}
          {!isGuest&&<button onClick={onAusencias} style={{background:"none",border:`1px solid ${BD}`,borderRadius:20,width:36,height:36,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0,transition:"all .15s"}}
            className="ub" title="Ausencias">
            📆
          </button>}
          {!isGuest&&<button onClick={onQuickTasks} style={{position:"relative",background:"none",border:`1px solid ${BD}`,borderRadius:20,width:36,height:36,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0,transition:"all .15s"}}
            className="ub" title="Tareas Rápidas">
            ⚡
            {quickTasksCount>0&&<span style={{position:"absolute",top:-4,right:-4,background:"#3B82F6",color:"#fff",borderRadius:20,fontSize:9,fontWeight:700,padding:"1px 6px",lineHeight:"14px",minWidth:16,textAlign:"center"}}>{quickTasksCount}</span>}
          </button>}
          <div title={dbConnected===null?"Conectando a Supabase...":dbConnected?"Supabase conectado":"Error de conexión con Supabase"}
            style={{display:"flex",alignItems:"center",gap:5,padding:"3px 9px",borderRadius:20,border:`1px solid ${dbConnected===null?BD:dbConnected?"#A7F3D0":"#FECACA"}`,background:dbConnected===null?BG:dbConnected?"#ECFDF5":"#FEF2F2"}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:dbConnected===null?"#94A3B8":dbConnected?"#059669":"#DC2626",
              animation:dbConnected===null?"pl 1.4s ease-in-out infinite":undefined}}/>
            {!isMobile&&<span style={{fontSize:10,fontWeight:600,color:dbConnected===null?T3:dbConnected?"#059669":"#DC2626"}}>
              {dbConnected===null?"Conectando":dbConnected?"Supabase":"Sin conexión"}
            </span>}
          </div>
          {isGuest?(
            <button onClick={onLogin} style={{background:PR,color:"#fff",border:"none",padding:"8px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700,...fnt}}>Iniciar sesión</button>
          ):(
            <>
              <Av u={user} size={36}/>
              <button onClick={onLogout} className="nb" title="Cerrar sesión" style={{fontSize:11,color:T3}}>Salir</button>
            </>
          )}
        </>}
      />

      {userIsAuthed&&(
        <div className="snav" style={{background:CARD,borderBottom:`1px solid ${BD}`,padding:isMobile?"6px 16px":"0 16px",display:"flex",alignItems:"center",gap:6,height:isMobile?"auto":44,justifyContent:isMobile?"flex-start":"center",flexWrap:"wrap"}}>
          {user?.dept==="Dirección"&&<button className="nb" onClick={onDelays} style={{fontSize:11}}>🚨 Retrasos</button>}
          {(user?.dept==="Dirección"||user?.dept==="Ingenieria")&&<button className="nb" onClick={onDeleted} style={{fontSize:11}}>🗑️ Eliminadas</button>}
          <button className="nb" onClick={onStuck}  style={{fontSize:11}}>⏸ Estancadas</button>
          <button className="nb" onClick={onSearch}  style={{fontSize:11}}>🔍 Buscar</button>
          <button className="nb" onClick={onMyTasks} style={{fontSize:11}}>👤 Mis Tareas</button>
          <button className="nb" onClick={onCalendar}style={{fontSize:11}}>📅 Calendario</button>
          <button className="nb" onClick={onStats}   style={{fontSize:11}}>📊 Estadísticas</button>
          <button className="nb" onClick={onNotif} style={{fontSize:11,position:"relative"}}>
            📋 Notificaciones
            {unreadNotif>0&&<span style={{background:"#DC2626",color:"#fff",borderRadius:20,fontSize:9,fontWeight:700,padding:"1px 6px",lineHeight:"14px",marginLeft:4}}>{unreadNotif}</span>}
          </button>
        </div>
      )}

      {/* Alert banner */}
      <AlertBanner tasks={tasks} onClickOverdue={()=>onStatClick("vencidas")} onClickToday={()=>onStatClick("today")}/>

      <div style={{maxWidth:1100,margin:"0 auto",padding:"20px 24px"}}>
        <AusentesHoyWidget ausencias={ausencias} onVerMas={onAusencias} onOpenDetalle={setDetalleAusencia}/>
        {/* Tabs */}
        <div style={{display:"flex",gap:8,marginBottom:20}}>
          {[["active","Activas"],["done","Completadas"]].map(([v,l])=>(
            <button key={v} onClick={()=>setTab(v)}
              style={{background:tab===v?PR:CARD,color:tab===v?"#fff":T2,border:`1px solid ${tab===v?PR:BD}`,padding:"7px 14px",borderRadius:20,cursor:"pointer",fontSize:12,fontWeight:500,transition:"all .12s"}}>
              {l}
            </button>
          ))}
        </div>

        {tab==="active"&&(<>
        {/* Stats */}
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(3,minmax(0,1fr))",gap:12,marginBottom:24}}>
          {[
            {key:"active",   l:"Tareas activas",  v:totals.active, c:PR,        bg:PRl,       icon:"📋"},
            {key:"alta",     l:"Alta prioridad",   v:totals.alta,   c:"#DC2626", bg:"#FEF2F2", icon:"🔥"},
            {key:"vencidas", l:"Tareas vencidas",  v:totals.venc,   c:"#D97706", bg:"#FFFBEB", icon:"⚠️"},
          ].map(s=>(
            <Card key={s.key} cls="dc" sx={{padding:"16px 18px",display:"flex",alignItems:"center",gap:12,borderTop:`3px solid ${s.c}`,minWidth:0,overflow:"hidden"}} onClick={()=>onStatClick(s.key)}>
              <div style={{width:40,height:40,borderRadius:10,background:s.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{s.icon}</div>
              <div style={{minWidth:0}}>
                <div style={{fontSize:26,fontWeight:700,color:s.c,lineHeight:1}}>{s.v}</div>
                <div style={{fontSize:11,color:T2,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.l}</div>
              </div>
            </Card>
          ))}
        </div>

        {/* Dept widgets */}
        <div style={{fontSize:12,fontWeight:600,color:T2,marginBottom:12,letterSpacing:.5}}>PENDIENTES POR DEPARTAMENTO</div>
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(3,minmax(0,1fr))",gap:12}}>
          {deptCards.map(d2=>(
            <Card key={d2.dept} cls="dc" sx={{padding:16,borderLeft:`4px solid ${dc(d2.dept)}`,minWidth:0,overflow:"hidden"}} onClick={()=>onDeptClick(d2.dept)}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,gap:8}}>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{width:9,height:9,borderRadius:"50%",background:dc(d2.dept),marginBottom:7}}/>
                  <div style={{fontSize:14,fontWeight:700,color:T1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d2.dept}</div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontSize:28,fontWeight:700,color:dc(d2.dept),lineHeight:1}}>{d2.active.length}</div>
                  <div style={{fontSize:10,color:T3}}>activas</div>
                </div>
              </div>
              {d2.nearest&&(
                <div style={{background:BG,borderRadius:8,padding:"8px 10px",marginBottom:10,minWidth:0,overflow:"hidden"}}>
                  <div style={{fontSize:11,fontWeight:600,color:T2,marginBottom:2}}>Más urgente</div>
                  <div style={{fontSize:12,color:T1,fontWeight:500,marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d2.nearest.title}</div>
                  <div style={{fontSize:11,color:dlStatus(d2.nearest.deadline,d2.nearest.status).c,fontWeight:600}}>{dlStatus(d2.nearest.deadline,d2.nearest.status).label}</div>
                </div>
              )}
              {d2.active.length===0&&<div style={{fontSize:12,color:T3,fontStyle:"italic",marginBottom:10}}>Sin tareas activas</div>}
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {d2.altas>0 &&<Badge ch={`🔥 ${d2.altas} Alta`}    c="#DC2626" bg="#FEF2F2"/>}
                {d2.venc>0  &&<Badge ch={`⚠️ ${d2.venc} Venc.`}   c="#DC2626" bg="#FEF2F2"/>}
                {d2.riesgo>0&&<Badge ch={`🕐 ${d2.riesgo} Riesgo`} c="#D97706" bg="#FFFBEB"/>}
                {d2.today>0 &&<Badge ch={`🟠 ${d2.today} Hoy`}    c="#EA580C" bg="#FFF7ED"/>}
                {d2.altas===0&&d2.venc===0&&d2.riesgo===0&&d2.today===0&&<span style={{fontSize:11,color:T3}}>Sin alertas</span>}
              </div>
              {d2.members.length>0&&(
                <div style={{borderTop:`1px solid ${BD}`,marginTop:10,paddingTop:10}}>
                  <div style={{fontSize:10,fontWeight:600,color:T3,letterSpacing:.4,marginBottom:6}}>USUARIOS</div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    {d2.members.map(m=>(
                      <div key={m.id} style={{display:"flex",alignItems:"center",gap:6,justifyContent:"space-between"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,minWidth:0}}>
                          <Av u={m} size={20}/>
                          <span style={{fontSize:11,color:T1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{shortName(m.name)}</span>
                        </div>
                        {m.taskCount>0&&<span style={{fontSize:10,fontWeight:700,color:dc(m.dept),background:dc(m.dept)+"18",padding:"2px 7px",borderRadius:10,flexShrink:0}}>{m.taskCount}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
        </>)}

        {tab==="done"&&(<>
        {/* Dept widgets - completadas */}
        <div style={{fontSize:12,fontWeight:600,color:T2,marginBottom:12,letterSpacing:.5}}>TAREAS COMPLETADAS POR DEPARTAMENTO</div>
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(3,minmax(0,1fr))",gap:12}}>
          {doneCards.map(d2=>(
            <Card key={d2.dept} cls="dc" sx={{padding:16,borderLeft:"4px solid #059669",minWidth:0,overflow:"hidden"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,gap:8}}>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{width:9,height:9,borderRadius:"50%",background:dc(d2.dept),marginBottom:7}}/>
                  <div style={{fontSize:14,fontWeight:700,color:T1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d2.dept}</div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontSize:28,fontWeight:700,color:"#059669",lineHeight:1}}>{d2.done.length}</div>
                  <div style={{fontSize:10,color:T3}}>completadas</div>
                </div>
              </div>
              {d2.done.length===0&&<div style={{fontSize:12,color:T3,fontStyle:"italic"}}>Sin tareas completadas</div>}
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {d2.done.map(t=>(
                  <div key={t.id} className="rw" onClick={()=>onTaskClick(t)}
                    style={{display:"flex",alignItems:"flex-start",gap:8,padding:"8px 10px",borderRadius:8,background:"#ECFDF5",minWidth:0}}>
                    <div style={{width:8,height:8,borderRadius:"50%",background:"#059669",flexShrink:0,marginTop:4}}/>
                    <div style={{minWidth:0,flex:1}}>
                      <div style={{fontSize:12,fontWeight:600,color:T1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div>
                      <div style={{fontSize:10,color:T3,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {t.id} · {fmtCompletedDate(t.completedAt||t.createdAt)} · Originó: {t.creator?.name||"—"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
        </>)}
      </div>

      {!isGuest&&<button onClick={userIsAuthed?onNewTask:onRequestAuth} className="fab"
        title={userIsAuthed?"Nueva tarea":"Ingresa tu contraseña para crear tareas"}
        style={{position:"fixed",bottom:28,right:28,background:userIsAuthed?PR:"#94A3B8",color:"#fff",border:"none",width:56,height:56,fontSize:26,cursor:"pointer",borderRadius:"50%",boxShadow:"0 4px 20px rgba(67,56,202,.35)",zIndex:40,lineHeight:1}}>
        {userIsAuthed?"+":"🔒"}
      </button>}
      {detalleAusencia&&<ModalDetalleAusencia ausencia={detalleAusencia} onClose={()=>setDetalleAusencia(null)} user={user} onEditar={()=>{/* TODO */}} onEliminar={async()=>{/* TODO */}}/>}
    </div>
  );
}

/* ════════════════════════════════════════
   SCREEN: MIS TAREAS
════════════════════════════════════════ */
function ScreenMyTasks({tasks,user,onBack,onTaskClick}){
  const scrollRef=useScrollRestore("myTasks");
  const [tab,setTab]=useState("active");
  const isMobile=useIsMobile();
  const prioOrder={Alta:0,Media:1,Baja:2};

  const respTasks=useMemo(()=>tasks.filter(t=>t.responsible?.id===user.id&&isActive(t)),[tasks,user]);
  const invTasks =useMemo(()=>tasks.filter(t=>(t.invIds||[]).includes(user.id)&&t.responsible?.id!==user.id&&isActive(t)),[tasks,user]);
  const activeTasks=useMemo(()=>[
    ...respTasks.map(t=>({t,role:"Responsable"})),
    ...invTasks.map(t=>({t,role:"Involucrado"})),
  ].sort((a,b)=>(prioOrder[a.t.priority]??1)-(prioOrder[b.t.priority]??1)),[respTasks,invTasks]);
  const doneTasks=useMemo(()=>tasks.filter(t=>t.responsible?.id===user.id&&t.status==="Completada").map(t=>({t,role:"Responsable"})),[tasks,user]);

  const list=tab==="active"?activeTasks:doneTasks;

  return(
    <div ref={scrollRef} style={{minHeight:"100vh",background:BG,overflowY:"auto"}}>
      <NavBar left={<><BackBtn onClick={onBack}/><div>
          <div style={{fontWeight:700,fontSize:15,color:T1}}>Mis Tareas</div>
          <div style={{fontSize:11,color:T2}}>{user.name} · {user.dept}</div>
        </div></>}
        center={null}
        right={<Av u={user} size={36}/>}
      />
      <div style={{maxWidth:900,margin:"0 auto",padding:"24px"}}>
        {/* Summary cards */}
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(2,1fr)",gap:10,marginBottom:24}}>
          {[
            {tab:"active",label:"Tareas activas",v:activeTasks.length,c:PR,bg:PRl},
            {tab:"done",  label:"Completadas",    v:doneTasks.length,  c:"#6B7280",bg:"#F9FAFB"},
          ].map(s=>(
            <Card key={s.tab} cls="dc" sx={{padding:"14px 16px",borderTop:`2px solid ${s.c}`,cursor:"pointer",outline:tab===s.tab?`2px solid ${s.c}`:"none"}} onClick={()=>setTab(s.tab)}>
              <div style={{fontSize:24,fontWeight:700,color:s.c,lineHeight:1}}>{s.v}</div>
              <div style={{fontSize:11,color:T2,marginTop:4}}>{s.label}</div>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <div style={{display:"flex",gap:8,marginBottom:20}}>
          {[["active","Activas"],["done","Completadas"]].map(([v,l])=>(
            <button key={v} onClick={()=>setTab(v)}
              style={{background:tab===v?PR:CARD,color:tab===v?"#fff":T2,border:`1px solid ${tab===v?PR:BD}`,padding:"7px 14px",borderRadius:20,cursor:"pointer",fontSize:12,fontWeight:500,transition:"all .12s"}}>
              {l}
            </button>
          ))}
        </div>

        {list.length===0&&<div style={{textAlign:"center",padding:"60px 0",color:T3,fontSize:14}}>Sin tareas en esta sección</div>}
        {list.map(({t,role})=><TRow key={t.id} t={t} roleBadge={role} onClick={()=>onTaskClick(t)}/>)}
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
function ScreenSearch({tasks,user,onBack,onTaskClick,avisos,onAvisoClick}){
  const scrollRef=useScrollRestore("search");
  const [q,setQ]=useState("");
  const taskResults=useMemo(()=>{
    if(!q.trim()) return [];
    const lq=q.toLowerCase();
    return tasks.filter(t=>t.title.toLowerCase().includes(lq)||t.description?.toLowerCase().includes(lq)||t.id.toLowerCase().includes(lq)||t.responsible?.name?.toLowerCase().includes(lq)||t.responsible?.dept?.toLowerCase().includes(lq)||t.type?.toLowerCase().includes(lq)).slice(0,20);
  },[tasks,q]);
  const avisoResults=useMemo(()=>{
    if(!q.trim()) return [];
    const lq=q.toLowerCase();
    return avisos.filter(a=>a.texto?.toLowerCase().includes(lq)||a.origen?.name?.toLowerCase().includes(lq)||a.origen?.dept?.toLowerCase().includes(lq)).slice(0,10);
  },[avisos,q]);
  const total=taskResults.length+avisoResults.length;
  const fmtFechaShort=f=>{const d=new Date(f);return d.toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"});};
  return(
    <div ref={scrollRef} style={{minHeight:"100vh",background:BG,overflowY:"auto"}}>
      <NavBar left={<><BackBtn onClick={onBack}/><Logo/></>}
        center={<input value={q} onChange={e=>setQ(e.target.value)} autoFocus placeholder="Buscar tareas o avisos..." style={{...inp,width:"min(400px,60vw)",borderRadius:20}}/>}
        right={null}
      />
      <div style={{maxWidth:900,margin:"0 auto",padding:"24px"}}>
        {!q.trim()&&<div style={{textAlign:"center",padding:"60px 0",color:T3,fontSize:14}}>Empieza a escribir para buscar tareas o avisos...</div>}
        {q.trim()&&total===0&&<div style={{textAlign:"center",padding:"60px 0",color:T3,fontSize:14}}>Sin resultados para "{q}"</div>}
        {taskResults.length>0&&(
          <>
            <div style={{fontSize:11,fontWeight:700,color:T3,letterSpacing:.8,marginBottom:8}}>TAREAS ({taskResults.length})</div>
            {taskResults.map(t=><TRow key={t.id} t={t} onClick={()=>onTaskClick(t)}/>)}
          </>
        )}
        {avisoResults.length>0&&(
          <>
            <div style={{fontSize:11,fontWeight:700,color:T3,letterSpacing:.8,margin:`${taskResults.length>0?20:0}px 0 8px`}}>AVISOS ({avisoResults.length})</div>
            {avisoResults.map(a=>(
              <Card key={a.id} cls="rw" onClick={()=>onAvisoClick(a)} sx={{padding:"14px 18px",marginBottom:8,borderLeft:`3px solid #F59E0B`}}>
                <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                  <div style={{width:32,height:32,borderRadius:"50%",background:"#FEF3C7",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:15}}>📢</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4,gap:8,flexWrap:"wrap"}}>
                      <span style={{fontSize:12,fontWeight:700,color:T1}}>{a.origen?.name}<span style={{fontWeight:400,color:T3}}> · {a.origen?.dept}</span></span>
                      <span style={{fontSize:10,color:T3,whiteSpace:"nowrap"}}>{fmtFechaShort(a.fecha)}</span>
                    </div>
                    <p style={{fontSize:13,color:T2,lineHeight:1.5,margin:0,overflow:"hidden",textOverflow:"ellipsis",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{a.texto}</p>
                    <div style={{marginTop:4,fontSize:11,color:T3}}>→ {a.destinatarioLabel||"Todos"}</div>
                  </div>
                </div>
              </Card>
            ))}
          </>
        )}
        {total>0&&<div style={{textAlign:"center",marginTop:12,fontSize:12,color:T3}}>{total} resultado{total!==1?"s":""}</div>}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   SCREEN: AUSENCIAS
════════════════════════════════════════ */
function ScreenAusencias({user,ausencias,onBack,cargarAusencias}){
  const [vistaActual,setVistaActual]=useState("semanal"); // "semanal" | "mensual"
  const [formOpen,setFormOpen]=useState(false);
  const [filtroDept,setFiltroDept]=useState(null);
  const [detalleAusencia,setDetalleAusencia]=useState(null);
  const [ausenciaEditar,setAusenciaEditar]=useState(null);
  const isMobile=useIsMobile();

  // Filtrar ausencias según departamento seleccionado
  const ausenciasFiltradas=useMemo(()=>{
    if(!filtroDept) return ausencias;
    return ausencias.filter(a=>a.departamento===filtroDept);
  },[ausencias,filtroDept]);

  // Calcular métricas
  const metricas=useMemo(()=>{
    const today=fmtISODateLocal(new Date());
    const hoy=ausenciasFiltradas.filter(a=>a.fecha_efectiva===today);
    const porTipo={
      vacaciones:hoy.filter(a=>a.tipo==="vacaciones").length,
      permiso:hoy.filter(a=>a.tipo==="permiso").length,
      dia_asignado:hoy.filter(a=>a.tipo==="dia_asignado").length,
      esquema_reducido:hoy.filter(a=>a.tipo==="esquema_reducido").length,
    };
    return{total:hoy.length,...porTipo};
  },[ausenciasFiltradas]);

  const puedeRegistrar=puedeRegistrarAusencias(user);

  return(
    <div style={{minHeight:"100vh",background:BG}}>
      <NavBar left={<><BackBtn onClick={onBack}/><div style={{fontWeight:700,fontSize:15,color:T1}}>Ausencias</div></>}
        center={null}
        right={<div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={()=>setVistaActual("semanal")}
            style={{background:vistaActual==="semanal"?PR:CARD,color:vistaActual==="semanal"?"#fff":T2,border:`1px solid ${vistaActual==="semanal"?PR:BD}`,padding:"6px 12px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,transition:"all .15s"}}>
            Semanal
          </button>
          <button onClick={()=>setVistaActual("mensual")}
            style={{background:vistaActual==="mensual"?PR:CARD,color:vistaActual==="mensual"?"#fff":T2,border:`1px solid ${vistaActual==="mensual"?PR:BD}`,padding:"6px 12px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,transition:"all .15s"}}>
            Mensual
          </button>
          {puedeRegistrar&&<button onClick={()=>setFormOpen(true)}
            style={{background:PR,color:"#fff",border:"none",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,...fnt}}>
            + Nueva ausencia
          </button>}
        </div>}
      />

      <div style={{maxWidth:1200,margin:"0 auto",padding:"24px"}}>
        {/* Métricas */}
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(5,minmax(0,1fr))",gap:12,marginBottom:24}}>
          {[
            {key:"total",c:PR,bg:PRl,icon:"👥",label:"Ausentes hoy"},
            {key:"vacaciones",c:TIPO_AUSENCIA_CONFIG.vacaciones.text,bg:TIPO_AUSENCIA_CONFIG.vacaciones.bg,icon:"🏖️",label:"Vacaciones"},
            {key:"permiso",c:TIPO_AUSENCIA_CONFIG.permiso.text,bg:TIPO_AUSENCIA_CONFIG.permiso.bg,icon:"🕐",label:"Permisos"},
            {key:"dia_asignado",c:TIPO_AUSENCIA_CONFIG.dia_asignado.text,bg:TIPO_AUSENCIA_CONFIG.dia_asignado.bg,icon:"📅",label:"Día asignado"},
            {key:"esquema_reducido",c:TIPO_AUSENCIA_CONFIG.esquema_reducido.text,bg:TIPO_AUSENCIA_CONFIG.esquema_reducido.bg,icon:"⏱️",label:"Esq. reducido"},
          ].map(m=>(
            <Card key={m.key} sx={{padding:"14px 16px",borderTop:`3px solid ${m.c}`}}>
              <div style={{fontSize:11,color:T3,marginBottom:4}}>{m.label}</div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{fontSize:20}}>{m.icon}</div>
                <div style={{fontSize:28,fontWeight:700,color:m.c,lineHeight:1}}>{metricas[m.key]}</div>
              </div>
            </Card>
          ))}
        </div>

        {/* Filtros por departamento */}
        <Card sx={{padding:16,marginBottom:20}}>
          <div style={{fontSize:11,fontWeight:600,color:T3,marginBottom:10,letterSpacing:.5}}>FILTRAR POR DEPARTAMENTO</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            <button onClick={()=>setFiltroDept(null)}
              style={{background:!filtroDept?PR:CARD,color:!filtroDept?"#fff":T2,border:`1px solid ${!filtroDept?PR:BD}`,padding:"4px 10px",borderRadius:20,cursor:"pointer",fontSize:11,fontWeight:500,transition:"all .12s"}}>
              Todos
            </button>
            {DEPTS.map(dept=>(
              <button key={dept} onClick={()=>setFiltroDept(dept)}
                style={{background:filtroDept===dept?dc(dept):CARD,color:filtroDept===dept?"#fff":T2,border:`1px solid ${filtroDept===dept?dc(dept):BD}`,padding:"4px 10px",borderRadius:20,cursor:"pointer",fontSize:11,fontWeight:500,transition:"all .12s",display:"flex",alignItems:"center",gap:6}}>
                <div style={{width:7,height:7,borderRadius:"50%",background:dc(dept)}}/>
                {dept}
              </button>
            ))}
          </div>
        </Card>

        {/* Calendario */}
        {vistaActual==="semanal"&&<CalendarioSemanal ausencias={ausenciasFiltradas} user={user} onOpenDetalle={setDetalleAusencia}/>}
        {vistaActual==="mensual"&&<CalendarioMensual ausencias={ausenciasFiltradas} user={user} onOpenDetalle={setDetalleAusencia}/>}
      </div>

      {/* Formulario modal */}
      {formOpen&&<FormularioAusencia user={user} onClose={()=>{setFormOpen(false);setAusenciaEditar(null);}} ausenciaEditar={ausenciaEditar} onSave={()=>{
        // El realtime recargará automáticamente, solo cerramos
        setFormOpen(false);
        setAusenciaEditar(null);
      }}/>}
      {/* Modal de detalle */}
      {detalleAusencia&&<ModalDetalleAusencia
        ausencia={detalleAusencia}
        onClose={()=>setDetalleAusencia(null)}
        user={user}
        onEditar={()=>{setAusenciaEditar(detalleAusencia);setDetalleAusencia(null);setFormOpen(true);}}
        onEliminar={async()=>{
          const{error}=await supabase.from("ausencias").delete().eq("id",detalleAusencia.id);
          if(error){console.error("[Supabase] Error DELETE ausencia:",error);alert("Error al eliminar: "+error.message);return;}
          console.log("[Supabase] DELETE ausencia ok:",detalleAusencia.id);
          setDetalleAusencia(null);
          await cargarAusencias();
        }}
      />}
    </div>
  );
}

// Componente: CalendarioSemanal
function CalendarioSemanal({ausencias,user,onOpenDetalle}){
  const [fecha,setFecha]=useState(new Date());
  const isMobile=useIsMobile();

  // Calcular lunes de la semana actual
  const getLunesDeSemanaDe=(d)=>{
    const copia=new Date(d);
    const dayOfWeek=copia.getDay();
    const diff=dayOfWeek===0?-6:1-dayOfWeek; // Si es domingo, retroceder 6 días
    copia.setDate(copia.getDate()+diff);
    return copia;
  };

  const lunes=useMemo(()=>getLunesDeSemanaDe(fecha),[fecha]);
  const diasSemana=useMemo(()=>{
    const arr=[];
    for(let i=0;i<5;i++){
      const d=new Date(lunes);
      d.setDate(lunes.getDate()+i);
      arr.push(d);
    }
    return arr;
  },[lunes]);

  // Filtrar ausencias de la semana actual
  const ausenciasSemana=useMemo(()=>{
    const desde=fmtISODateLocal(diasSemana[0]);
    const hasta=fmtISODateLocal(diasSemana[4]);
    return ausencias.filter(a=>a.fecha_efectiva>=desde&&a.fecha_efectiva<=hasta);
  },[ausencias,diasSemana]);

  // Agrupar por empleado
  const empleados=useMemo(()=>{
    const map=new Map();
    ausenciasSemana.forEach(a=>{
      const key=`${a.empleado_nombre}|${a.departamento}`;
      if(!map.has(key)){
        map.set(key,{nombre:a.empleado_nombre,iniciales:a.empleado_iniciales,departamento:a.departamento,ausencias:[]});
      }
      map.get(key).ausencias.push(a);
    });
    return Array.from(map.values()).sort((a,b)=>a.nombre.localeCompare(b.nombre));
  },[ausenciasSemana]);

  const prevSemana=()=>{const d=new Date(fecha);d.setDate(d.getDate()-7);setFecha(d);};
  const nextSemana=()=>{const d=new Date(fecha);d.setDate(d.getDate()+7);setFecha(d);};
  const irHoy=()=>setFecha(new Date());

  const hoy=fmtISODateLocal(new Date());
  const esRH=esRHAusencias(user);

  return(
    <Card sx={{padding:20}}>
      {/* Navegación */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{fontSize:14,fontWeight:600,color:T1}}>
          Semana del {diasSemana[0].getDate()} al {diasSemana[4].getDate()} de {MONTHS_ES[diasSemana[0].getMonth()]} {diasSemana[0].getFullYear()}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={prevSemana} className="nb" style={{padding:"6px 10px"}}>←</button>
          <button onClick={irHoy} className="nb" style={{padding:"6px 12px",fontSize:11}}>Hoy</button>
          <button onClick={nextSemana} className="nb" style={{padding:"6px 10px"}}>→</button>
        </div>
      </div>

      {empleados.length===0?(
        <div style={{padding:40,textAlign:"center",color:T3,fontSize:13}}>No hay ausencias registradas para esta semana</div>
      ):(
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"separate",borderSpacing:"0 8px"}}>
            <thead>
              <tr>
                <th style={{textAlign:"left",padding:"8px 12px",fontSize:11,fontWeight:600,color:T3,position:"sticky",left:0,background:CARD,zIndex:2}}>EMPLEADO</th>
                {diasSemana.map((d,i)=>{
                  const esHoy=fmtISODateLocal(d)===hoy;
                  return(
                    <th key={i} style={{textAlign:"center",padding:"8px 12px",fontSize:11,fontWeight:600,color:esHoy?PR:T3,background:esHoy?PRl+"80":undefined,borderRadius:esHoy?"8px 8px 0 0":undefined}}>
                      {DAYS_WORK[i]}<br/>{d.getDate()}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {empleados.map((emp,idx)=>(
                <tr key={idx} style={{background:idx%2===0?BG:CARD}}>
                  <td style={{padding:"12px",borderRadius:"8px 0 0 8px",position:"sticky",left:0,background:idx%2===0?BG:CARD,zIndex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:32,height:32,borderRadius:"50%",background:dc(emp.departamento),color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,flexShrink:0}}>
                        {emp.iniciales}
                      </div>
                      <div>
                        <div style={{fontSize:12,fontWeight:600,color:T1,whiteSpace:"nowrap"}}>{emp.nombre}</div>
                        <div style={{fontSize:10,color:T3}}>{emp.departamento}</div>
                      </div>
                    </div>
                  </td>
                  {diasSemana.map((d,i)=>{
                    const fechaStr=fmtISODateLocal(d);
                    const ausDelDia=emp.ausencias.filter(a=>a.fecha_efectiva===fechaStr);
                    const esHoy=fechaStr===hoy;
                    return(
                      <td key={i} style={{textAlign:"center",padding:"8px",background:esHoy?PRl+"40":undefined,borderRadius:i===4?"0 8px 8px 0":undefined}}>
                        {ausDelDia.length>0&&(
                          <div style={{display:"flex",flexDirection:"column",gap:4}}>
                            {ausDelDia.map((a,j)=>{
                              const cfg=TIPO_AUSENCIA_CONFIG[a.tipo];
                              return(
                                <div key={j} onClick={()=>onOpenDetalle&&onOpenDetalle(a)}
                                  style={{background:cfg.bg,color:cfg.text,padding:"4px 8px",borderRadius:6,fontSize:10,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}
                                  className="hl">
                                  {TIPO_AUSENCIA_ABBR[a.tipo]}
                                  {a.tipo==="permiso"&&a.hora_permiso&&<span style={{fontSize:9,marginLeft:2}}>({a.hora_permiso.slice(0,5)})</span>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </Card>
  );
}

// Componente: CalendarioMensual
function CalendarioMensual({ausencias,user,onOpenDetalle}){
  const now=new Date();
  const [month,setMonth]=useState(now.getMonth());
  const [year,setYear]=useState(now.getFullYear());
  const [verMasDia,setVerMasDia]=useState(null);
  const isMobile=useIsMobile();

  const prevMonth=()=>{if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1);};
  const nextMonth=()=>{if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1);};

  // Agrupar ausencias por fecha
  const ausenciasPorFecha=useMemo(()=>{
    const map=new Map();
    ausencias.forEach(a=>{
      const d=new Date(a.fecha_efectiva+"T12:00:00");
      if(d.getMonth()===month&&d.getFullYear()===year){
        const key=a.fecha_efectiva;
        if(!map.has(key))map.set(key,[]);
        map.get(key).push(a);
      }
    });
    return map;
  },[ausencias,month,year]);

  const firstDayOfMonth=new Date(year,month,1).getDay();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const todayDay=now.getDate(),todayMonth=now.getMonth(),todayYear=now.getFullYear();
  const isToday=(d)=>d===todayDay&&month===todayMonth&&year===todayYear;

  // Build grid
  const cells=[];
  for(let i=0;i<firstDayOfMonth;i++)cells.push(null);
  for(let d=1;d<=daysInMonth;d++)cells.push(d);
  while(cells.length%7!==0)cells.push(null);

  const esRH=esRHAusencias(user);

  return(
    <Card sx={{padding:20}}>
      {/* Navegación */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{fontSize:14,fontWeight:600,color:T1}}>
          {MONTHS_ES[month]} {year}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={prevMonth} className="nb" style={{padding:"6px 10px"}}>←</button>
          <button onClick={()=>{setMonth(now.getMonth());setYear(now.getFullYear());}} className="nb" style={{padding:"6px 12px",fontSize:11}}>Hoy</button>
          <button onClick={nextMonth} className="nb" style={{padding:"6px 10px"}}>→</button>
        </div>
      </div>

      {/* Day labels */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:8,marginBottom:8}}>
        {DAYS_ES.map(d=><div key={d} style={{textAlign:"center",fontSize:11,fontWeight:600,color:T3,padding:"4px 0"}}>{d}</div>)}
      </div>

      {/* Calendar grid */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:8}}>
        {cells.map((day,i)=>{
          if(!day)return<div key={i}/>;
          const fechaStr=`${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
          const ausDelDia=ausenciasPorFecha.get(fechaStr)||[];
          const today=isToday(day);
          return(
            <div key={i}
              style={{borderRadius:8,padding:8,minHeight:100,background:today?PRl+"30":"transparent",border:today?`2px solid ${PR}`:`1px solid ${BD}`,position:"relative"}}>
              <div style={{fontSize:12,fontWeight:today?700:500,color:today?PR:T1,marginBottom:6}}>{day}</div>
              {ausDelDia.length>0&&(
                <div style={{display:"flex",flexDirection:"column",gap:3}}>
                  {ausDelDia.slice(0,3).map((a,j)=>{
                    const cfg=TIPO_AUSENCIA_CONFIG[a.tipo];
                    return(
                      <div key={j} onClick={()=>onOpenDetalle&&onOpenDetalle(a)}
                        style={{background:cfg.bg,color:cfg.text,padding:"3px 6px",borderRadius:4,fontSize:9,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}
                        className="hl">
                        {a.empleado_iniciales} · {TIPO_AUSENCIA_ABBR[a.tipo]}
                      </div>
                    );
                  })}
                  {ausDelDia.length>3&&(
                    <div style={{fontSize:9,color:T3,fontWeight:600,padding:"2px 6px",background:BG,borderRadius:4,cursor:"pointer"}}
                      onClick={()=>setVerMasDia({fecha:fechaStr,ausencias:ausDelDia})}>
                      +{ausDelDia.length-3} más
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal "Ver más" del día */}
      {verMasDia&&(
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.7)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:24}} onClick={()=>setVerMasDia(null)}>
          <div style={{background:CARD,borderRadius:16,padding:24,width:"100%",maxWidth:420,maxHeight:"80vh",overflowY:"auto",boxShadow:SHm}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontSize:15,fontWeight:700,color:T1}}>Ausencias del {verMasDia.fecha}</div>
              <button onClick={()=>setVerMasDia(null)} style={{background:"none",border:"none",color:T3,cursor:"pointer",fontSize:22,lineHeight:1,padding:0}}>×</button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {verMasDia.ausencias.map((a,i)=>{
                const cfg=TIPO_AUSENCIA_CONFIG[a.tipo];
                return(
                  <div key={i} onClick={()=>{setVerMasDia(null);onOpenDetalle&&onOpenDetalle(a);}} style={{padding:12,background:BG,borderRadius:8,borderLeft:`3px solid ${cfg.text}`,cursor:"pointer"}} className="hl">
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                      <div style={{width:32,height:32,borderRadius:"50%",background:dc(a.departamento),color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700}}>
                        {a.empleado_iniciales}
                      </div>
                      <div>
                        <div style={{fontSize:13,fontWeight:600,color:T1}}>{a.empleado_nombre}</div>
                        <div style={{fontSize:10,color:T3}}>{a.departamento}</div>
                      </div>
                    </div>
                    <div style={{background:cfg.bg,color:cfg.text,padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:600,display:"inline-block"}}>
                      {cfg.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Card>
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
      <NavBar left={<><BackBtn onClick={onBack}/><div><div style={{fontWeight:700,fontSize:15,color:T1}}>Calendario</div><div style={{fontSize:11,color:T2}}>{MONTHS_ES[month]} {year}</div></div></>}
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
function ScreenStats({tasks,user,onBack}){
  const isMobile=useIsMobile();
  const isDir=user?.dept==="Dirección"||user?.dept==="Ingenieria";

  const statusData=useMemo(()=>Object.entries(SC).map(([s,c])=>({name:s,value:tasks.filter(t=>t.status===s).length,color:c.c})).filter(d=>d.value>0),[tasks]);
  const typeData  =useMemo(()=>Object.entries(TT).map(([t,c])=>({name:t,value:tasks.filter(tk=>tk.type===t).length,color:c.c})).filter(d=>d.value>0),[tasks]);
  const prioData  =useMemo(()=>Object.entries(PC).map(([p,c])=>({name:p,value:tasks.filter(t=>t.priority===p&&isActive(t)).length,color:c.c})),[tasks]);
  const deptData  =useMemo(()=>DEPTS.map(d=>({name:d,value:tasks.filter(t=>isActive(t)&&t.responsible?.dept===d).length,color:DEPT_COLORS[d]||"#6B7280"})),[tasks]);
  const completed =tasks.filter(t=>t.status==="Completada").length;
  const completedPct=tasks.length>0?Math.round(completed/tasks.length*100):0;

  const onTimeData=useMemo(()=>{
    const completadas=tasks.filter(t=>t.status==="Completada"&&t.deadline&&t.createdAt);
    if(!completadas.length) return{pct:0,onTime:0,late:0,total:0};
    const onTime=completadas.filter(t=>{
      const dl=new Date(t.deadline+"T23:59:59");
      const comp=new Date(t.completedAt||t.createdAt);
      return comp<=dl;
    }).length;
    return{pct:Math.round(onTime/completadas.length*100),onTime,late:completadas.length-onTime,total:completadas.length};
  },[tasks]);

  const origenData=useMemo(()=>{
    const map={"Verbal":0,"Junta":0,"WhatsApp-Correo":0,"Sistema":0};
    tasks.forEach(t=>{if(map[t.origin]!==undefined)map[t.origin]++;else map["Sistema"]++;});
    return Object.entries(map).map(([name,value])=>({name,value})).filter(d=>d.value>0);
  },[tasks]);

  const weeklyData=useMemo(()=>{
    const weeks=[];
    for(let i=3;i>=0;i--){
      const end=new Date(); end.setHours(23,59,59,0); end.setDate(end.getDate()-(i*7));
      const start=new Date(end); start.setDate(start.getDate()-6); start.setHours(0,0,0,0);
      const label=`${start.getDate()}/${start.getMonth()+1}`;
      const creadas=tasks.filter(t=>t.createdAt&&new Date(t.createdAt)>=start&&new Date(t.createdAt)<=end).length;
      const cerradas=tasks.filter(t=>t.status==="Completada"&&t.createdAt&&new Date(t.createdAt)>=start&&new Date(t.createdAt)<=end).length;
      weeks.push({label,creadas,cerradas});
    }
    return weeks;
  },[tasks]);

  const reactividad=useMemo(()=>{
    const recientes=tasks.filter(t=>{
      if(!t.createdAt) return false;
      const d=new Date(t.createdAt);
      const hace7=new Date(); hace7.setDate(hace7.getDate()-7);
      return d>=hace7&&isActive(t);
    });
    if(!recientes.length) return{pct:0,altas:0,total:0,label:"Sin datos"};
    const altas=recientes.filter(t=>t.priority==="Alta").length;
    const pct=Math.round(altas/recientes.length*100);
    return{pct,altas,total:recientes.length,label:pct>=60?"🔴 Operación reactiva":pct>=30?"🟡 Riesgo moderado":"🟢 Operación planificada"};
  },[tasks]);

  const resolucionData=useMemo(()=>{
    return DEPTS.map(dept=>{
      const completadas=tasks.filter(t=>t.status==="Completada"&&t.responsible?.dept===dept&&t.createdAt);
      if(!completadas.length) return{name:dept,dias:0,count:0,color:DEPT_COLORS[dept]||"#6B7280"};
      const total=completadas.reduce((acc,t)=>{
        const dias=safeDays(t.createdAt);
        return acc+dias;
      },0);
      return{name:dept,dias:Math.round(total/completadas.length),count:completadas.length,color:DEPT_COLORS[dept]||"#6B7280"};
    }).filter(d=>d.count>0).sort((a,b)=>b.dias-a.dias);
  },[tasks]);

  const vencidasPorPersona=useMemo(()=>{
    const map={};
    tasks.filter(t=>isOver(t.deadline,t.status)&&t.responsible).forEach(t=>{
      const k=t.responsible.id;
      if(!map[k]) map[k]={user:t.responsible,count:0};
      map[k].count++;
    });
    return Object.values(map).sort((a,b)=>b.count-a.count).slice(0,8);
  },[tasks]);

  const bloqueadasData=useMemo(()=>{
    return tasks.filter(t=>t.status==="Bloqueada").map(t=>({
      ...t,
      diasBloqueada:t.blockReason?Math.max(0,Math.round((new Date()-new Date(t.createdAt||Date.now()))/86400000)):0,
    })).sort((a,b)=>b.diasBloqueada-a.diasBloqueada);
  },[tasks]);

  const exportCSV=()=>{
    const esc=v=>`"${String(v||"").replace(/"/g,'""')}"`;
    const diasActiva=t=>{
      if(!t.createdAt) return "";
      return safeDays(t.createdAt);
    };
    const headers=["ID","Título","Tipo","Prioridad","Estado","Responsable","Departamento","Fecha límite","Días activa","Creada"];
    const rows=tasks.map(t=>[t.id,esc(t.title),t.type,t.priority,t.status,t.responsible?.name||"",t.responsible?.dept||"",t.deadline||"",diasActiva(t),t.createdAt||""].join(","));
    const csv="﻿"+[headers.join(","),...rows].join("\r\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));
    const a=document.createElement("a");a.href=url;a.download=`nexus-${new Date().toISOString().slice(0,10)}.csv`;a.click();
    URL.revokeObjectURL(url);
  };

  return(
    <div style={{minHeight:"100vh",background:BG}}>
      <NavBar left={<><BackBtn onClick={onBack}/><div><div style={{fontWeight:700,fontSize:15,color:T1}}>Estadísticas</div><div style={{fontSize:11,color:T2}}>{tasks.length} tareas en total</div></div></>}
        center={null}
        right={<button onClick={exportCSV} style={{background:"#ECFDF5",border:"1px solid #A7F3D0",color:"#059669",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>⬇ Exportar CSV</button>}
      />
      <div style={{maxWidth:1100,margin:"0 auto",padding:"28px 24px"}}>

        <div style={{fontSize:12,fontWeight:600,color:T2,marginBottom:12,letterSpacing:.5}}>RESUMEN GENERAL</div>
        <div style={{display:"grid",gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(4,1fr)",gap:12,marginBottom:28}}>
          {[
            {l:"Total tareas",  v:tasks.length,                  c:PR,        bg:PRl},
            {l:"Activas",       v:tasks.filter(isActive).length,  c:"#D97706", bg:"#FFFBEB"},
            {l:"Completadas",   v:completed,                      c:"#059669", bg:"#ECFDF5"},
            {l:"% Completadas", v:`${completedPct}%`,             c:"#4338CA", bg:"#EEF2FF"},
          ].map(s=>(
            <Card key={s.l} sx={{padding:"16px 18px",borderTop:`2px solid ${s.c}`}}>
              <div style={{fontSize:26,fontWeight:700,color:s.c,lineHeight:1}}>{s.v}</div>
              <div style={{fontSize:11,color:T2,marginTop:4}}>{s.l}</div>
            </Card>
          ))}
        </div>

        <div style={{fontSize:12,fontWeight:600,color:T2,marginBottom:12,letterSpacing:.5}}>CUMPLIMIENTO A TIEMPO</div>
        <Card sx={{padding:20,marginBottom:20}}>
          <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(3,1fr)",gap:16,alignItems:"center"}}>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:48,fontWeight:800,color:onTimeData.pct>=70?"#059669":onTimeData.pct>=40?"#D97706":"#DC2626",lineHeight:1}}>{onTimeData.pct}%</div>
              <div style={{fontSize:12,color:T2,marginTop:4}}>Tareas completadas a tiempo</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#ECFDF5",borderRadius:8,padding:"10px 14px"}}>
                <span style={{fontSize:13,color:"#059669",fontWeight:600}}>✓ A tiempo</span>
                <span style={{fontSize:20,fontWeight:700,color:"#059669"}}>{onTimeData.onTime}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#FEF2F2",borderRadius:8,padding:"10px 14px"}}>
                <span style={{fontSize:13,color:"#DC2626",fontWeight:600}}>✗ Con retraso</span>
                <span style={{fontSize:20,fontWeight:700,color:"#DC2626"}}>{onTimeData.late}</span>
              </div>
            </div>
            <div>
              <div style={{height:8,background:BD,borderRadius:4,overflow:"hidden",marginBottom:6}}>
                <div style={{height:"100%",width:`${onTimeData.pct}%`,background:onTimeData.pct>=70?"#059669":onTimeData.pct>=40?"#D97706":"#DC2626",borderRadius:4,transition:"width .3s"}}/>
              </div>
              <div style={{fontSize:11,color:T3}}>{onTimeData.total} tareas completadas evaluadas</div>
            </div>
          </div>
        </Card>

        <div style={{fontSize:12,fontWeight:600,color:T2,marginBottom:12,letterSpacing:.5}}>CREADAS VS COMPLETADAS — ÚLTIMAS 4 SEMANAS</div>
        <Card sx={{padding:20,marginBottom:20}}>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={weeklyData} margin={{left:0,right:0}}>
              <XAxis dataKey="label" tick={{fontSize:11,fill:T2}} axisLine={false} tickLine={false}/>
              <YAxis allowDecimals={false} tick={{fontSize:11,fill:T2}} axisLine={false} tickLine={false}/>
              <Tooltip/>
              <Bar dataKey="creadas" name="Creadas" fill={PR} radius={[4,4,0,0]}/>
              <Bar dataKey="cerradas" name="Completadas" fill="#059669" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
          <div style={{display:"flex",gap:16,justifyContent:"center",marginTop:8}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:10,height:10,borderRadius:2,background:PR}}/><span style={{fontSize:11,color:T2}}>Creadas</span></div>
            <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:10,height:10,borderRadius:2,background:"#059669"}}/><span style={{fontSize:11,color:T2}}>Completadas</span></div>
          </div>
        </Card>

        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:20,marginBottom:20}}>
          <Card sx={{padding:20}}>
            <Lbl ch="TAREAS POR ESTADO"/>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={statusData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" label={({name,value})=>`${name}:${value}`} labelLine={false} fontSize={10}>
                  {statusData.map((d,i)=><Cell key={i} fill={d.color}/>)}
                </Pie>
                <Tooltip/>
              </PieChart>
            </ResponsiveContainer>
          </Card>
          <Card sx={{padding:20}}>
            <Lbl ch="ORIGEN DE TAREAS"/>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={origenData} layout="vertical" margin={{left:80}}>
                <XAxis type="number" allowDecimals={false} tick={{fontSize:11,fill:T2}} axisLine={false} tickLine={false}/>
                <YAxis type="category" dataKey="name" tick={{fontSize:11,fill:T2}} axisLine={false} tickLine={false}/>
                <Tooltip/>
                <Bar dataKey="value" name="Tareas" fill="#7C3AED" radius={[0,4,4,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:20,marginBottom:20}}>
          <Card sx={{padding:20}}>
            <Lbl ch="TAREAS POR TIPO"/>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={typeData} cx="50%" cy="50%" outerRadius={75} dataKey="value" label={({name,value})=>`${name}:${value}`} fontSize={10}>
                  {typeData.map((d,i)=><Cell key={i} fill={d.color}/>)}
                </Pie>
                <Tooltip/>
              </PieChart>
            </ResponsiveContainer>
          </Card>
          <Card sx={{padding:20}}>
            <Lbl ch="TAREAS ACTIVAS POR PRIORIDAD"/>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={prioData} layout="vertical" margin={{left:50}}>
                <XAxis type="number" hide/>
                <YAxis type="category" dataKey="name" tick={{fontSize:12,fill:T2}} axisLine={false} tickLine={false}/>
                <Tooltip/>
                <Bar dataKey="value" radius={[0,4,4,0]}>{prioData.map((d,i)=><Cell key={i} fill={d.color}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        <Card sx={{padding:20,marginBottom:28}}>
          <Lbl ch="TAREAS ACTIVAS POR DEPARTAMENTO"/>
          <ResponsiveContainer width="100%" height={Math.max(200,deptData.length*32)}>
            <BarChart data={deptData} layout="vertical" margin={{left:120,right:20}}>
              <XAxis type="number" allowDecimals={false} tick={{fontSize:11,fill:T2}} axisLine={false} tickLine={false}/>
              <YAxis type="category" dataKey="name" width={115} tick={{fontSize:11,fill:T2}} axisLine={false} tickLine={false}/>
              <Tooltip formatter={(v)=>[v,"Tareas"]}/>
              <Bar dataKey="value" radius={[0,4,4,0]} minPointSize={2}>
                {deptData.map((d,i)=><Cell key={i} fill={d.color}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {isDir&&(<>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,paddingTop:8,borderTop:`2px solid ${PR}`}}>
            <span style={{fontSize:14}}>🔒</span>
            <div style={{fontSize:12,fontWeight:700,color:PR,letterSpacing:.5}}>MÉTRICAS GERENCIALES — DIRECCIÓN / INGENIERÍA</div>
          </div>

          <div style={{fontSize:12,fontWeight:600,color:T2,marginBottom:12,letterSpacing:.5}}>ÍNDICE DE REACTIVIDAD — ÚLTIMOS 7 DÍAS</div>
          <Card sx={{padding:20,marginBottom:20,borderLeft:`4px solid ${reactividad.pct>=60?"#DC2626":reactividad.pct>=30?"#D97706":"#059669"}`}}>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"auto 1fr",gap:20,alignItems:"center"}}>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:52,fontWeight:800,color:reactividad.pct>=60?"#DC2626":reactividad.pct>=30?"#D97706":"#059669",lineHeight:1}}>{reactividad.pct}%</div>
                <div style={{fontSize:11,color:T2,marginTop:4}}>tareas Alta prioridad</div>
              </div>
              <div>
                <div style={{fontSize:15,fontWeight:700,color:T1,marginBottom:8}}>{reactividad.label}</div>
                <div style={{fontSize:13,color:T2,lineHeight:1.6}}>
                  De las <strong>{reactividad.total}</strong> tareas creadas en los últimos 7 días, <strong>{reactividad.altas}</strong> fueron de prioridad Alta.<br/>
                  {reactividad.pct>=60?"Un índice alto indica que el equipo está operando de manera reactiva — apagando fuegos en vez de planificar.":
                   reactividad.pct>=30?"Nivel de alerta moderado. Monitorear si la tendencia sube.":
                   "Buen balance. La mayoría de tareas son planificadas."}
                </div>
              </div>
            </div>
          </Card>

          {resolucionData.length>0&&(<>
            <div style={{fontSize:12,fontWeight:600,color:T2,marginBottom:12,letterSpacing:.5}}>TIEMPO PROMEDIO DE RESOLUCIÓN POR DEPARTAMENTO</div>
            <Card sx={{padding:20,marginBottom:20}}>
              <ResponsiveContainer width="100%" height={Math.max(160,resolucionData.length*36)}>
                <BarChart data={resolucionData} layout="vertical" margin={{left:120,right:40}}>
                  <XAxis type="number" allowDecimals={false} tick={{fontSize:11,fill:T2}} axisLine={false} tickLine={false} unit=" días"/>
                  <YAxis type="category" dataKey="name" width={115} tick={{fontSize:11,fill:T2}} axisLine={false} tickLine={false}/>
                  <Tooltip formatter={(v)=>[`${v} días promedio`,"Resolución"]}/>
                  <Bar dataKey="dias" radius={[0,4,4,0]}>
                    {resolucionData.map((d,i)=><Cell key={i} fill={d.color}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div style={{fontSize:11,color:T3,marginTop:8}}>Basado en tareas completadas. Días desde creación hasta hoy.</div>
            </Card>
          </>)}

          {vencidasPorPersona.length>0&&(<>
            <div style={{fontSize:12,fontWeight:600,color:T2,marginBottom:12,letterSpacing:.5}}>TAREAS VENCIDAS POR RESPONSABLE</div>
            <Card sx={{padding:20,marginBottom:20}}>
              {vencidasPorPersona.map((item,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:12,marginBottom:i<vencidasPorPersona.length-1?12:0}}>
                  <Av u={item.user} size={32}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                      <span style={{fontSize:13,fontWeight:600,color:T1}}>{item.user.name}</span>
                      <span style={{fontSize:13,fontWeight:700,color:"#DC2626"}}>{item.count} vencida{item.count!==1?"s":""}</span>
                    </div>
                    <div style={{height:6,background:BD,borderRadius:4,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${Math.min(100,(item.count/Math.max(...vencidasPorPersona.map(x=>x.count)))*100)}%`,background:"#DC2626",borderRadius:4}}/>
                    </div>
                  </div>
                </div>
              ))}
            </Card>
          </>)}

          {bloqueadasData.length>0&&(<>
            <div style={{fontSize:12,fontWeight:600,color:T2,marginBottom:12,letterSpacing:.5}}>TAREAS BLOQUEADAS</div>
            <Card sx={{padding:20,marginBottom:20}}>
              {bloqueadasData.map((t,i)=>(
                <div key={i} style={{display:"flex",gap:12,alignItems:"flex-start",padding:"12px 0",borderBottom:i<bloqueadasData.length-1?`1px solid ${BD}`:"none"}}>
                  <div style={{width:36,height:36,borderRadius:8,background:"#FEF2F2",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:16}}>🔒</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:T1,marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                      <span style={{fontSize:11,color:T2}}>{t.responsible?.name||"—"}</span>
                      <span style={{fontSize:11,color:"#DC2626",fontWeight:600}}>{t.diasBloqueada}d bloqueada</span>
                      {t.blockReason&&<span style={{fontSize:11,color:T3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:200}}>{t.blockReason}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </Card>
          </>)}
        </>)}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   SCREEN: DEPT DETAIL
════════════════════════════════════════ */
function ScreenDeptDetail({dept,tasks,user,onBack,onTaskClick,onNewTask,canAdd,onRequestAccess}){
  const [filter,setFilter]=useState("all");
  const deptTasks=useMemo(()=>{
    const mine=tasks.filter(t=>t.responsible?.dept===dept||(t.invIds||[]).some(id=>USERS.find(x=>x.id===id)?.dept===dept));
    const active=mine.filter(isActive);
    const filtered=filter==="all"?active:active.filter(t=>t.status===filter||t.priority===filter);
    return [...filtered].sort((a,b)=>({Alta:0,Media:1,Baja:2}[a.priority]||1)-({Alta:0,Media:1,Baja:2}[b.priority]||1));
  },[tasks,dept,filter]);
  const delayedTasks=useMemo(()=>{
    const mine=tasks.filter(t=>t.responsible?.dept===dept||(t.invIds||[]).some(id=>USERS.find(x=>x.id===id)?.dept===dept));
    return mine.filter(t=>isOver(t.deadline,t.status)||t.status==="Bloqueada");
  },[tasks,dept]);
  const FILTERS=[["all","Todas"],["Alta","Alta prio."],["Bloqueada","Bloqueadas"],["En proceso","En proceso"],["Pendiente","Pendientes"]];
  return(
    <div style={{minHeight:"100vh",background:BG}}>
      <NavBar left={<><BackBtn onClick={onBack}/><div>
          <div style={{fontWeight:700,fontSize:15,color:T1,display:"flex",alignItems:"center",gap:8}}><div style={{width:9,height:9,borderRadius:"50%",background:dc(dept)}}/>{dept}</div>
          <div style={{fontSize:11,color:T2}}>{deptTasks.length} tarea{deptTasks.length!==1?"s":""} activa{deptTasks.length!==1?"s":""}</div>
        </div></>}
        center={null}
        right={<>
          {!canAdd&&onRequestAccess&&(
            <button onClick={onRequestAccess} style={{background:"none",border:`1px solid ${BD}`,borderRadius:8,padding:"7px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,fontSize:12,color:T2,fontWeight:500}}>
              🔒 <span>Acceso restringido</span>
            </button>
          )}
          {canAdd&&<button onClick={onNewTask} style={{background:PR,color:"#fff",border:"none",padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>+ Nueva tarea</button>}
        </>}
      />
      <div style={{maxWidth:900,margin:"0 auto",padding:"24px"}}>
        {/* Análisis de retrasos */}
        {delayedTasks.length>0&&(
          <Card sx={{padding:16,marginBottom:20,borderLeft:`3px solid #DC2626`,background:"#FFFBFB"}}>
            <Lbl ch={`⚠ ANÁLISIS DE RETRASOS — ${delayedTasks.length} tarea${delayedTasks.length!==1?"s":""}`}/>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {delayedTasks.map(t=>{
                const blocked=t.status==="Bloqueada";
                const daysLate=blocked?null:Math.max(0,Math.round((new Date()-new Date(t.deadline+"T12:00:00"))/86400000));
                return(
                  <div key={t.id} onClick={()=>onTaskClick(t)}
                    style={{display:"flex",alignItems:"center",gap:10,background:CARD,borderRadius:8,padding:"10px 12px",cursor:"pointer",border:`1px solid ${blocked?"#FECACA":"#FEE2E2"}`,transition:"box-shadow .12s"}}
                    onMouseEnter={e=>e.currentTarget.style.boxShadow=SH}
                    onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}>
                    <span style={{fontSize:15,flexShrink:0}}>{blocked?"🔒":"⚠️"}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:T1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div>
                      <div style={{fontSize:11,color:"#DC2626",marginTop:2}}>
                        {blocked
                          ? `Bloqueada${t.blockReason?` — ${t.blockReason.slice(0,60)}${t.blockReason.length>60?"…":""}`:""}`
                          : `Vencida hace ${daysLate} día${daysLate!==1?"s":""}`}
                      </div>
                    </div>
                    {t.responsible&&(
                      <div style={{display:"flex",alignItems:"center",gap:5,flexShrink:0}}>
                        <Av u={t.responsible} size={22}/>
                        <span style={{fontSize:10,color:T2,maxWidth:80,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.responsible.name}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
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
   SCREEN: TAREAS RÁPIDAS
════════════════════════════════════════ */
function ScreenQuickTasks({user,quickTasks,onBack,onCreateTask,onUpdateTask,onDeleteTask,onRestoreTask}){
  const scrollRef=useScrollRestore("quickTasks");
  const [filter,setFilter]=useState("active"); // "active" | "all" | "pending" | "in_progress" | "completed" | "deleted"
  const [selectedTask,setSelectedTask]=useState(null);
  const [showCreateForm,setShowCreateForm]=useState(false);
  const [editingTask,setEditingTask]=useState(null);
  const [commentText,setCommentText]=useState("");
  const [showDeleteConfirm,setShowDeleteConfirm]=useState(false);
  const [deleteReason,setDeleteReason]=useState("");
  const isMobile=useIsMobile();

  const isDireccion=user?.dept==="Dirección";

  // Filtrar tareas según el filtro activo
  const filteredTasks=useMemo(()=>{
    let base=quickTasks;
    if(!isDireccion){
      base=base.filter(t=>t.dept===user?.dept);
    }
    if(filter==="deleted") return base.filter(t=>t.deleted);
    if(filter==="active") return base.filter(t=>!t.deleted&&t.status!=="Completada");
    if(filter==="pending") return base.filter(t=>!t.deleted&&t.status==="Pendiente");
    if(filter==="in_progress") return base.filter(t=>!t.deleted&&t.status==="En proceso");
    if(filter==="completed") return base.filter(t=>!t.deleted&&t.status==="Completada");
    return base.filter(t=>!t.deleted); // "all"
  },[quickTasks,filter,isDireccion,user?.dept]);

  // Agrupar por departamento (solo para Dirección)
  const groupedByDept=useMemo(()=>{
    if(!isDireccion) return null;
    const groups={};
    filteredTasks.forEach(t=>{
      if(!groups[t.dept]) groups[t.dept]=[];
      groups[t.dept].push(t);
    });
    // Ordenar cada grupo por prioridad
    Object.keys(groups).forEach(dept=>{
      groups[dept].sort((a,b)=>a.priority-b.priority);
    });
    return groups;
  },[isDireccion,filteredTasks]);

  // Resync: si la tarea abierta cambia en el array quickTasks, actualizar
  useEffect(()=>{
    if(!selectedTask) return;
    const fresh=quickTasks.find(t=>t.id===selectedTask.id);
    if(fresh&&fresh!==selectedTask) setSelectedTask(fresh);
  },[quickTasks,selectedTask]);

  const handleChangePriority=(task,direction)=>{
    if(!isDireccion&&task.createdBy?.id!==user?.id) return;

    // 1. Obtener todas las tareas del departamento ordenadas por prioridad
    const tasksInDept=quickTasks.filter(t=>t.dept===task.dept&&!t.deleted).sort((a,b)=>a.priority-b.priority);
    const idx=tasksInDept.findIndex(t=>t.id===task.id);
    if(idx===-1) return;
    if(direction==="up"&&idx===0) return;
    if(direction==="down"&&idx===tasksInDept.length-1) return;

    // 2. Reordenar el array: mover la tarea en la dirección indicada
    const reordered=[...tasksInDept];
    const swapIdx=direction==="up"?idx-1:idx+1;
    [reordered[idx],reordered[swapIdx]]=[reordered[swapIdx],reordered[idx]];

    // 3. Reasignar prioridades secuenciales (1, 2, 3, 4...)
    reordered.forEach((t,i)=>{
      const newPriority=i+1;
      if(t.priority!==newPriority){
        onUpdateTask(t.id,{priority:newPriority});
      }
    });
  };

  const handleSendComment=()=>{
    if(!commentText.trim()) return;
    console.log("[QuickTask Comment] iniciando", { taskId: selectedTask.id, commentText });
    const now=new Date();
    const c={
      user:{id:user.id,name:user.name},
      text:commentText,
      time:now.toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})+" "+now.toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"}),
      iso:now.toISOString()
    };
    onUpdateTask(selectedTask.id,{comments:[...(selectedTask.comments||[]),c]});

    // Notificar a: creador + Dirección + todos del depto + comentaristas previos (deduplicados, excepto autor)
    const commentUserIds=(selectedTask.comments||[]).map(cm=>cm.user?.id).filter(Boolean);
    const deptUsers=USERS.filter(u=>u.dept===selectedTask.dept).map(u=>u.id);
    const direccionUsers=USERS.filter(u=>u.dept==="Dirección").map(u=>u.id);
    const recipientIds=[...new Set([
      selectedTask.createdBy?.id,
      ...deptUsers,
      ...direccionUsers,
      ...commentUserIds
    ].filter(Boolean))].filter(id=>id!==user.id);
    const recipientEmails=recipientIds.map(id=>USERS.find(x=>x.id===id)?.email).filter(Boolean);

    console.log("[QuickTask Comment] destinatarios calculados", {
      recipientIds,
      recipientEmails,
      count: recipientIds.length
    });

    const commentPreview=`${commentText.trim().slice(0,80)}${commentText.trim().length>80?"…":""}`;
    if(recipientIds.length>0){
      (async()=>{
        try{
          await sendPushNotification(recipientIds,`💬 Comentario en tarea rápida: ${selectedTask.title}`,`${user.name}: ${commentPreview}`,`/?quickTask=${selectedTask.id}`);
          console.log("[QuickTask Comment] push OK a",recipientIds);
        }catch(e){
          console.error("[QuickTask Comment] push FAIL",recipientIds,e);
        }
      })();
      recipientIds.forEach(id=>{
        const u=USERS.find(x=>x.id===id);
        if(!u?.email) return;
        setTimeout(async()=>{
          try{
            await sendEmailNotification("quick_task_comment",[u.email],{
              userName:u.name,
              taskId:selectedTask.id,
              taskTitle:selectedTask.title,
              commenterName:user.name,
              commentText:commentPreview,
              dept:selectedTask.dept,
            });
            console.log("[QuickTask Comment] email OK a",u.email);
          }catch(e){
            console.error("[QuickTask Comment] email FAIL",u.email,e);
          }
        },0);
      });
    }

    setCommentText("");
  };

  const handleDelete=()=>{
    if(!deleteReason.trim()){
      alert("El motivo es obligatorio");
      return;
    }
    const now=new Date();
    onDeleteTask(selectedTask.id,{
      deleted:true,
      deletedAt:now.toISOString(),
      deletedBy:{id:user.id,name:user.name},
      deleteReason:deleteReason.trim()
    });
    setShowDeleteConfirm(false);
    setDeleteReason("");
    setSelectedTask(null);
  };

  const handleRestore=(task)=>{
    onRestoreTask(task.id,{deleted:false,deletedAt:null,deletedBy:null,deleteReason:null});
  };

  const canEdit=(task)=>isDireccion||task.createdBy?.id===user?.id;
  const canDelete=(task)=>isDireccion||task.createdBy?.id===user?.id;

  const priorityColor=(p)=>({1:"#DC2626",2:"#D97706",3:"#059669"}[p]||"#64748B");
  const priorityLabel=(p)=>({1:"Alta",2:"Media",3:"Baja"}[p]||"—");

  const statusColor=(s)=>({
    "Pendiente":"#94A3B8",
    "En proceso":"#3B82F6",
    "Completada":"#059669"
  }[s]||"#94A3B8");

  if(selectedTask){
    return(
      <div style={{minHeight:"100vh",background:BG}}>
        <NavBar left={<button onClick={()=>setSelectedTask(null)} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:T1}}>←</button>}
          center={<span style={{fontSize:14,fontWeight:600,color:T1}}>Detalle de tarea rápida</span>}
          right={null}
        />
        <div style={{maxWidth:800,margin:"0 auto",padding:"20px 24px"}}>
          <Card sx={{padding:20}}>
            {/* Título y estado */}
            <div style={{marginBottom:20}}>
              <div style={{fontSize:18,fontWeight:700,color:T1,marginBottom:8}}>{selectedTask.title}</div>
              <div style={{fontSize:13,color:T2,marginBottom:12}}>{selectedTask.description||"Sin descripción"}</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                <Badge ch={priorityLabel(selectedTask.priority)} c={priorityColor(selectedTask.priority)} bg={priorityColor(selectedTask.priority)+"15"}/>
                <Badge ch={selectedTask.dept} c={dc(selectedTask.dept)} bg={dc(selectedTask.dept)+"15"}/>
                {selectedTask.deadline&&<Badge ch={`📅 ${new Date(selectedTask.deadline).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})}`} c={T2} bg={BG}/>}
              </div>
              <div style={{marginTop:8,fontSize:11,color:T3}}>
                {selectedTask.assignedToId?(
                  <>Asignada a: <strong>{USERS.find(u=>u.id===selectedTask.assignedToId)?.name||"—"}</strong> • </>
                ):null}
                Creada por: {selectedTask.createdBy?.name||"—"}
              </div>
            </div>

            {/* Botones de estado */}
            {!selectedTask.deleted&&(
              <div style={{marginBottom:20}}>
                <div style={{fontSize:12,fontWeight:600,color:T2,marginBottom:8}}>Estado</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {["Pendiente","En proceso","Completada"].map(st=>(
                    <button key={st} onClick={()=>onUpdateTask(selectedTask.id,{status:st,completedAt:st==="Completada"?new Date().toISOString():null})}
                      style={{background:selectedTask.status===st?statusColor(st):CARD,color:selectedTask.status===st?"#fff":T2,border:`1px solid ${selectedTask.status===st?statusColor(st):BD}`,padding:"8px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:500,transition:"all .12s"}}>
                      {st}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Comentarios */}
            {!selectedTask.deleted&&(
              <div style={{marginBottom:20}}>
                <div style={{fontSize:12,fontWeight:600,color:T2,marginBottom:8}}>Comentarios ({(selectedTask.comments||[]).length})</div>
                <div style={{maxHeight:300,overflowY:"auto",marginBottom:12}}>
                  {(selectedTask.comments||[]).map((c,i)=>(
                    <div key={i} style={{background:BG,borderRadius:8,padding:10,marginBottom:8}}>
                      <div style={{fontSize:11,fontWeight:600,color:T1,marginBottom:2}}>{c.user?.name||"—"}</div>
                      <div style={{fontSize:12,color:T2,marginBottom:4}}>{c.text}</div>
                      <div style={{fontSize:10,color:T3}}>{c.time}</div>
                    </div>
                  ))}
                  {(selectedTask.comments||[]).length===0&&<div style={{fontSize:12,color:T3,fontStyle:"italic"}}>Sin comentarios</div>}
                </div>
                <div style={{display:"flex",gap:8}}>
                  <input type="text" value={commentText} onChange={e=>setCommentText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSendComment()}
                    placeholder="Escribe un comentario..."
                    style={{flex:1,padding:"10px 12px",borderRadius:8,border:`1px solid ${BD}`,fontSize:13,background:CARD,color:T1}}/>
                  <button onClick={handleSendComment} disabled={!commentText.trim()}
                    style={{background:commentText.trim()?PR:"#94A3B8",color:"#fff",border:"none",padding:"10px 16px",borderRadius:8,cursor:commentText.trim()?"pointer":"not-allowed",fontSize:13,fontWeight:600}}>
                    Enviar
                  </button>
                </div>
              </div>
            )}

            {/* Botones de acción */}
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {!selectedTask.deleted&&canEdit(selectedTask)&&(
                <button onClick={()=>{setEditingTask(selectedTask);setSelectedTask(null);}}
                  style={{background:CARD,color:T1,border:`1px solid ${BD}`,padding:"10px 16px",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:600}}>
                  ✏️ Editar
                </button>
              )}
              {!selectedTask.deleted&&canDelete(selectedTask)&&(
                <button onClick={()=>setShowDeleteConfirm(true)}
                  style={{background:"#FEF2F2",color:"#DC2626",border:"1px solid #FCA5A5",padding:"10px 16px",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:600}}>
                  🗑️ Eliminar
                </button>
              )}
              {selectedTask.deleted&&canEdit(selectedTask)&&(
                <button onClick={()=>handleRestore(selectedTask)}
                  style={{background:"#ECFDF5",color:"#059669",border:"1px solid #A7F3D0",padding:"10px 16px",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:600}}>
                  ♻️ Restaurar
                </button>
              )}
            </div>

            {/* Información de eliminación */}
            {selectedTask.deleted&&(
              <div style={{marginTop:20,padding:12,background:"#FEF2F2",border:"1px solid #FCA5A5",borderRadius:8}}>
                <div style={{fontSize:12,fontWeight:600,color:"#DC2626",marginBottom:4}}>Tarea eliminada</div>
                <div style={{fontSize:11,color:"#991B1B"}}>
                  <div>Eliminada por: {selectedTask.deletedBy?.name||"—"}</div>
                  <div>Fecha: {selectedTask.deletedAt?new Date(selectedTask.deletedAt).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):"—"}</div>
                  <div>Motivo: {selectedTask.deleteReason||"—"}</div>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Modal de confirmación de eliminación */}
        {showDeleteConfirm&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
            <div style={{background:CARD,borderRadius:12,padding:24,maxWidth:400,width:"100%"}}>
              <div style={{fontSize:16,fontWeight:700,color:T1,marginBottom:12}}>Confirmar eliminación</div>
              <div style={{fontSize:13,color:T2,marginBottom:16}}>Esta acción marcará la tarea como eliminada. Podrás restaurarla después si es necesario.</div>
              <div style={{marginBottom:16}}>
                <label style={{fontSize:12,fontWeight:600,color:T2,marginBottom:6,display:"block"}}>Motivo (obligatorio)</label>
                <textarea value={deleteReason} onChange={e=>setDeleteReason(e.target.value)}
                  placeholder="Explica por qué se elimina esta tarea..."
                  style={{width:"100%",padding:10,borderRadius:8,border:`1px solid ${BD}`,fontSize:13,background:BG,color:T1,minHeight:80,resize:"vertical"}}/>
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>{setShowDeleteConfirm(false);setDeleteReason("");}}
                  style={{flex:1,background:CARD,color:T2,border:`1px solid ${BD}`,padding:"10px",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:600}}>
                  Cancelar
                </button>
                <button onClick={handleDelete} disabled={!deleteReason.trim()}
                  style={{flex:1,background:deleteReason.trim()?"#DC2626":"#94A3B8",color:"#fff",border:"none",padding:"10px",borderRadius:8,cursor:deleteReason.trim()?"pointer":"not-allowed",fontSize:13,fontWeight:600}}>
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if(showCreateForm||editingTask){
    return <QuickTaskForm user={user} task={editingTask} onSave={(data)=>{
      if(editingTask){
        onUpdateTask(editingTask.id,data);
        setEditingTask(null);
      }else{
        onCreateTask(data);
        setShowCreateForm(false);
      }
    }} onCancel={()=>{setShowCreateForm(false);setEditingTask(null);}}/>;
  }

  // Vista principal: lista de tareas
  return(
    <div ref={scrollRef} style={{minHeight:"100vh",background:BG,overflowY:"auto"}}>
      <NavBar left={<button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:T1}}>←</button>}
        center={<span style={{fontSize:14,fontWeight:600,color:T1}}>⚡ Tareas Rápidas</span>}
        right={<button onClick={()=>setShowCreateForm(true)}
          style={{background:PR,color:"#fff",border:"none",padding:"8px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700}}>
          + Nueva
        </button>}
      />

      <div style={{maxWidth:1100,margin:"0 auto",padding:"20px 24px"}}>
        {/* Filtros */}
        <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
          {[
            ["active","Activas"],
            ["all","Todas"],
            ["pending","Pendientes"],
            ["in_progress","En proceso"],
            ["completed","Completadas"],
            ["deleted","Eliminadas"]
          ].map(([v,l])=>(
            <button key={v} onClick={()=>setFilter(v)}
              style={{background:filter===v?PR:CARD,color:filter===v?"#fff":T2,border:`1px solid ${filter===v?PR:BD}`,padding:"7px 14px",borderRadius:20,cursor:"pointer",fontSize:12,fontWeight:500,transition:"all .12s"}}>
              {l}
            </button>
          ))}
        </div>

        {/* Lista de tareas */}
        {filter==="deleted"?(
          // Vista de eliminadas
          <div>
            {filteredTasks.length===0&&<div style={{fontSize:13,color:T3,fontStyle:"italic",textAlign:"center",padding:40}}>No hay tareas eliminadas</div>}
            {filteredTasks.map(task=>(
              <Card key={task.id} sx={{padding:16,marginBottom:12,borderLeft:"4px solid #DC2626"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:14,fontWeight:600,color:T1,marginBottom:4}}>{task.title}</div>
                    <div style={{fontSize:11,color:T3,marginBottom:8}}>
                      Eliminada por: {task.deletedBy?.name||"—"} • {task.deletedAt?new Date(task.deletedAt).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"}):"—"}
                    </div>
                    <div style={{fontSize:12,color:T2}}>Motivo: {task.deleteReason||"—"}</div>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>setSelectedTask(task)}
                      style={{background:CARD,color:T2,border:`1px solid ${BD}`,padding:"6px 12px",borderRadius:8,cursor:"pointer",fontSize:11,fontWeight:600}}>
                      Ver
                    </button>
                    {canEdit(task)&&(
                      <button onClick={()=>handleRestore(task)}
                        style={{background:"#ECFDF5",color:"#059669",border:"1px solid #A7F3D0",padding:"6px 12px",borderRadius:8,cursor:"pointer",fontSize:11,fontWeight:600}}>
                        Restaurar
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ):isDireccion&&groupedByDept?(
          // Vista agrupada por departamento (Dirección)
          <div>
            {Object.keys(groupedByDept).length===0&&<div style={{fontSize:13,color:T3,fontStyle:"italic",textAlign:"center",padding:40}}>No hay tareas</div>}
            {Object.keys(groupedByDept).sort().map(dept=>(
              <div key={dept} style={{marginBottom:24}}>
                <div style={{fontSize:14,fontWeight:700,color:T1,marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:dc(dept)}}/>
                  {dept} ({groupedByDept[dept].length})
                </div>
                {groupedByDept[dept].map((task,idx)=>(
                  <Card key={task.id} cls="dc" sx={{padding:16,marginBottom:8,borderLeft:`4px solid ${priorityColor(task.priority)}`}} onClick={()=>setSelectedTask(task)}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:14,fontWeight:600,color:T1,marginBottom:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{task.title}</div>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                          <Badge ch={priorityLabel(task.priority)} c={priorityColor(task.priority)} bg={priorityColor(task.priority)+"15"}/>
                          <Badge ch={task.status} c={statusColor(task.status)} bg={statusColor(task.status)+"15"}/>
                          {task.deadline&&<Badge ch={new Date(task.deadline).toLocaleDateString("es-MX",{day:"2-digit",month:"short"})} c={T3} bg={BG}/>}
                          {task.assignedToId?(
                            <span style={{fontSize:10,color:T3}}>→ {USERS.find(u=>u.id===task.assignedToId)?.name||"—"}</span>
                          ):(
                            <span style={{fontSize:10,color:T3}}>Por: {task.createdBy?.name||"—"}</span>
                          )}
                        </div>
                      </div>
                      <div style={{display:"flex",flexDirection:"column",gap:4}}>
                        <button onClick={(e)=>{e.stopPropagation();handleChangePriority(task,"up");}} disabled={idx===0}
                          style={{background:idx===0?"#E2E8F0":CARD,color:idx===0?T3:T1,border:`1px solid ${BD}`,borderRadius:6,width:28,height:28,cursor:idx===0?"not-allowed":"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>
                          ↑
                        </button>
                        <button onClick={(e)=>{e.stopPropagation();handleChangePriority(task,"down");}} disabled={idx===groupedByDept[dept].length-1}
                          style={{background:idx===groupedByDept[dept].length-1?"#E2E8F0":CARD,color:idx===groupedByDept[dept].length-1?T3:T1,border:`1px solid ${BD}`,borderRadius:6,width:28,height:28,cursor:idx===groupedByDept[dept].length-1?"not-allowed":"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>
                          ↓
                        </button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            ))}
          </div>
        ):(
          // Vista simple (usuarios no-Dirección)
          <div>
            {filteredTasks.length===0&&<div style={{fontSize:13,color:T3,fontStyle:"italic",textAlign:"center",padding:40}}>No hay tareas</div>}
            {filteredTasks.sort((a,b)=>a.priority-b.priority).map((task,idx)=>(
              <Card key={task.id} cls="dc" sx={{padding:16,marginBottom:8,borderLeft:`4px solid ${priorityColor(task.priority)}`}} onClick={()=>setSelectedTask(task)}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:14,fontWeight:600,color:T1,marginBottom:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{task.title}</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                      <Badge ch={priorityLabel(task.priority)} c={priorityColor(task.priority)} bg={priorityColor(task.priority)+"15"}/>
                      <Badge ch={task.status} c={statusColor(task.status)} bg={statusColor(task.status)+"15"}/>
                      {task.deadline&&<Badge ch={new Date(task.deadline).toLocaleDateString("es-MX",{day:"2-digit",month:"short"})} c={T3} bg={BG}/>}
                      {task.assignedToId?(
                        <span style={{fontSize:10,color:T3}}>→ {USERS.find(u=>u.id===task.assignedToId)?.name||"—"}</span>
                      ):(
                        <span style={{fontSize:10,color:T3}}>Por: {task.createdBy?.name||"—"}</span>
                      )}
                    </div>
                  </div>
                  {canEdit(task)&&(
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      <button onClick={(e)=>{e.stopPropagation();handleChangePriority(task,"up");}} disabled={idx===0}
                        style={{background:idx===0?"#E2E8F0":CARD,color:idx===0?T3:T1,border:`1px solid ${BD}`,borderRadius:6,width:28,height:28,cursor:idx===0?"not-allowed":"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        ↑
                      </button>
                      <button onClick={(e)=>{e.stopPropagation();handleChangePriority(task,"down");}} disabled={idx===filteredTasks.length-1}
                        style={{background:idx===filteredTasks.length-1?"#E2E8F0":CARD,color:idx===filteredTasks.length-1?T3:T1,border:`1px solid ${BD}`,borderRadius:6,width:28,height:28,cursor:idx===filteredTasks.length-1?"not-allowed":"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        ↓
                      </button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Componente auxiliar: formulario de crear/editar tarea rápida
function QuickTaskForm({user,task,onSave,onCancel}){
  const [title,setTitle]=useState(task?.title||"");
  const [description,setDescription]=useState(task?.description||"");
  const [priority,setPriority]=useState(task?.priority||2);
  const [deadline,setDeadline]=useState(task?.deadline?task.deadline.split("T")[0]:"");
  const [assignedToId,setAssignedToId]=useState(task?.assignedToId||"");
  const [dept,setDept]=useState(task?.dept||"");
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState(null);
  const isMobile=useIsMobile();

  const isDireccion=user?.dept==="Dirección";

  // Calcular destinatarios en tiempo real
  const recipients=useMemo(()=>{
    if(!assignedToId) return [];
    const assignedUser=USERS.find(u=>u.id===Number(assignedToId));
    if(!assignedUser) return [];

    // Usuario asignado (si no es el creador)
    const assigned=assignedUser.id!==user?.id?[assignedUser]:[];

    // Todos de Dirección (excepto el creador)
    const direccionUsers=USERS.filter(u=>u.dept==="Dirección"&&u.id!==user?.id);

    // Dedup: evitar duplicados si el asignado es de Dirección
    const uniqueRecipients=[...assigned,...direccionUsers].reduce((acc,u)=>{
      if(!acc.find(x=>x.id===u.id)) acc.push(u);
      return acc;
    },[]);

    return uniqueRecipients;
  },[assignedToId,user]);

  const handleSave=()=>{
    if(!title.trim()){
      setError("El título es obligatorio");
      return;
    }
    if(!assignedToId){
      setError("Debes asignar la tarea a un usuario");
      return;
    }
    setSaving(true);
    const assignedUser=USERS.find(u=>u.id===Number(assignedToId));
    const data={
      title:title.trim(),
      description:description.trim(),
      priority,
      deadline:deadline?new Date(deadline+"T00:00:00").toISOString():null,
      assignedToId:Number(assignedToId),
      dept:assignedUser?.dept||""
    };
    setTimeout(()=>{
      onSave(data);
      setSaving(false);
    },100);
  };

  return(
    <div style={{minHeight:"100vh",background:BG}}>
      <NavBar left={<button onClick={onCancel} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:T1}}>←</button>}
        center={<span style={{fontSize:14,fontWeight:600,color:T1}}>{task?"Editar tarea":"Nueva tarea rápida"}</span>}
        right={null}
      />
      <div style={{maxWidth:600,margin:"0 auto",padding:"20px 24px"}}>
        <Card sx={{padding:20}}>
          {error&&<div style={{padding:10,background:"#FEF2F2",border:"1px solid #FCA5A5",borderRadius:8,fontSize:12,color:"#DC2626",marginBottom:16}}>{error}</div>}

          {/* Título */}
          <div style={{marginBottom:16}}>
            <label style={{fontSize:12,fontWeight:600,color:T2,marginBottom:6,display:"block"}}>Título *</label>
            <input type="text" value={title} onChange={e=>setTitle(e.target.value)}
              placeholder="Título de la tarea"
              style={{width:"100%",padding:10,borderRadius:8,border:`1px solid ${BD}`,fontSize:13,background:CARD,color:T1}}/>
          </div>

          {/* Descripción */}
          <div style={{marginBottom:16}}>
            <label style={{fontSize:12,fontWeight:600,color:T2,marginBottom:6,display:"block"}}>Descripción</label>
            <textarea value={description} onChange={e=>setDescription(e.target.value)}
              placeholder="Descripción opcional"
              style={{width:"100%",padding:10,borderRadius:8,border:`1px solid ${BD}`,fontSize:13,background:CARD,color:T1,minHeight:80,resize:"vertical"}}/>
          </div>

          {/* Prioridad */}
          <div style={{marginBottom:16}}>
            <label style={{fontSize:12,fontWeight:600,color:T2,marginBottom:6,display:"block"}}>Prioridad</label>
            <div style={{display:"flex",gap:8}}>
              {[1,2,3].map(p=>(
                <button key={p} onClick={()=>setPriority(p)}
                  style={{flex:1,background:priority===p?({1:"#DC2626",2:"#D97706",3:"#059669"}[p]):CARD,color:priority===p?"#fff":T2,border:`1px solid ${priority===p?({1:"#DC2626",2:"#D97706",3:"#059669"}[p]):BD}`,padding:"10px",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:600}}>
                  {{1:"Alta",2:"Media",3:"Baja"}[p]}
                </button>
              ))}
            </div>
          </div>

          {/* Asignar a usuario - LISTA PLANA */}
          <div style={{marginBottom:16}}>
            <label style={{fontSize:14,fontWeight:700,color:T1,marginBottom:8,display:"block"}}>Asignar a: *</label>
            <select value={assignedToId} onChange={e=>{
              const uid=Number(e.target.value);
              setAssignedToId(uid);
              if(uid){
                const selectedUser=USERS.find(u=>u.id===uid);
                setDept(selectedUser?.dept||"");
              }
            }}
              style={{width:"100%",padding:12,borderRadius:8,border:`2px solid ${BD}`,fontSize:14,background:CARD,color:T1,fontWeight:600}}>
              <option value="">Selecciona un usuario...</option>
              {USERS.map(u=>(
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          {/* Lista de destinatarios en tiempo real */}
          {assignedToId&&recipients.length>0&&(
            <div style={{marginBottom:20,padding:16,background:"#F0F9FF",border:"2px solid #0EA5E9",borderRadius:8}}>
              <div style={{fontSize:13,fontWeight:700,color:"#0C4A6E",marginBottom:10}}>
                📋 Recibirán esta tarea ({recipients.length} {recipients.length===1?"persona":"personas"}):
              </div>
              <div style={{maxHeight:200,overflowY:"auto"}}>
                {recipients.map(u=>(
                  <div key={u.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:`1px solid #BAE6FD`}}>
                    <div style={{width:28,height:28,borderRadius:"50%",background:"#0EA5E9",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,flexShrink:0}}>
                      {u.ini||u.name?.charAt(0)||"?"}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:"#0C4A6E"}}>{u.name}</div>
                      <div style={{fontSize:11,color:"#0369A1"}}>
                        {u.email} • {u.dept}
                        {u.dept==="Dirección"&&<span style={{marginLeft:4,fontSize:10,background:"#FEF3C7",color:"#92400E",padding:"2px 6px",borderRadius:4,fontWeight:600}}>también notificado</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{marginTop:12,padding:10,background:"#DBEAFE",borderRadius:6,fontSize:11,color:"#075985",lineHeight:1.5}}>
                ✓ Recibirán notificación por <strong>email y push</strong>
              </div>
            </div>
          )}

          {/* Advertencia si asigna a sí mismo */}
          {assignedToId&&Number(assignedToId)===user?.id&&(
            <div style={{marginBottom:16,padding:12,background:"#FFFBEB",border:"2px solid #F59E0B",borderRadius:8,fontSize:12,color:"#92400E",lineHeight:1.6}}>
              ⚠️ <strong>Te estás asignando esta tarea a ti mismo.</strong> Solo recibirás notificación in-app (sin email ni push).
            </div>
          )}

          {/* Fecha límite */}
          <div style={{marginBottom:16}}>
            <label style={{fontSize:12,fontWeight:600,color:T2,marginBottom:6,display:"block"}}>Fecha límite (opcional)</label>
            <input type="date" value={deadline} onChange={e=>setDeadline(e.target.value)}
              style={{width:"100%",padding:10,borderRadius:8,border:`1px solid ${BD}`,fontSize:13,background:CARD,color:T1}}/>
          </div>

          {/* Botones */}
          <div style={{display:"flex",gap:10}}>
            <button onClick={onCancel} disabled={saving}
              style={{flex:1,background:CARD,color:T2,border:`1px solid ${BD}`,padding:"10px",borderRadius:8,cursor:saving?"not-allowed":"pointer",fontSize:13,fontWeight:600}}>
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving}
              style={{flex:1,background:saving?"#94A3B8":PR,color:"#fff",border:"none",padding:"10px",borderRadius:8,cursor:saving?"not-allowed":"pointer",fontSize:13,fontWeight:600}}>
              {saving?"Guardando...":"Guardar"}
            </button>
          </div>
        </Card>
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
  const [showBlockForm,setShowBlockForm]=useState(false);
  const [blockReason,setBlockReason]=useState("");
  const [showCancelForm,setShowCancelForm]=useState(false);
  const [cancelReason,setCancelReason]=useState("");
  const [showAllLog,setShowAllLog]=useState(false);
  const [editingCommentIdx,setEditingCommentIdx]=useState(null);
  const [editCommentText,setEditCommentText]=useState("");
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
    const _now=new Date();
    const c={user,text:comment,time:_now.toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})+" "+_now.toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"}),iso:_now.toISOString()};
    onUpdate(taskId,{comments:[...(task?.comments||[]),c]});
    const recipientIds=[...new Set([...(task?.invIds||[]),task?.responsible?.id,task?.creator?.id].filter(Boolean))].filter(id=>id!==user?.id);
    const commentPreview=`${comment.trim().slice(0,80)}${comment.trim().length>80?"…":""}`;
    if(recipientIds.length>0){
      sendPushNotification(recipientIds,`💬 Nuevo comentario en: ${task?.title}`,`${user?.name}: ${commentPreview}`,`/?task=${taskId}`);
      // Fallback de email/WhatsApp/SMS: sin esto, quien no tenga push
      // habilitado (común en iOS sin instalar la PWA) nunca se entera
      // de comentarios nuevos, a diferencia de cualquier otro evento.
      recipientIds.forEach(id=>{
        const u=USERS.find(x=>x.id===id);
        if(!u) return;
        if(u.email){
          setTimeout(()=>sendEmailNotification("nuevo_comentario",[u.email],{
            userName:u.name,
            taskId:taskId,
            taskTitle:task?.title,
            commenterName:user?.name||"—",
            commentText:commentPreview,
          }),0);
        }
        if(u.phone){
          setTimeout(()=>sendWhatsAppNotification("nuevo_comentario",[u.phone],{
            userName:u.name,
            taskId:taskId,
            taskTitle:task?.title,
            commenterName:user?.name||"—",
            commentText:commentPreview,
          }),0);
          setTimeout(()=>sendSMSNotification("nuevo_comentario",[u.phone],{
            userName:u.name,
            taskId:taskId,
            taskTitle:task?.title,
            commenterName:user?.name||"—",
            commentText:commentPreview,
          }),0);
        }
      });
    }
    setComment("");
  };

  const startEditComment=(i,c)=>{setEditingCommentIdx(i);setEditCommentText(c.text);};
  const cancelEditComment=()=>{setEditingCommentIdx(null);setEditCommentText("");};
  const saveEditComment=i=>{
    if(!editCommentText.trim()) return;
    const updated=(task?.comments||[]).map((c,idx)=>idx===i?{...c,text:editCommentText.trim(),edited:true}:c);
    onUpdate(taskId,{comments:updated});
    setEditingCommentIdx(null);setEditCommentText("");
  };
  const deleteComment=i=>{
    const updated=(task?.comments||[]).filter((_,idx)=>idx!==i);
    onUpdate(taskId,{comments:updated});
  };

  if(!task) return <div style={{padding:40,color:T2}}>Tarea no encontrada</div>;
  const tt=TT[task.type]||{c:T2,bg:"#F9FAFB"};
  const sc=SC[task.status];const pc=PC[task.priority];const ov=isOver(task.deadline,task.status);
  const dl=dlStatus(task.deadline,task.status);
  const canReorder=user?(user.dept==="Dirección"||task.creator?.id===user.id):false;
  const canChangeState=user?(user.dept==="Dirección"||task.responsible?.id===user.id):false;
  const canDelete=user?(user.dept==="Dirección"||task.creator?.id===user.id):false;
  const canReopen=user?(user.dept==="Dirección"||user.dept==="Ingenieria"||task.creator?.id===user.id):false;
  const canEdit=canChangeState;
  const invIds=task.invIds||[];const flowStates=task.flowStates||{};
  const flowStageIds=getStageIds(invIds,task.flowStageIds);

  // FIX: Cuando el usuario aparece múltiples veces, encontrar el nodo activo correcto
  // (primera ocurrencia NO completada donde la etapa anterior está completa)
  const myInvIndex=user?(() => {
    const userOccurrences=invIds.map((id,idx)=>id===user.id?idx:-1).filter(idx=>idx!==-1);
    if(userOccurrences.length===0) return -1;
    if(userOccurrences.length===1) return userOccurrences[0];

    // Usuario aparece múltiples veces: encontrar el nodo activo
    for(const idx of userOccurrences){
      const myState=flowStates[flowStageIds[idx]]||"Pendiente";
      const prevDone=idx===0||["En proceso","Completado"].includes(flowStates[flowStageIds[idx-1]]||"Pendiente");

      // Si este nodo NO está completado y la etapa anterior SÍ está completa, es el nodo activo
      if(myState!=="Completado"&&prevDone) return idx;
    }

    // Si todos están completados o ninguno está listo, devolver la primera ocurrencia
    return userOccurrences[0];
  })():-1;

  const isInvolved=myInvIndex!==-1;
  const prevDone=myInvIndex===0||["En proceso","Completado"].includes(flowStates[flowStageIds[myInvIndex-1]]||"Pendiente");
  const canChangeOwnStep=isInvolved&&prevDone;
  const isLastNode=myInvIndex!==-1&&myInvIndex===invIds.length-1;
  const lastNodeCompleted=isLastNode&&(flowStates[flowStageIds[myInvIndex]]||"Pendiente")==="Completado";
  const pct=calcProgress(invIds,flowStates,flowStageIds);
  const isMobile=useIsMobile();

  return(
    <div style={{minHeight:"100vh",background:BG}}>
      <NavBar left={<><BackBtn onClick={onBack}/><div>
          <div style={{fontWeight:700,fontSize:14,color:T1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:260}}>{task.title}</div>
          <div style={{fontSize:11,color:T2}}>{task.id} · {task.type}</div>
        </div></>}
        center={null}
        right={<div style={{display:"flex",gap:8}}>
          {canEdit&&<button onClick={()=>onEdit(task)} style={{background:PRl,color:PR,border:`1px solid ${PR}`,padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>✏️ Editar</button>}
          {canEdit&&user.dept==="Dirección"&&<button onClick={()=>{setShowBlockForm(true);setBlockReason("");setShowCancelForm(false);}} style={{background:"#FEF2F2",color:"#DC2626",border:"1px solid #FECACA",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>🔒{isMobile?"":" Bloquear"}</button>}
          {canEdit&&<button onClick={()=>{setShowCancelForm(true);setCancelReason("");setShowBlockForm(false);}} style={{background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>✕{isMobile?"":" Cancelar"}</button>}
          {canDelete&&<button onClick={()=>onDelete(task)} style={{background:"#FEF2F2",color:"#DC2626",border:"1px solid #FECACA",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>🗑️</button>}
        </div>}
      />
      <div style={{maxWidth:860,margin:"0 auto",padding:"24px"}}>
        {/* Header card */}
        <Card sx={{padding:24,marginBottom:16,borderLeft:`4px solid ${dc(task.responsible?.dept||"Dirección")}`}}>
          {/* Block 1: type/priority/status badges */}
          <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
            <Badge ch={task.type} c={tt.c} bg={tt.bg}/><Badge ch={task.priority} c={pc.c} bg={pc.bg}/><Badge ch={task.status} c={sc.c} bg={sc.bg}/>
            {dl.isOver&&<Badge ch="⚠ VENCIDA" c="#DC2626" bg="#FEF2F2"/>}
            {dl.isToday&&<Badge ch="🟠 Vence HOY" c="#EA580C" bg="#FFF7ED"/>}
          </div>
          {/* Block 2: dept origin + responsible */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:BG,borderRadius:8,padding:"9px 14px",marginBottom:14,gap:12}}>
            <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
              <div style={{width:9,height:9,borderRadius:"50%",background:dc(task.originDept||task.creator?.dept||task.responsible?.dept||"Dirección"),flexShrink:0}}/>
              <div>
                <div style={{fontSize:10,fontWeight:600,color:T3,letterSpacing:.4}}>DEPTO. ORIGEN</div>
                <div style={{fontSize:13,fontWeight:700,color:dc(task.originDept||task.creator?.dept||"Dirección")}}>{task.originDept||task.creator?.dept||"—"}</div>
              </div>
            </div>
            {task.responsible&&(
              <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:10,fontWeight:600,color:T3,letterSpacing:.4}}>RESPONSABLE</div>
                  <div style={{fontSize:13,fontWeight:700,color:T1}}>{task.responsible.name}</div>
                </div>
                <Av u={task.responsible} size={30}/>
              </div>
            )}
          </div>
          {task.status==="Bloqueada"&&task.blockReason&&(
            <div style={{display:"flex",gap:10,alignItems:"flex-start",background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:8,padding:"10px 14px",marginBottom:10}}>
              <span style={{fontSize:16,flexShrink:0}}>🔒</span>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:"#DC2626",marginBottom:2}}>Razón de bloqueo{task.blockedBy?` — ${task.blockedBy}`:""}{task.blockedAt?` · ${new Date(task.blockedAt).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})}`:""}</div>
                <p style={{fontSize:13,color:"#991B1B",lineHeight:1.5,margin:0}}>{task.blockReason}</p>
              </div>
            </div>
          )}
          {task.status==="Cancelada"&&task.cancelReason&&(
            <div style={{display:"flex",gap:10,alignItems:"flex-start",background:"#F9FAFB",border:"1px solid #E5E7EB",borderRadius:8,padding:"10px 14px",marginBottom:10}}>
              <span style={{fontSize:16,flexShrink:0}}>✕</span>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:"#6B7280",marginBottom:2}}>Razón de cancelación{task.canceledBy?` — ${task.canceledBy}`:""}{task.canceledAt?` · ${new Date(task.canceledAt).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})}`:""}</div>
                <p style={{fontSize:13,color:T2,lineHeight:1.5,margin:0}}>{task.cancelReason}</p>
              </div>
            </div>
          )}
          {showBlockForm&&(
            <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:10,padding:14,marginBottom:10}}>
              <div style={{fontSize:12,fontWeight:700,color:"#DC2626",marginBottom:8}}>Razón del bloqueo *</div>
              <textarea value={blockReason} onChange={e=>setBlockReason(e.target.value)} rows={2}
                placeholder="Explica por qué se bloquea esta tarea..."
                style={{...inp,borderRadius:6,fontSize:12,marginBottom:10}}/>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>{
                  if(!blockReason.trim()) return;
                  onUpdate(taskId,{status:"Bloqueada",blockReason:blockReason.trim(),blockedBy:user.name,blockedById:user.id,blockedAt:new Date().toISOString()});
                  setShowBlockForm(false);
                }} disabled={!blockReason.trim()}
                  style={{background:blockReason.trim()?"#DC2626":"#E2E8F0",color:blockReason.trim()?"#fff":T3,border:"none",padding:"8px 16px",borderRadius:8,cursor:blockReason.trim()?"pointer":"not-allowed",fontSize:12,fontWeight:700}}>
                  Confirmar bloqueo
                </button>
                <button onClick={()=>setShowBlockForm(false)}
                  style={{background:CARD,border:`1px solid ${BD}`,color:T2,padding:"8px 14px",borderRadius:8,cursor:"pointer",fontSize:12}}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
          {showCancelForm&&(
            <div style={{background:"#F9FAFB",border:"1px solid #E5E7EB",borderRadius:10,padding:14,marginBottom:10}}>
              <div style={{fontSize:12,fontWeight:700,color:"#6B7280",marginBottom:8}}>Razón de la cancelación *</div>
              <textarea value={cancelReason} onChange={e=>setCancelReason(e.target.value)} rows={2}
                placeholder="Explica por qué se cancela esta tarea..."
                style={{...inp,borderRadius:6,fontSize:12,marginBottom:10}}/>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>{
                  if(!cancelReason.trim()) return;
                  onUpdate(taskId,{status:"Cancelada",cancelReason:cancelReason.trim(),canceledBy:user.name,canceledById:user.id,canceledAt:new Date().toISOString()});
                  setShowCancelForm(false);
                }} disabled={!cancelReason.trim()}
                  style={{background:cancelReason.trim()?"#6B7280":"#E2E8F0",color:"#fff",border:"none",padding:"8px 16px",borderRadius:8,cursor:cancelReason.trim()?"pointer":"not-allowed",fontSize:12,fontWeight:700}}>
                  Confirmar cancelación
                </button>
                <button onClick={()=>setShowCancelForm(false)}
                  style={{background:CARD,border:`1px solid ${BD}`,color:T2,padding:"8px 14px",borderRadius:8,cursor:"pointer",fontSize:12}}>
                  Cerrar
                </button>
              </div>
            </div>
          )}
          <h2 style={{fontSize:20,fontWeight:700,color:T1,marginBottom:8}}>{task.title}</h2>
          <p style={{fontSize:13,color:T2,lineHeight:1.7,marginBottom:task.notes?12:pct!==null?12:0}}>{task.description||"Sin descripción."}</p>
          {task.notes&&(
            <div style={{background:"#F8FAFC",border:"1px solid #E2E8F0",borderRadius:10,padding:"10px 14px",marginBottom:pct!==null?12:0}}>
              <div style={{fontSize:11,fontWeight:700,color:T3,letterSpacing:.5,marginBottom:4}}>NOTAS ADICIONALES</div>
              <p style={{fontSize:13,color:T2,lineHeight:1.7,margin:0,whiteSpace:"pre-wrap"}}>{task.notes}</p>
            </div>
          )}
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

        {/* Botón principal completar */}
        {user&&isActive(task)&&lastNodeCompleted&&(
          <button onClick={()=>onUpdate(taskId,{status:"Completada",completedAt:new Date().toISOString()})}
            style={{width:"100%",background:"#059669",color:"#fff",border:"none",padding:"16px",borderRadius:12,fontSize:15,fontWeight:700,cursor:"pointer",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"center",gap:10,boxShadow:"0 4px 14px rgba(5,150,105,.35)",transition:"all .15s"}}
            onMouseEnter={e=>{e.currentTarget.style.background="#047857";e.currentTarget.style.transform="translateY(-1px)";}}
            onMouseLeave={e=>{e.currentTarget.style.background="#059669";e.currentTarget.style.transform="translateY(0)";}}>
            <span style={{fontSize:20}}>✓</span> Marcar como Completada
          </button>
        )}

        {task.status==="Completada"&&canReopen&&(
          <button onClick={()=>{
              const _n=new Date();
              const entry={
                userId:user.id,userName:user.name,userIni:user.ini,userUc:user.uc,
                targetId:task.responsible?.id||null,targetName:task.responsible?.name||"—",
                prevState:"Completada",newState:"En proceso",
                time:_n.toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})+" "+_n.toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"}),
              };
              onUpdate(taskId,{status:"En proceso",completedAt:null,flowLog:[...(task.flowLog||[]),entry]});
            }}
            style={{width:"100%",background:"#D97706",color:"#fff",border:"none",padding:"16px",borderRadius:12,fontSize:15,fontWeight:700,cursor:"pointer",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"center",gap:10,boxShadow:"0 4px 14px rgba(217,119,6,.35)",transition:"all .15s"}}
            onMouseEnter={e=>{e.currentTarget.style.background="#B45309";e.currentTarget.style.transform="translateY(-1px)";}}
            onMouseLeave={e=>{e.currentTarget.style.background="#D97706";e.currentTarget.style.transform="translateY(0)";}}>
            <span style={{fontSize:20}}>↺</span> Reabrir tarea
          </button>
        )}

        <div style={{display:isMobile?"flex":"grid",flexDirection:isMobile?"column":undefined,gridTemplateColumns:isMobile?undefined:"1fr 260px",gap:16}}>
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            {/* Mobile: Responsable + FechaLimite above flow */}
            {isMobile&&task.responsible&&<Card sx={{padding:16}}><Lbl ch="RESPONSABLE"/><div style={{display:"flex",alignItems:"center",gap:10}}><Av u={task.responsible} size={36}/><div><div style={{fontSize:13,fontWeight:600,color:T1}}>{task.responsible.name}</div><div style={{fontSize:11,color:T2}}>{task.responsible.dept}</div></div></div></Card>}
            {isMobile&&<Card sx={{padding:16}}><Lbl ch="FECHA LÍMITE"/><div style={{fontSize:15,fontWeight:700,color:dl.c}}>{dl.label}</div><div style={{fontSize:11,color:T3,marginTop:2}}>{task.deadline}</div></Card>}
            {/* Flow diagram */}
            <Card sx={{padding:20}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                <Lbl ch="DIAGRAMA DE FLUJO — INVOLUCRADOS"/>
                {canReorder&&<span style={{fontSize:11,color:T3}}>↑↓ para reordenar</span>}
              </div>
              <FlowDiagram invIds={invIds} flowStates={flowStates} flowStageIds={flowStageIds}
                onReorder={(ids,sids)=>onUpdate(taskId,{invIds:ids,flowStageIds:sids})}
                onStateChange={(sid,newSt)=>{
                  const prev=flowStates[sid]||"Pendiente";
                  if(prev===newSt) return;
                  const _n=new Date();
                  const idx=flowStageIds.indexOf(sid);
                  const targetId=idx!==-1?invIds[idx]:null;
                  const entry={
                    userId:user.id,userName:user.name,userIni:user.ini,userUc:user.uc,
                    targetId,targetName:USERS.find(u=>u.id===targetId)?.name||"",
                    prevState:prev,newState:newSt,
                    time:_n.toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})+" "+_n.toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"}),
                  };
                  // Auto-activar tarea cuando el primer nodo pasa a "En proceso"
                  const isFirstNode=idx===0;
                  const updatePayload={flowStates:{...flowStates,[sid]:newSt},flowLog:[...(task.flowLog||[]),entry]};
                  if(isFirstNode&&newSt==="En proceso"&&task.status==="Pendiente"){
                    updatePayload.status="En proceso";
                  }
                  onUpdate(taskId,updatePayload);
                }}
                canReorder={canReorder} canChangeState={canChangeState}
                myInvIndex={myInvIndex}
                canChangeOwnStep={canChangeOwnStep}
                nodeNotes={task.nodeNotes||{}}
                onNoteChange={(sid,val)=>onUpdate(taskId,{nodeNotes:{...(task.nodeNotes||{}),[sid]:val}})}
                canEditNotes={canReorder}
                attachments={task.attachments||[]}
                taskId={task.id}
                user={user}
                onAttachmentsChange={atts=>onUpdate(taskId,{attachments:atts})}/>
            </Card>
            {/* Flow log */}
            {(task.flowLog||[]).length>0&&(
              <Card sx={{padding:20}}>
                <Lbl ch="HISTORIAL DE CAMBIOS DE ESTADO"/>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {(()=>{
                    const log=[...(task.flowLog||[])].reverse();
                    const visible=showAllLog?log:log.slice(0,3);
                    return(<>
                      {visible.map((e,i)=>(
                        <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                          <div style={{width:28,height:28,borderRadius:"50%",background:e.userUc||"#6B7280",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                            <span style={{color:"#fff",fontSize:10,fontWeight:700}}>{e.userIni||"?"}</span>
                          </div>
                          <div style={{flex:1,background:BG,borderRadius:8,padding:"8px 12px"}}>
                            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4,flexWrap:"wrap",gap:4}}>
                              <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                                <span style={{fontSize:12,fontWeight:600,color:T1}}>{e.userName}</span>
                                <span style={{fontSize:11,color:T3}}>cambió</span>
                                <Badge ch={`${FS_CFG[e.prevState]?.icon||"○"} ${e.prevState}`} c={FS_CFG[e.prevState]?.c||T3} bg={FS_CFG[e.prevState]?.bg||BG}/>
                                <span style={{fontSize:11,color:T3}}>→</span>
                                <Badge ch={`${FS_CFG[e.newState]?.icon||"○"} ${e.newState}`} c={FS_CFG[e.newState]?.c||T3} bg={FS_CFG[e.newState]?.bg||BG}/>
                              </div>
                              <span style={{fontSize:10,color:T3,whiteSpace:"nowrap"}}>{e.time}</span>
                            </div>
                            <div style={{fontSize:11,color:T2}}>para: <span style={{fontWeight:500,color:T1}}>{e.targetName}</span></div>
                          </div>
                        </div>
                      ))}
                      {log.length>3&&(
                        <button onClick={()=>setShowAllLog(p=>!p)}
                          style={{width:"100%",marginTop:4,background:"none",border:`1px solid ${BD}`,borderRadius:8,padding:"8px",cursor:"pointer",fontSize:12,color:T2,fontWeight:600,fontFamily:"inherit"}}>
                          {showAllLog?"▲ Ver menos":`▼ Ver más (${log.length-3} entradas anteriores)`}
                        </button>
                      )}
                    </>);
                  })()}
                </div>
              </Card>
            )}
            {/* Comments */}
            <Card sx={{padding:20}}>
              <Lbl ch="COMENTARIOS Y SEGUIMIENTO"/>
              {task.comments.length===0&&<div style={{color:T3,fontSize:13,textAlign:"center",padding:"20px 0"}}>Sin comentarios aún</div>}
              <div style={{display:"flex",flexDirection:"column",gap:14,marginBottom:16}}>
                {task.comments.map((c,i)=>{
                  if(c.isAviso) return(
                    <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                      <div style={{width:30,height:30,borderRadius:"50%",background:"#F59E0B",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:14}}>📢</div>
                      <div style={{flex:1,background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:10,padding:"10px 14px"}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,flexWrap:"wrap",gap:4}}>
                          <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                            <span style={{fontSize:11,fontWeight:700,color:"#92400E",letterSpacing:.4}}>AVISO</span>
                            <span style={{fontSize:11,color:"#78350F"}}>de <strong>{c.user?.name}</strong></span>
                            <span style={{fontSize:11,color:"#B45309"}}>→ {c.avisoDestLabel||"Todos"}</span>
                          </div>
                          <span style={{fontSize:10,color:"#B45309",whiteSpace:"nowrap"}}>{c.time}</span>
                        </div>
                        <p style={{fontSize:13,color:"#78350F",lineHeight:1.6,fontWeight:500,margin:0}}>{c.text}</p>
                      </div>
                    </div>
                  );
                  const isMine=user&&c.user?.id===user.id;
                  const isEditingThis=editingCommentIdx===i;
                  return(
                    <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                      <Av u={c.user} size={30}/>
                      <div style={{flex:1,background:BG,borderRadius:10,padding:"10px 14px"}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4,gap:8}}>
                          <span style={{fontSize:12,fontWeight:600,color:T1}}>{c.user?.name}</span>
                          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                            <span style={{fontSize:11,color:T3}}>{c.time}{c.edited&&" (editado)"}</span>
                            {isMine&&!isEditingThis&&(
                              <>
                                <button onClick={()=>startEditComment(i,c)} title="Editar"
                                  style={{background:"none",border:"none",color:T3,cursor:"pointer",fontSize:12,padding:0}}>✏️</button>
                                <button onClick={()=>deleteComment(i)} title="Borrar"
                                  style={{background:"none",border:"none",color:T3,cursor:"pointer",fontSize:12,padding:0}}>🗑️</button>
                              </>
                            )}
                          </div>
                        </div>
                        {isEditingThis?(
                          <div style={{display:"flex",flexDirection:"column",gap:6}}>
                            <textarea value={editCommentText} onChange={e=>setEditCommentText(e.target.value)} rows={2} autoFocus
                              style={{...inp,fontSize:13,padding:"8px 10px",borderRadius:6}}/>
                            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                              <button onClick={cancelEditComment} style={{background:"none",border:`1px solid ${BD}`,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:600,color:T2}}>Cancelar</button>
                              <button onClick={()=>saveEditComment(i)} disabled={!editCommentText.trim()} style={{background:editCommentText.trim()?PR:"#E2E8F0",color:editCommentText.trim()?"#fff":T3,border:"none",borderRadius:6,padding:"4px 12px",cursor:editCommentText.trim()?"pointer":"default",fontSize:11,fontWeight:600}}>Guardar</button>
                            </div>
                          </div>
                        ):(
                          <p style={{fontSize:13,color:T2,lineHeight:1.6}}>{c.text}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {user&&<div style={{border:`1px solid ${BD}`,borderRadius:10,overflow:"hidden"}}>
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
              </div>}
            </Card>
          </div>
          {/* Sidebar */}
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {!isMobile&&<Card sx={{padding:16}}><Lbl ch="RESPONSABLE"/>{task.responsible&&<div style={{display:"flex",alignItems:"center",gap:10}}><Av u={task.responsible} size={36}/><div><div style={{fontSize:13,fontWeight:600,color:T1}}>{task.responsible.name}</div><div style={{fontSize:11,color:T2}}>{task.responsible.dept}</div></div></div>}</Card>}
            <Card sx={{padding:16}}><Lbl ch="DEPTO. ORIGEN"/><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:9,height:9,borderRadius:"50%",background:dc(task.creator?.dept||"Dirección")}}/><span style={{fontSize:13,color:T1,fontWeight:500}}>{task.creator?.dept||"—"}</span></div></Card>
            {!isMobile&&<Card sx={{padding:16}}><Lbl ch="FECHA LÍMITE"/><div style={{fontSize:15,fontWeight:700,color:dl.c}}>{dl.label}</div><div style={{fontSize:11,color:T3,marginTop:2}}>{task.deadline}</div></Card>}
            <Card sx={{padding:16}}><Lbl ch="TIPO · PRIORIDAD"/><div style={{display:"flex",gap:6,flexWrap:"wrap"}}><Badge ch={task.type} c={tt.c} bg={tt.bg}/><Badge ch={task.priority} c={pc.c} bg={pc.bg}/></div></Card>
            <Card sx={{padding:16}}><Lbl ch="ORIGEN"/><div style={{fontSize:13,color:T1}}>{task.origin}</div></Card>
            {task.createdAt&&(
              <Card sx={{padding:16}}>
                <Lbl ch="TIEMPO ACTIVA"/>
                <div style={{fontSize:24,fontWeight:700,color:PR,lineHeight:1}}>
                  {safeDays(task.createdAt)}
                  <span style={{fontSize:12,fontWeight:400,color:T2,marginLeft:5}}>días</span>
                </div>
                <div style={{fontSize:11,color:T3,marginTop:4}}>desde {safeDate(task.createdAt)?.toLocaleDateString("es-MX",{day:"numeric",month:"short",year:"numeric"}) || "—"}</div>
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
function ScreenCreate({user,taskCount,onSave,onCancel,defaultDept,taskToEdit,saveError}){
  const isEdit=!!taskToEdit;
  const [form,setForm]=useState(()=>{
    if(isEdit) return{type:taskToEdit.type||"",title:taskToEdit.title||"",description:taskToEdit.description||"",respId:taskToEdit.responsible?String(taskToEdit.responsible.id):"",invIds:taskToEdit.invIds||[],flowStageIds:getStageIds(taskToEdit.invIds||[],taskToEdit.flowStageIds),deadline:taskToEdit.deadline||"",priority:taskToEdit.priority||"Media",origin:taskToEdit.origin||"Sistema",notes:taskToEdit.notes||"",originDept:taskToEdit.originDept||taskToEdit.creator?.dept||user.dept,notifyOnComplete:taskToEdit.notifyOnComplete||[]};
    const dr=defaultDept?USERS.find(u=>u.dept===defaultDept):null;
    return{...BLANK,flowStageIds:[],respId:dr?String(dr.id):"",originDept:user.dept};
  });
  const isMobile=useIsMobile();
  const [insertAt,setInsertAt]=useState(null);

  const addInv=id=>setForm(p=>({...p,invIds:[...p.invIds,id],flowStageIds:[...p.flowStageIds,genStageId()]}));
  const insertInvAt=(i,id)=>setForm(p=>{
    const invIds=[...p.invIds];invIds.splice(i,0,id);
    const flowStageIds=[...p.flowStageIds];flowStageIds.splice(i,0,genStageId());
    return{...p,invIds,flowStageIds};
  });
  const removeInvAt=i=>setForm(p=>({...p,invIds:p.invIds.filter((_,idx)=>idx!==i),flowStageIds:p.flowStageIds.filter((_,idx)=>idx!==i)}));
  const canSave=form.type&&form.title&&form.respId&&form.deadline&&(form.notifyOnComplete||[]).length>0;
  const [saving, setSaving] = useState(false);

  const doSave = async () => {
    if(!canSave || saving) return;
    setSaving(true);
    const fs = form.flowStageIds.reduce((acc,sid)=>({...acc,[sid]:isEdit?(taskToEdit.flowStates?.[sid]||"Pendiente"):"Pendiente"}),{});
    const now = new Date().toISOString();
    const taskData = isEdit
      ? {type:form.type,title:form.title,description:form.description,notes:form.notes,originDept:form.originDept,responsible:USERS.find(u=>u.id===parseInt(form.respId)),invIds:form.invIds,flowStageIds:form.flowStageIds,flowStates:fs,deadline:form.deadline,priority:form.priority,origin:form.origin,notifyOnComplete:form.notifyOnComplete}
      : {id:`TSK-${Date.now().toString(36).toUpperCase().slice(-6)}`,type:form.type,title:form.title,description:form.description,notes:form.notes,originDept:form.originDept,creator:user,responsible:USERS.find(u=>u.id===parseInt(form.respId)),invIds:form.invIds,flowStageIds:form.flowStageIds,flowStates:fs,deadline:form.deadline,priority:form.priority,origin:form.origin,status:"Pendiente",comments:[],confirmed:[],createdAt:now,notifyOnComplete:form.notifyOnComplete};
    try {
      await onSave(taskData);
    } catch(err) {
      console.error("[doSave] Error:", err);
      setSaving(false);
    }
  };

  return(
    <div style={{minHeight:"100vh",background:BG}}>
      <NavBar left={<><BackBtn onClick={onCancel}/><div style={{fontWeight:700,fontSize:15,color:T1}}>{isEdit?"Editar Tarea":"Nueva Tarea"}</div></>}
        center={null}
        right={null}
      />
      <div style={{maxWidth:680,margin:"0 auto",padding:isMobile?"16px":"28px 24px"}}>
        <div style={{display:"flex",flexDirection:"column",gap:22}}>
          <h2 style={{fontSize:18,fontWeight:700,color:T1}}>{isEdit?"Editar detalles":"Detalles de la tarea"}</h2>
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
          <div>
            <Lbl ch="DEPARTAMENTO ORIGEN"/>
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:BG,borderRadius:10,border:`1px solid ${BD}`}}>
              <div style={{width:10,height:10,borderRadius:"50%",background:dc(form.originDept),flexShrink:0}}/>
              <span style={{fontSize:13,fontWeight:600,color:T1}}>{form.originDept}</span>
              <span style={{fontSize:11,color:T3,marginLeft:"auto"}}>Asignado automáticamente</span>
            </div>
          </div>
          <div><Lbl ch="RESPONSABLE PRINCIPAL *"/>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(3,1fr)",gap:8}}>
              {USERS.filter(u=>getAssignableIds(user).includes(u.id)).map(u=>{const a=form.respId===String(u.id);return(
                <button key={u.id} onClick={()=>setForm(p=>({...p,respId:String(u.id)}))} style={{background:a?u.uc:CARD,color:a?"#fff":T1,border:`1.5px solid ${a?u.uc:BD}`,padding:"10px",borderRadius:10,cursor:"pointer",display:"flex",alignItems:"center",gap:8,transition:"all .12s"}}>
                  <div style={{width:26,height:26,borderRadius:"50%",background:a?"rgba(255,255,255,.3)":u.uc+"22",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{color:a?"#fff":u.uc,fontSize:10,fontWeight:700}}>{u.ini}</span></div>
                  <div style={{textAlign:"left",minWidth:0}}><div style={{fontSize:11,fontWeight:600,lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{shortName(u.name)}</div><div style={{fontSize:10,opacity:.75}}>{u.dept}</div></div>
                </button>
              );})}
            </div>
          </div>
          <div><Lbl ch={`INVOLUCRADOS — orden de flujo (${form.invIds.length})`}/>
            <div style={{fontSize:11,color:T3,marginBottom:8}}>El orden de selección define el flujo de seguimiento. Usa "+" para insertar a alguien en una posición intermedia sin perder las notas ya capturadas.</div>
            {form.invIds.length>0&&<div style={{background:BG,borderRadius:8,padding:"10px 12px",marginBottom:10,display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
              {form.invIds.map((id,i)=>{const u=USERS.find(x=>x.id===id);if(!u) return null;return(
                <Fragment key={i}>
                  <button onClick={()=>setInsertAt(i)} title="Insertar aquí" style={{background:insertAt===i?PR:CARD,color:insertAt===i?"#fff":T3,border:`1px dashed ${insertAt===i?PR:BD}`,borderRadius:"50%",width:20,height:20,cursor:"pointer",fontSize:12,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>+</button>
                  <div style={{display:"flex",alignItems:"center",gap:6,background:CARD,border:`1px solid ${u.uc}`,borderRadius:20,padding:"4px 10px"}}>
                    <div style={{width:18,height:18,borderRadius:"50%",background:u.uc,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{color:"#fff",fontSize:9,fontWeight:700}}>{i+1}</span></div>
                    <span style={{fontSize:12,color:T1,fontWeight:500}}>{shortName(u.name)}</span>
                    <button onClick={()=>removeInvAt(i)} style={{background:"none",border:"none",color:T3,cursor:"pointer",fontSize:14,lineHeight:1,padding:"0 2px"}}>×</button>
                  </div>
                </Fragment>
              );})}
              <button onClick={()=>setInsertAt(form.invIds.length)} title="Insertar al final" style={{background:insertAt===form.invIds.length?PR:CARD,color:insertAt===form.invIds.length?"#fff":T3,border:`1px dashed ${insertAt===form.invIds.length?PR:BD}`,borderRadius:"50%",width:20,height:20,cursor:"pointer",fontSize:12,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>+</button>
            </div>}
            {insertAt!==null&&(
              <div style={{display:"flex",alignItems:"center",gap:8,background:PRl,border:`1px solid ${PR}`,borderRadius:8,padding:"8px 12px",marginBottom:10}}>
                <span style={{fontSize:12,color:PR,fontWeight:600}}>Elige a quién insertar en la posición {insertAt+1}</span>
                <button onClick={()=>setInsertAt(null)} style={{marginLeft:"auto",background:"none",border:"none",color:PR,cursor:"pointer",fontSize:12,fontWeight:600}}>Cancelar</button>
              </div>
            )}
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(2,1fr)",gap:"14px 16px"}}>
              {USERS_BY_DEPT.map(g=>(
                <div key={g.dept}>
                  <div style={{fontSize:10,fontWeight:600,color:T3,letterSpacing:.5,textTransform:"uppercase",marginBottom:6}}>{g.dept}</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                    {g.users.map(u=>{const count=form.invIds.filter(id=>id===u.id).length;const sel=count>0;const isMe=u.id===user.id;return(
                      <button key={u.id} onClick={()=>{
                        if(insertAt!==null){insertInvAt(insertAt,u.id);setInsertAt(null);}
                        else addInv(u.id);
                      }} style={{background:sel?u.uc+"15":CARD,color:sel?u.uc:T2,border:`1.5px solid ${sel?u.uc:BD}`,padding:"7px 12px",borderRadius:20,cursor:"pointer",fontSize:12,fontWeight:sel?700:400,display:"flex",alignItems:"center",gap:6,transition:"all .12s"}}>
                        {sel&&<span style={{background:u.uc,color:"#fff",borderRadius:"50%",width:16,height:16,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700}}>{count}</span>}
                        <span>{isMe?"Yo mismo":shortName(u.name)}</span>
                      </button>
                    );})}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div><Lbl ch="FECHA LÍMITE *"/><input type="date" value={form.deadline} onChange={e=>setForm(p=>({...p,deadline:e.target.value}))} style={{...inp,borderRadius:10}}/></div>
          <div><Lbl ch="TÍTULO *"/><input value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))} placeholder="Descripción corta de la tarea" style={{...inp,borderRadius:10}}/></div>
          <div><Lbl ch="DESCRIPCIÓN (opcional)"/><textarea value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} rows={3} placeholder="Contexto adicional..." style={{...inp,borderRadius:10,lineHeight:1.7}}/></div>
          <div><Lbl ch="NOTAS ADICIONALES (opcional)"/><textarea value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} rows={3} placeholder="Notas internas, observaciones, acuerdos previos..." style={{...inp,borderRadius:10,lineHeight:1.7}}/></div>
          <div>
            <Lbl ch="NOTIFICAR AL COMPLETAR *"/>
            <div style={{fontSize:11,color:T3,marginBottom:8}}>Estas personas recibirán un aviso cuando la tarea cambie a Completada. Selecciona al menos una.</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {USERS.map(u=>{const sel=(form.notifyOnComplete||[]).includes(u.id);const isMe=u.id===user.id;return(
                <button key={u.id} onClick={()=>setForm(p=>({...p,notifyOnComplete:sel?(p.notifyOnComplete||[]).filter(id=>id!==u.id):[...(p.notifyOnComplete||[]),u.id]}))}
                  style={{background:sel?u.uc+"18":CARD,color:sel?u.uc:T2,border:`1.5px solid ${sel?u.uc:BD}`,padding:"7px 12px",borderRadius:20,cursor:"pointer",fontSize:12,fontWeight:sel?700:400,display:"flex",alignItems:"center",gap:6,transition:"all .12s"}}>
                  {sel&&<span style={{background:u.uc,color:"#fff",borderRadius:"50%",width:16,height:16,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11}}>✓</span>}
                  <span>{isMe?"Yo mismo":shortName(u.name)}</span>
                </button>
              );})}
            </div>
          </div>
          {saveError&&<div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:8,padding:"12px 16px",fontSize:13,color:"#DC2626",fontWeight:500}}>⚠️ {saveError}</div>}
          <button
            onClick={doSave}
            onTouchEnd={e=>{e.preventDefault();doSave();}}
            disabled={!canSave||saving}
            style={{background:canSave&&!saving?PR:"#E2E8F0",color:canSave&&!saving?"#fff":T3,border:"none",padding:"15px",fontSize:14,fontWeight:700,cursor:canSave&&!saving?"pointer":"not-allowed",borderRadius:12,transition:"background .12s"}}>
            {saving?"Guardando...":isEdit?"Guardar Cambios":"Crear Tarea"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   SCREEN: AVISOS
════════════════════════════════════════ */
function ScreenAviso({user,avisos,onSend,onMarkRead,onUpdateAviso,onDeleteAviso,onBack,initialSelected}){
  const scrollRef=useScrollRestore("avisos");
  const [tab,setTab]=useState("inbox");
  const [dests,setDests]=useState([]);
  const [texto,setTexto]=useState("");
  const [selectedAviso,setSelectedAviso]=useState(initialSelected||null);
  const [draftAttachments,setDraftAttachments]=useState([]);
  const [draftId,setDraftId]=useState(()=>`AV-${Date.now()}`);
  const [uploadingAttach,setUploadingAttach]=useState(false);
  const [attachErr,setAttachErr]=useState(null);
  const [commentText,setCommentText]=useState("");
  const [editingCommentId,setEditingCommentId]=useState(null);
  const [editCommentText,setEditCommentText]=useState("");
  const [editingAviso,setEditingAviso]=useState(false);
  const [editTexto,setEditTexto]=useState("");
  const [editDestIds,setEditDestIds]=useState([]);
  const [editAttachments,setEditAttachments]=useState([]);
  const [editUploadingAttach,setEditUploadingAttach]=useState(false);
  const [editAttachErr,setEditAttachErr]=useState(null);
  const [showDeleteConfirm,setShowDeleteConfirm]=useState(false);
  const isMobile=useIsMobile();

  const myAvisos=useMemo(()=>
    [...avisos].filter(a=>avisoIncludesUser(a,user.id))
      .sort((a,b)=>new Date(b.fecha)-new Date(a.fecha))
  ,[avisos,user.id]);

  const sentAvisos=useMemo(()=>
    [...avisos].filter(a=>a.origen?.id===user.id)
      .sort((a,b)=>new Date(b.fecha)-new Date(a.fecha))
  ,[avisos,user.id]);

  const unread=useMemo(()=>myAvisos.filter(a=>!(a.leidoPor||[]).includes(user.id)),[myAvisos,user.id]);

  useEffect(()=>{
    if(tab==="inbox") myAvisos.forEach(a=>{if(!(a.leidoPor||[]).includes(user.id)) onMarkRead(a.id);});
  },[tab,myAvisos,user.id,onMarkRead]);

  // Resync: si el aviso abierto cambia en el array `avisos` (p.ej. llega un
  // comentario nuevo por Realtime), refleja la versión viva en vez de
  // quedarse con la foto local tomada al abrirlo.
  useEffect(()=>{
    if(!selectedAviso) return;
    const fresh=avisos.find(x=>x.id===selectedAviso.id);
    if(fresh&&fresh!==selectedAviso) setSelectedAviso(fresh);
  },[avisos,selectedAviso]);

  const fmtFecha=f=>{
    const d=new Date(f);
    return d.toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})+" "+d.toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"});
  };

  const toggleDest=v=>{
    if(v==="todos") setDests(p=>p.includes("todos")?[]:[("todos")]);
    else setDests(p=>p.includes("todos")?[v]:p.includes(v)?p.filter(x=>x!==v):[...p,v]);
  };

  const canSendAviso=texto.trim()&&dests.length>0;

  const handleAttachFiles=async files=>{
    setAttachErr(null);
    for(const file of files){
      if(file.size>MAX_ATTACHMENT_SIZE){setAttachErr(`"${file.name}" supera 20MB`);continue;}
      setUploadingAttach(true);
      const path=`avisos/${draftId}/${Date.now()}_${file.name}`;
      const{error}=await supabase.storage.from("task-attachments").upload(path,file);
      setUploadingAttach(false);
      if(error){setAttachErr(error.message);continue;}
      const newAtt={nombre:file.name,url:path,subidoPor:{id:user.id,name:user.name,ini:user.ini,uc:user.uc},fecha:new Date().toISOString()};
      setDraftAttachments(p=>[...p,newAtt]);
    }
  };

  const handleRemoveDraftAttachment=async idx=>{
    const att=draftAttachments[idx];
    setDraftAttachments(p=>p.filter((_,i)=>i!==idx));
    if(att) await supabase.storage.from("task-attachments").remove([att.url]);
  };

  const handleDownloadAttachment=async att=>{
    await downloadAttachmentIOS(att);
  };

  const postAvisoComment=()=>{
    if(!commentText.trim()||!selectedAviso) return;
    const a=selectedAviso;
    const newComment={id:`ac-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,text:commentText.trim(),authorId:user.id,authorName:user.name,iso:new Date().toISOString()};
    setSelectedAviso({...a,comments:[...(a.comments||[]),newComment]});
    setCommentText("");
    // Append atómico server-side: nunca pisa un comentario que otro
    // cliente haya agregado casi al mismo tiempo (ver append_aviso_comment).
    supabase.rpc("append_aviso_comment",{aviso_id:a.id,new_comment:newComment})
      .then(({error})=>{if(error)console.error("[Supabase] Error append_aviso_comment:",error.message);});
    const words=a.texto.split(" ").slice(0,6).join(" ");
    const pushTitle=`💬 Nuevo comentario en aviso: ${words}${a.texto.split(" ").length>6?"...":""}`;
    const destIds=avisoRecipients(a);
    const recipientIds=destIds==="todos"
      ?USERS.map(u=>u.id).filter(id=>id!==user.id)
      :[...new Set([a.origen?.id,...(Array.isArray(destIds)?destIds:[destIds])])].filter(id=>id&&id!==user.id);
    if(recipientIds.length>0) sendPushNotification(recipientIds,pushTitle,newComment.text,`/?aviso=${a.id}`);
  };

  const editAvisoComment=(commentId,newText)=>{
    if(!newText.trim()||!selectedAviso) return;
    const a=selectedAviso;
    setSelectedAviso({...a,comments:(a.comments||[]).map(c=>c.id===commentId?{...c,text:newText.trim(),edited:true}:c)});
    supabase.rpc("edit_aviso_comment",{aviso_id:a.id,comment_id:commentId,new_text:newText.trim()})
      .then(({error})=>{if(error)console.error("[Supabase] Error edit_aviso_comment:",error.message);});
  };

  const deleteAvisoComment=commentId=>{
    if(!selectedAviso) return;
    const a=selectedAviso;
    setSelectedAviso({...a,comments:(a.comments||[]).filter(c=>c.id!==commentId)});
    supabase.rpc("delete_aviso_comment",{aviso_id:a.id,comment_id:commentId})
      .then(({error})=>{if(error)console.error("[Supabase] Error delete_aviso_comment:",error.message);});
  };

  const send=()=>{
    if(!canSendAviso) return;
    const fecha=new Date().toISOString();
    if(dests.includes("todos")){
      onSend({id:`AV-${Date.now()}-todos`,origen:user,destinatarioIds:"todos",destinatarioLabel:"Todos",texto:texto.trim(),fecha,leidoPor:[user.id],attachments:draftAttachments});
    } else {
      const destUsers=dests.map(id=>USERS.find(u=>u.id===id)).filter(Boolean);
      onSend({
        id:`AV-${Date.now()}`,origen:user,
        destinatarioIds:destUsers.map(u=>u.id),
        destinatarioLabel:destUsers.length>1?`${destUsers.length} personas`:destUsers[0]?.name,
        texto:texto.trim(),fecha,leidoPor:[user.id],attachments:draftAttachments,
      });
    }
    setTexto("");setDests([]);setDraftAttachments([]);setDraftId(`AV-${Date.now()}`);setTab("inbox");
  };

  const startEdit=()=>{
    const a=selectedAviso;
    setEditTexto(a.texto);
    const d=avisoRecipients(a);
    setEditDestIds(d==="todos"?["todos"]:Array.isArray(d)?d:[d]);
    setEditAttachments(a.attachments||[]);
    setEditAttachErr(null);
    setEditingAviso(true);
  };

  const toggleEditDest=v=>{
    if(v==="todos") setEditDestIds(p=>p.includes("todos")?[]:["todos"]);
    else setEditDestIds(p=>p.includes("todos")?[v]:p.includes(v)?p.filter(x=>x!==v):[...p,v]);
  };

  const cancelEdit=()=>{setEditingAviso(false);setEditAttachErr(null);};

  const handleEditAttachFiles=async files=>{
    setEditAttachErr(null);
    for(const file of files){
      if(file.size>MAX_ATTACHMENT_SIZE){setEditAttachErr(`"${file.name}" supera 20MB`);continue;}
      setEditUploadingAttach(true);
      const path=`avisos/${selectedAviso.id}/${Date.now()}_${file.name}`;
      const{error}=await supabase.storage.from("task-attachments").upload(path,file);
      setEditUploadingAttach(false);
      if(error){setEditAttachErr(error.message);continue;}
      const newAtt={nombre:file.name,url:path,subidoPor:{id:user.id,name:user.name,ini:user.ini,uc:user.uc},fecha:new Date().toISOString()};
      setEditAttachments(p=>[...p,newAtt]);
    }
  };

  const handleRemoveEditAttachment=async idx=>{
    const att=editAttachments[idx];
    setEditAttachments(p=>p.filter((_,i)=>i!==idx));
    if(att) await supabase.storage.from("task-attachments").remove([att.url]);
  };

  const canSaveEdit=editTexto.trim()&&editDestIds.length>0;

  const saveEdit=()=>{
    if(!canSaveEdit||!selectedAviso) return;
    const a=selectedAviso;
    const isTodosEdit=editDestIds.includes("todos");
    const destUsers=isTodosEdit?[]:editDestIds.map(id=>USERS.find(u=>u.id===id)).filter(Boolean);
    const patch={
      texto:editTexto.trim(),
      destinatarioIds:isTodosEdit?"todos":destUsers.map(u=>u.id),
      destinatarioLabel:isTodosEdit?"Todos":(destUsers.length>1?`${destUsers.length} personas`:destUsers[0]?.name),
      attachments:editAttachments,
    };
    setSelectedAviso({...a,...patch});
    if(onUpdateAviso) onUpdateAviso(a.id,patch);
    setEditingAviso(false);
  };

  const handleDeleteAviso=()=>{
    if(!selectedAviso) return;
    if(onDeleteAviso) onDeleteAviso(selectedAviso.id);
    setShowDeleteConfirm(false);
    setSelectedAviso(null);
  };

  if(selectedAviso){
    const a=selectedAviso;
    const destIds=avisoRecipients(a);
    const isTodos=destIds==="todos";
    const recipientUsers=isTodos
      ?USERS.filter(u=>u.id!==a.origen?.id)
      :(Array.isArray(destIds)?destIds:[destIds]).map(id=>USERS.find(u=>u.id===id)).filter(Boolean);
    const readUsers=recipientUsers.filter(u=>(a.leidoPor||[]).includes(u.id));
    const unreadUsers=recipientUsers.filter(u=>!(a.leidoPor||[]).includes(u.id));
    const isOwner=a.origen?.id===user.id;
    return(
      <div style={{minHeight:"100vh",background:BG}}>
        <NavBar left={<><BackBtn onClick={()=>setSelectedAviso(null)}/><div>
            <div style={{fontWeight:700,fontSize:15,color:T1}}>Detalle de aviso</div>
          </div></>}
          center={null}
          right={<Av u={user} size={36}/>}
        />
        <div style={{maxWidth:680,margin:"0 auto",padding:"24px"}}>
          <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
            <button onClick={()=>setSelectedAviso(null)}
              style={{background:"none",border:`1px solid ${BD}`,borderRadius:8,padding:"8px 14px",cursor:"pointer",fontSize:12,fontWeight:600,color:T2,display:"flex",alignItems:"center",gap:6,fontFamily:"inherit"}}>
              ← Volver
            </button>
            {isOwner&&!editingAviso&&(
              <>
                <button onClick={startEdit}
                  style={{background:"none",border:`1px solid ${BD}`,borderRadius:8,padding:"8px 14px",cursor:"pointer",fontSize:12,fontWeight:600,color:PR,display:"flex",alignItems:"center",gap:6,fontFamily:"inherit"}}>
                  ✏️ Editar
                </button>
                <button onClick={()=>setShowDeleteConfirm(true)}
                  style={{background:"none",border:`1px solid ${BD}`,borderRadius:8,padding:"8px 14px",cursor:"pointer",fontSize:12,fontWeight:600,color:"#DC2626",display:"flex",alignItems:"center",gap:6,fontFamily:"inherit"}}>
                  🗑️ Borrar
                </button>
              </>
            )}
          </div>
          {showDeleteConfirm&&<DeleteAvisoModal onConfirm={handleDeleteAviso} onCancel={()=>setShowDeleteConfirm(false)}/>}
          {editingAviso?(
          <Card sx={{padding:24}}>
            <div style={{marginBottom:20}}>
              <h2 style={{fontSize:16,fontWeight:700,color:T1,marginBottom:4}}>Editar aviso</h2>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <div>
                <Lbl ch="DESTINATARIO(S) *"/>
                <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                  <button onClick={()=>toggleEditDest("todos")}
                    style={{background:editDestIds.includes("todos")?"#F59E0B18":CARD,color:editDestIds.includes("todos")?"#B45309":T2,border:`1.5px solid ${editDestIds.includes("todos")?"#F59E0B":BD}`,padding:"7px 14px",borderRadius:20,cursor:"pointer",fontSize:12,fontWeight:editDestIds.includes("todos")?700:400,display:"flex",alignItems:"center",gap:6,transition:"all .12s"}}>
                    {editDestIds.includes("todos")&&<span style={{background:"#F59E0B",color:"#fff",borderRadius:"50%",width:16,height:16,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11}}>✓</span>}
                    📢 A todos
                  </button>
                  {USERS.filter(u=>u.id!==a.origen?.id).map(u=>{const sel=editDestIds.includes(u.id);return(
                    <button key={u.id} onClick={()=>toggleEditDest(u.id)}
                      style={{background:sel?u.uc+"18":CARD,color:sel?u.uc:T2,border:`1.5px solid ${sel?u.uc:BD}`,padding:"7px 12px",borderRadius:20,cursor:"pointer",fontSize:12,fontWeight:sel?700:400,display:"flex",alignItems:"center",gap:6,transition:"all .12s"}}>
                      {sel&&<span style={{background:u.uc,color:"#fff",borderRadius:"50%",width:16,height:16,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11}}>✓</span>}
                      <span>{shortName(u.name)}</span>
                    </button>
                  );})}
                </div>
              </div>
              <div>
                <Lbl ch="MENSAJE DEL AVISO *"/>
                <textarea value={editTexto} onChange={e=>setEditTexto(e.target.value)} rows={4}
                  placeholder="Escribe tu aviso aquí..." style={{...inp,borderRadius:10,lineHeight:1.7}}/>
              </div>
              <div>
                <Lbl ch="ARCHIVOS ADJUNTOS"/>
                {editAttachments.length>0&&(
                  <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:8}}>
                    {editAttachments.map((att,ai)=>(
                      <div key={ai} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,background:BG,borderRadius:6,padding:"6px 10px"}}>
                        <div style={{minWidth:0,flex:1}}>
                          <div style={{fontSize:12,color:T1,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{att.nombre}</div>
                        </div>
                        <button onClick={()=>handleRemoveEditAttachment(ai)}
                          style={{background:"none",border:`1px solid ${BD}`,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:600,color:"#DC2626",flexShrink:0,fontFamily:"inherit"}}>
                          ✕ Quitar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <label style={{display:"inline-flex",alignItems:"center",gap:6,background:BG,border:`1px dashed ${BD}`,borderRadius:6,padding:"6px 12px",cursor:editUploadingAttach?"default":"pointer",fontSize:12,fontWeight:600,color:T2}}>
                  {editUploadingAttach?"Subiendo...":"+ Adjuntar archivo"}
                  <input type="file" multiple disabled={editUploadingAttach} style={{display:"none"}}
                    onChange={e=>{const files=Array.from(e.target.files||[]);handleEditAttachFiles(files);e.target.value="";}}/>
                </label>
                {editAttachErr&&<div style={{fontSize:11,color:"#DC2626",marginTop:4}}>{editAttachErr}</div>}
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={cancelEdit}
                  style={{flex:1,background:BG,border:`1px solid ${BD}`,color:T2,padding:"11px",borderRadius:8,fontSize:13,cursor:"pointer",fontWeight:600,fontFamily:"inherit"}}>
                  Cancelar
                </button>
                <button onClick={saveEdit} disabled={!canSaveEdit}
                  style={{flex:1,background:canSaveEdit?PR:"#E2E8F0",color:canSaveEdit?"#fff":T3,border:"none",padding:"11px",fontSize:13,fontWeight:700,cursor:canSaveEdit?"pointer":"not-allowed",borderRadius:8,fontFamily:"inherit"}}>
                  Guardar cambios
                </button>
              </div>
            </div>
          </Card>
          ):(
          <Card sx={{padding:24}}>
            <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:20}}>
              <div style={{width:44,height:44,borderRadius:"50%",background:"#F59E0B",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:20}}>📢</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:15,fontWeight:700,color:T1}}>{a.origen?.name}</div>
                <div style={{fontSize:12,color:T2}}>{a.origen?.dept}</div>
              </div>
              <span style={{fontSize:11,color:T3,whiteSpace:"nowrap"}}>{fmtFecha(a.fecha)}</span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <div>
                <Lbl ch="DESTINATARIO"/>
                <div style={{fontSize:13,color:T1,fontWeight:500}}>{isTodos?"📢 Todos":a.destinatarioLabel||"—"}</div>
              </div>
              <div>
                <Lbl ch="MENSAJE"/>
                <p style={{fontSize:14,color:T1,lineHeight:1.7,whiteSpace:"pre-wrap",margin:0,background:BG,borderRadius:10,padding:"12px 14px"}}>{a.texto}</p>
              </div>
              <div>
                <Lbl ch="ESTADO DE LECTURA"/>
                <div>
                  <div style={{fontSize:13,color:T2,marginBottom:8}}>Leído por {readUsers.length} de {recipientUsers.length} destinatario(s)</div>
                  {readUsers.length>0&&(
                    <div style={{marginBottom:unreadUsers.length>0?10:0}}>
                      <div style={{fontSize:11,fontWeight:600,color:T3,letterSpacing:.4,marginBottom:6}}>LEÍDO</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {readUsers.map(u=>(
                          <Badge key={u.id} ch={`✓ ${shortName(u.name)}`} c={u.uc} bg={u.uc+"18"}/>
                        ))}
                      </div>
                    </div>
                  )}
                  {unreadUsers.length>0&&(
                    <div>
                      <div style={{fontSize:11,fontWeight:600,color:T3,letterSpacing:.4,marginBottom:6}}>SIN LEER</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {unreadUsers.map(u=>(
                          <Badge key={u.id} ch={`👁️‍🗨️ ${shortName(u.name)}`} c={T3} bg="#F1F5F9"/>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {(a.attachments||[]).length>0&&(
                <div>
                  <Lbl ch="ARCHIVOS ADJUNTOS"/>
                  <div style={{display:"flex",flexDirection:"column",gap:4}}>
                    {a.attachments.map((att,ai)=>(
                      <div key={ai} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,background:BG,borderRadius:6,padding:"8px 12px"}}>
                        <div style={{minWidth:0,flex:1}}>
                          <div style={{fontSize:12,color:T1,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{att.nombre}</div>
                          <div style={{fontSize:10,color:T3}}>{att.subidoPor?.name||"—"} · {fmtDT(att.fecha)}</div>
                        </div>
                        <button onClick={()=>handleDownloadAttachment(att)}
                          style={{background:"none",border:`1px solid ${BD}`,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:600,color:PR,flexShrink:0,fontFamily:"inherit"}}>
                          ⬇ Descargar
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <Lbl ch="COMENTARIOS"/>
                <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:10}}>
                  {(a.comments||[]).length===0&&(
                    <div style={{fontSize:12,color:T3,fontStyle:"italic"}}>Sin comentarios aún.</div>
                  )}
                  {(a.comments||[]).map((c,ci)=>{
                    const isMine=c.id&&c.authorId===user.id;
                    const isEditingThis=c.id&&editingCommentId===c.id;
                    return(
                    <div key={c.id||ci} style={{background:BG,borderRadius:8,padding:"10px 12px",border:`1px solid ${BD}`}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:4}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:12,fontWeight:700,color:T1}}>{c.authorName}</span>
                          <span style={{fontSize:10,color:T3}}>{fmtFecha(c.iso)}{c.edited&&" (editado)"}</span>
                        </div>
                        {isMine&&!isEditingThis&&(
                          <div style={{display:"flex",gap:8,flexShrink:0}}>
                            <button onClick={()=>{setEditingCommentId(c.id);setEditCommentText(c.text);}} title="Editar"
                              style={{background:"none",border:"none",color:T3,cursor:"pointer",fontSize:12,padding:0}}>✏️</button>
                            <button onClick={()=>deleteAvisoComment(c.id)} title="Borrar"
                              style={{background:"none",border:"none",color:T3,cursor:"pointer",fontSize:12,padding:0}}>🗑️</button>
                          </div>
                        )}
                      </div>
                      {isEditingThis?(
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          <textarea value={editCommentText} onChange={e=>setEditCommentText(e.target.value)} rows={2} autoFocus
                            style={{flex:1,borderRadius:6,border:`1px solid ${BD}`,padding:"8px 10px",fontSize:13,color:T1,background:CARD,resize:"vertical",fontFamily:"inherit",outline:"none"}}/>
                          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                            <button onClick={()=>{setEditingCommentId(null);setEditCommentText("");}} style={{background:"none",border:`1px solid ${BD}`,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:600,color:T2}}>Cancelar</button>
                            <button onClick={()=>{editAvisoComment(c.id,editCommentText);setEditingCommentId(null);setEditCommentText("");}} disabled={!editCommentText.trim()}
                              style={{background:editCommentText.trim()?PR:"#E2E8F0",color:editCommentText.trim()?"#fff":T3,border:"none",borderRadius:6,padding:"4px 12px",cursor:editCommentText.trim()?"pointer":"default",fontSize:11,fontWeight:600}}>Guardar</button>
                          </div>
                        </div>
                      ):(
                        <p style={{margin:0,fontSize:13,color:T1,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{c.text}</p>
                      )}
                    </div>
                    );
                  })}
                </div>
                <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
                  <textarea
                    value={commentText}
                    onChange={e=>setCommentText(e.target.value)}
                    placeholder="Escribe un comentario..."
                    rows={2}
                    style={{flex:1,borderRadius:8,border:`1px solid ${BD}`,padding:"8px 12px",fontSize:13,color:T1,background:BG,resize:"vertical",fontFamily:"inherit",outline:"none"}}
                    onKeyDown={e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();postAvisoComment();}}}
                  />
                  <button
                    onClick={postAvisoComment}
                    disabled={!commentText.trim()}
                    style={{background:commentText.trim()?PR:"#ccc",color:"#fff",border:"none",borderRadius:8,padding:"8px 14px",cursor:commentText.trim()?"pointer":"default",fontSize:13,fontWeight:600,fontFamily:"inherit",flexShrink:0,alignSelf:"flex-end"}}>
                    Enviar
                  </button>
                </div>
                <div style={{fontSize:10,color:T3,marginTop:4}}>Ctrl+Enter para enviar</div>
              </div>
            </div>
          </Card>
          )}
        </div>
      </div>
    );
  }

  return(
    <div ref={scrollRef} style={{minHeight:"100vh",background:BG,overflowY:"auto"}}>
      <NavBar left={<><BackBtn onClick={onBack}/><div>
          <div style={{fontWeight:700,fontSize:15,color:T1}}>Avisos</div>
          <div style={{fontSize:11,color:T2}}>{unread.length>0?`${unread.length} sin leer`:"Al día"}</div>
        </div></>}
        center={null}
        right={<Av u={user} size={36}/>}
      />
      <div className="snav" style={{background:CARD,borderBottom:`1px solid ${BD}`,padding:"0 16px",display:"flex",alignItems:"center",gap:6,height:44}}>
        {[["inbox","📥 Recibidos"],["send","📢 Nuevo aviso"],["sent","📤 Enviados"]].map(([v,l])=>(
          <button key={v} className={`nb${tab===v?" active":""}`} onClick={()=>setTab(v)} style={{fontSize:11,whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:4}}>
            {l}
            {v==="inbox"&&unread.length>0&&<span style={{background:"#DC2626",color:"#fff",borderRadius:20,fontSize:9,fontWeight:700,padding:"1px 6px",lineHeight:"14px"}}>{unread.length}</span>}
          </button>
        ))}
      </div>

      <div style={{maxWidth:680,margin:"0 auto",padding:"24px"}}>
        {tab==="send"&&(
          <Card sx={{padding:24}}>
            <div style={{marginBottom:20}}>
              <h2 style={{fontSize:16,fontWeight:700,color:T1,marginBottom:4}}>Nuevo aviso</h2>
              <div style={{fontSize:12,color:T2}}>Se enviará como notificación a los destinatarios</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <div>
                <Lbl ch="ORIGEN (automático)"/>
                <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:BG,borderRadius:10,border:`1px solid ${BD}`}}>
                  <Av u={user} size={28}/>
                  <div>
                    <div style={{fontSize:13,fontWeight:600,color:T1}}>{user.name}</div>
                    <div style={{fontSize:11,color:T2}}>{user.dept}</div>
                  </div>
                </div>
              </div>
              <div>
                <Lbl ch="DESTINATARIOS *"/>
                <div style={{fontSize:11,color:T3,marginBottom:8}}>Selecciona uno o varios destinatarios.</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                  {/* Opción "A todos" */}
                  {(()=>{const sel=dests.includes("todos");return(
                    <button onClick={()=>toggleDest("todos")}
                      style={{background:sel?"#F59E0B18":CARD,color:sel?"#B45309":T2,border:`1.5px solid ${sel?"#F59E0B":BD}`,padding:"7px 14px",borderRadius:20,cursor:"pointer",fontSize:12,fontWeight:sel?700:400,display:"flex",alignItems:"center",gap:6,transition:"all .12s"}}>
                      {sel&&<span style={{background:"#F59E0B",color:"#fff",borderRadius:"50%",width:16,height:16,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11}}>✓</span>}
                      📢 A todos
                    </button>
                  );})()}
                  {/* Usuarios individuales */}
                  {USERS.filter(u=>u.id!==user.id).map(u=>{const sel=dests.includes(u.id);return(
                    <button key={u.id} onClick={()=>toggleDest(u.id)}
                      style={{background:sel?u.uc+"18":CARD,color:sel?u.uc:T2,border:`1.5px solid ${sel?u.uc:BD}`,padding:"7px 12px",borderRadius:20,cursor:"pointer",fontSize:12,fontWeight:sel?700:400,display:"flex",alignItems:"center",gap:6,transition:"all .12s",opacity:dests.includes("todos")?.45:1}}>
                      {sel&&<span style={{background:u.uc,color:"#fff",borderRadius:"50%",width:16,height:16,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11}}>✓</span>}
                      <span>{shortName(u.name)}</span>
                    </button>
                  );})}
                </div>
                {dests.length>0&&!dests.includes("todos")&&(
                  <div style={{marginTop:8,fontSize:11,color:T2}}>{dests.length} destinatario{dests.length!==1?"s":""} seleccionado{dests.length!==1?"s":""}</div>
                )}
              </div>
              <div>
                <Lbl ch="MENSAJE DEL AVISO *"/>
                <textarea value={texto} onChange={e=>setTexto(e.target.value)} rows={4}
                  placeholder="Escribe tu aviso aquí..." style={{...inp,borderRadius:10,lineHeight:1.7}}/>
              </div>
              <div>
                <Lbl ch="ARCHIVOS ADJUNTOS"/>
                {draftAttachments.length>0&&(
                  <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:8}}>
                    {draftAttachments.map((att,ai)=>(
                      <div key={ai} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,background:BG,borderRadius:6,padding:"6px 10px"}}>
                        <div style={{minWidth:0,flex:1}}>
                          <div style={{fontSize:12,color:T1,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{att.nombre}</div>
                        </div>
                        <button onClick={()=>handleRemoveDraftAttachment(ai)}
                          style={{background:"none",border:`1px solid ${BD}`,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:600,color:"#DC2626",flexShrink:0,fontFamily:"inherit"}}>
                          ✕ Quitar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <label style={{display:"inline-flex",alignItems:"center",gap:6,background:BG,border:`1px dashed ${BD}`,borderRadius:6,padding:"6px 12px",cursor:uploadingAttach?"default":"pointer",fontSize:12,fontWeight:600,color:T2}}>
                  {uploadingAttach?"Subiendo...":"+ Adjuntar archivo"}
                  <input type="file" multiple disabled={uploadingAttach} style={{display:"none"}}
                    onChange={e=>{const files=Array.from(e.target.files||[]);handleAttachFiles(files);e.target.value="";}}/>
                </label>
                {attachErr&&<div style={{fontSize:11,color:"#DC2626",marginTop:4}}>{attachErr}</div>}
              </div>
              <button onClick={send} disabled={!canSendAviso}
                style={{background:canSendAviso?PR:"#E2E8F0",color:canSendAviso?"#fff":T3,border:"none",padding:"13px",fontSize:13,fontWeight:700,cursor:canSendAviso?"pointer":"not-allowed",borderRadius:10,transition:"background .12s"}}>
                📢 Enviar aviso{dests.length>1&&!dests.includes("todos")?` (${dests.length})`:""}
              </button>
            </div>
          </Card>
        )}
        {tab==="inbox"&&(
          <>
            {myAvisos.length===0&&<div style={{textAlign:"center",padding:"60px 0",color:T3,fontSize:14}}>Sin avisos recibidos</div>}
            {myAvisos.map(a=>{
              const leido=(a.leidoPor||[]).includes(user.id);
              return(
                <Card key={a.id} cls="rw" onClick={()=>setSelectedAviso(a)} sx={{padding:16,marginBottom:10,borderLeft:`3px solid ${leido?"#E2E8F0":"#F59E0B"}`,background:leido?CARD:"#FFFDF0"}}>
                  <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                    <div style={{width:32,height:32,borderRadius:"50%",background:"#F59E0B",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:15}}>📢</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,flexWrap:"wrap",gap:4}}>
                        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                          {!leido&&<div style={{width:7,height:7,borderRadius:"50%",background:"#F59E0B",flexShrink:0}}/>}
                          <span style={{fontSize:12,fontWeight:700,color:T1}}>{a.origen?.name}</span>
                          <span style={{fontSize:11,color:T3}}>({a.origen?.dept})</span>
                          {avisoRecipients(a)!=="todos"&&<span style={{fontSize:11,color:T3}}>→ ti</span>}
                        </div>
                        <span style={{fontSize:10,color:T3,whiteSpace:"nowrap"}}>{fmtFecha(a.fecha)}</span>
                      </div>
                      <p style={{fontSize:13,color:T1,lineHeight:1.6,margin:0,fontWeight:leido?400:500}}>{a.texto}</p>
                      {(a.attachments||[]).length>0&&(
                        <div style={{marginTop:4,fontSize:11,color:T3}}>📎 {a.attachments.length} archivo{a.attachments.length!==1?"s":""}</div>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </>
        )}
        {tab==="sent"&&(
          <>
            {sentAvisos.length===0&&<div style={{textAlign:"center",padding:"60px 0",color:T3,fontSize:14}}>Sin avisos enviados</div>}
            {sentAvisos.map(a=>(
              <Card key={a.id} cls="rw" onClick={()=>setSelectedAviso(a)} sx={{padding:16,marginBottom:10,borderLeft:`3px solid ${PR}`}}>
                <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                  <div style={{width:32,height:32,borderRadius:"50%",background:PRl,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:15}}>📤</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,flexWrap:"wrap",gap:4}}>
                      <span style={{fontSize:12,fontWeight:700,color:T1}}>→ {a.destinatarioLabel||"Todos"}</span>
                      <span style={{fontSize:10,color:T3,whiteSpace:"nowrap"}}>{fmtFecha(a.fecha)}</span>
                    </div>
                    <p style={{fontSize:13,color:T2,lineHeight:1.6,margin:0}}>{a.texto}</p>
                    <div style={{marginTop:5,fontSize:10,color:T3}}>
                      {(()=>{
                        const destIds=avisoRecipients(a);
                        const isTodos=destIds==="todos";
                        const total=isTodos?USERS.length-1:(Array.isArray(destIds)?destIds.length:1);
                        return isTodos||total>1
                          ?`Leído por ${Math.max(0,(a.leidoPor||[]).length-1)} de ${total} usuario(s)`
                          :`${(a.leidoPor||[]).filter(id=>id!==user.id).length>0?"✓ Leído":"⏳ Sin leer aún"}`;
                      })()}
                    </div>
                    {(a.attachments||[]).length>0&&(
                      <div style={{marginTop:2,fontSize:10,color:T3}}>📎 {a.attachments.length} archivo{a.attachments.length!==1?"s":""}</div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   SCREEN: RETRASOS EJECUTIVO
════════════════════════════════════════ */
function ScreenDelays({tasks,user,onBack,onTaskClick}){
  const delayed=useMemo(()=>tasks.filter(t=>isOver(t.deadline,t.status)||t.status==="Bloqueada"),[tasks]);

  const byDept=useMemo(()=>{
    const map={};
    DEPTS.filter((d,i,a)=>a.indexOf(d)===i).forEach(d=>{map[d]=[];});
    delayed.forEach(t=>{const d=t.responsible?.dept;if(d&&map[d])map[d].push(t);});
    return Object.entries(map).filter(([,ts])=>ts.length>0);
  },[delayed]);

  const daysLate=t=>{
    const dt=new Date(t.deadline+"T12:00:00"),now=new Date(); now.setHours(0,0,0,0);
    return Math.max(0,Math.round((now-dt)/86400000));
  };

  return(
    <div style={{minHeight:"100vh",background:BG}}>
      <NavBar left={<><BackBtn onClick={onBack}/><div>
          <div style={{fontWeight:700,fontSize:15,color:T1}}>Retrasos — Resumen Ejecutivo</div>
          <div style={{fontSize:11,color:T2}}>{delayed.length} tarea{delayed.length!==1?"s":""} con retraso o bloqueo</div>
        </div></>}
        center={null} right={null}
      />
      <div style={{maxWidth:1000,margin:"0 auto",padding:"24px"}}>
        {delayed.length===0&&(
          <div style={{textAlign:"center",padding:"60px 0",color:T3,fontSize:14}}>Sin tareas vencidas o bloqueadas</div>
        )}
        {byDept.map(([dept,ts])=>(
          <div key={dept} style={{marginBottom:28}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,paddingBottom:8,borderBottom:`2px solid ${dc(dept)}22`}}>
              <div style={{width:12,height:12,borderRadius:"50%",background:dc(dept)}}/>
              <span style={{fontWeight:700,fontSize:14,color:T1}}>{dept}</span>
              <span style={{fontSize:12,color:T3,marginLeft:2}}>— {ts.length} tarea{ts.length!==1?"s":""}</span>
            </div>
            {ts.map(t=>{
              const blocked=t.status==="Bloqueada";
              const late=blocked?0:daysLate(t);
              return(
                <Card key={t.id} cls="rw" sx={{padding:"13px 16px",marginBottom:8,borderLeft:`4px solid ${blocked?"#DC2626":"#D97706"}`}} onClick={()=>onTaskClick(t)}>
                  <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",gap:6,marginBottom:5,flexWrap:"wrap",alignItems:"center"}}>
                        <span style={{fontSize:10,color:T3}}>{t.id}</span>
                        {blocked
                          ?<Badge ch="🔒 Bloqueada"          c="#DC2626" bg="#FEF2F2"/>
                          :<Badge ch={`⚠ ${late}d vencida`}  c="#D97706" bg="#FFFBEB"/>
                        }
                        <Badge ch={t.priority} c={PC[t.priority].c} bg={PC[t.priority].bg}/>
                      </div>
                      <div style={{fontSize:13,fontWeight:600,color:T1,marginBottom:blocked&&t.blockReason?5:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div>
                      {blocked&&t.blockReason&&(
                        <div style={{fontSize:11,color:"#991B1B",background:"#FEF2F2",borderRadius:6,padding:"4px 9px",marginTop:4,display:"inline-block"}}>🔒 {t.blockReason}</div>
                      )}
                      {!blocked&&(
                        <div style={{fontSize:11,color:"#92400E",marginTop:3}}>Venció: {new Date(t.deadline+"T12:00:00").toLocaleDateString("es-MX",{day:"numeric",month:"short",year:"numeric"})}</div>
                      )}
                    </div>
                    {t.responsible&&(
                      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,flexShrink:0}}>
                        <Av u={t.responsible} size={30}/>
                        <span style={{fontSize:10,color:T2,textAlign:"center",maxWidth:70,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.responsible.name}</span>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   SCREEN: STUCK TASKS
════════════════════════════════════════ */
function ScreenStuckTasks({tasks,user,onBack,onTaskClick}){
  const scrollRef=useScrollRestore("stuckTasks");
  const stuckItems=useMemo(()=>{
    const result=[];
    tasks.forEach(t=>{
      if(t.status==="Completada"||t.status==="Cancelada") return;
      const invIds=t.invIds||[];
      const flowStates=t.flowStates||{};
      const sids=getStageIds(invIds,t.flowStageIds);
      for(let i=0;i<invIds.length;i++){
        const st=flowStates[sids[i]]||"Pendiente";
        if(st!=="Pendiente") continue;
        const isFirst=i===0;
        const prevDone=i>0&&(flowStates[sids[i-1]]||"Pendiente")==="Completado";
        if(isFirst||prevDone){
          result.push({task:t,nodeIndex:i,stuckUser:USERS.find(u=>u.id===invIds[i])||null});
          break;
        }
      }
    });
    return result;
  },[tasks]);

  const byDept=useMemo(()=>{
    const map={};
    DEPTS.forEach(d=>{map[d]=[];});
    stuckItems.forEach(item=>{
      const d=item.stuckUser?.dept||item.task.responsible?.dept;
      if(d&&map[d]) map[d].push(item);
    });
    return Object.entries(map).filter(([,ts])=>ts.length>0);
  },[stuckItems]);

  const daysActive=t=>{
    if(!t.createdAt) return null;
    return Math.max(0,Math.round((new Date()-new Date(t.createdAt))/86400000));
  };

  return(
    <div ref={scrollRef} style={{minHeight:"100vh",background:BG,overflowY:"auto"}}>
      <NavBar left={<><BackBtn onClick={onBack}/><div>
          <div style={{fontWeight:700,fontSize:15,color:T1}}>Tareas estancadas</div>
          <div style={{fontSize:11,color:T2}}>{stuckItems.length} tarea{stuckItems.length!==1?"s":""} sin avance</div>
        </div></>}
        center={null} right={null}
      />
      <div style={{maxWidth:1000,margin:"0 auto",padding:"24px"}}>
        {stuckItems.length===0&&(
          <div style={{textAlign:"center",padding:"60px 0",color:T3,fontSize:14}}>Sin tareas estancadas — todo en movimiento</div>
        )}
        {byDept.map(([dept,items])=>(
          <div key={dept} style={{marginBottom:28}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,paddingBottom:8,borderBottom:`2px solid ${dc(dept)}22`}}>
              <div style={{width:12,height:12,borderRadius:"50%",background:dc(dept)}}/>
              <span style={{fontWeight:700,fontSize:14,color:T1}}>{dept}</span>
              <span style={{fontSize:12,color:T3,marginLeft:2}}>— {items.length} tarea{items.length!==1?"s":""}</span>
            </div>
            {items.map(({task:t,nodeIndex,stuckUser})=>{
              const days=daysActive(t);
              return(
                <Card key={t.id} cls="rw" sx={{padding:"13px 16px",marginBottom:8,borderLeft:`4px solid #6B7280`}} onClick={()=>onTaskClick(t)}>
                  <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",gap:6,marginBottom:5,flexWrap:"wrap",alignItems:"center"}}>
                        <span style={{fontSize:10,color:T3}}>{t.id}</span>
                        <Badge ch="○ Sin iniciar etapa" c="#6B7280" bg="#F3F4F6"/>
                        <Badge ch={t.priority} c={PC[t.priority].c} bg={PC[t.priority].bg}/>
                        {days!==null&&<Badge ch={`${days}d activa`} c="#6B7280" bg="#F3F4F6"/>}
                      </div>
                      <div style={{fontSize:13,fontWeight:600,color:T1,marginBottom:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div>
                      <div style={{fontSize:11,color:T2}}>
                        Espera acción de: <span style={{fontWeight:600,color:T1}}>{stuckUser?.name||"—"}</span>
                        {stuckUser?.dept&&<span style={{color:T3}}> · {stuckUser.dept}</span>}
                        <span style={{color:T3}}> (etapa {nodeIndex+1} de {(t.invIds||[]).length})</span>
                      </div>
                    </div>
                    {stuckUser&&(
                      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,flexShrink:0}}>
                        <Av u={stuckUser} size={30}/>
                        <span style={{fontSize:10,color:T2,textAlign:"center",maxWidth:70,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{stuckUser.name}</span>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   SCREEN: DELETED TASKS
════════════════════════════════════════ */
function ScreenDeletedTasks({deletedTasks,user,onBack}){
  const isMobile=useIsMobile();
  const canView=user?.dept==="Dirección"||user?.dept==="Ingenieria";
  if(!canView) return null;

  const fmtFecha=d=>{
    if(!d) return "—";
    const dt=new Date(d);
    return dt.toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})+" "+dt.toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"});
  };

  return(
    <div style={{minHeight:"100vh",background:BG}}>
      <NavBar left={<><BackBtn onClick={onBack}/><div>
          <div style={{fontWeight:700,fontSize:15,color:T1}}>Registro de Eliminaciones</div>
          <div style={{fontSize:11,color:T2}}>{deletedTasks.length} tarea{deletedTasks.length!==1?"s":""} eliminada{deletedTasks.length!==1?"s":""}</div>
        </div></>}
        center={null}
        right={null}
      />
      <div style={{maxWidth:1000,margin:"0 auto",padding:"24px"}}>
        {deletedTasks.length===0&&(
          <div style={{textAlign:"center",padding:"60px 0",color:T3,fontSize:14}}>Sin tareas eliminadas registradas</div>
        )}
        {deletedTasks.length>0&&(
          <Card sx={{overflow:"hidden"}}>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 80px 140px 140px 130px",background:BG,padding:"10px 18px",borderBottom:`1px solid ${BD}`,gap:12}}>
              {["TÍTULO","ID","ELIMINADA POR","DEPTO. RESPONSABLE","FECHA ELIMINACIÓN"].map(h=>(
                <div key={h} style={{fontSize:10,fontWeight:700,color:T3,letterSpacing:.5}}>{h}</div>
              ))}
            </div>
            {deletedTasks.map((t,i)=>(
              <div key={t.id||i} style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 80px 140px 140px 130px",padding:"14px 18px",borderBottom:i<deletedTasks.length-1?`1px solid ${BD}`:"none",gap:12,alignItems:"center",background:i%2===0?CARD:"#FAFBFF"}}>
                <div style={{fontSize:13,fontWeight:600,color:T1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title||"Sin título"}</div>
                <div style={{fontSize:11,color:T3,fontWeight:500}}>{t.id||"—"}</div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <Av u={t.deletedBy} size={22}/>
                  <span style={{fontSize:12,color:T2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.deletedBy?.name||"—"}</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:dc(t.responsible?.dept||"Dirección"),flexShrink:0}}/>
                  <span style={{fontSize:12,color:T2}}>{t.responsible?.dept||"—"}</span>
                </div>
                <div style={{fontSize:11,color:"#DC2626",fontWeight:500}}>🗑️ {fmtFecha(t.deletedAt)}</div>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   SCREEN: NOTIFICACIONES
════════════════════════════════════════ */
function ScreenNotificaciones({tasks,avisos,quickTasks,user,onBack,onTaskClick,onAvisoClick,onQuickTaskClick,lastNotifView}){
  const scrollRef=useScrollRestore("notificaciones");
  const isMobile=useIsMobile();

  const items=useMemo(()=>{
    const list=[];
    const fmtT=d=>{
      if(!d) return "";
      return new Date(d).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})+" "+new Date(d).toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"});
    };

    // Tareas asignadas donde el usuario es responsable o involucrado
    tasks.forEach(t=>{
      const isResp=t.responsible?.id===user.id;
      const isInv=(t.invIds||[]).includes(user.id);
      const isCreator=t.creator?.id===user.id;
      if((isResp||isInv)&&!isCreator){
        list.push({
          type:"asignada",icon:"📋",
          title:`Fuiste asignado a: ${t.title}`,
          body:`Responsable: ${t.responsible?.name||"—"} · ${t.type}`,
          date:t.createdAt?(t.createdAt.includes("T")?t.createdAt:t.createdAt+"T12:00:00"):null,
          task:t,
          color:"#4338CA",bg:"#EEF2FF",
        });
      }
      // Completadas con notifyOnComplete
      if(t.status==="Completada"&&(t.notifyOnComplete||[]).includes(user.id)){
        list.push({
          type:"completada",icon:"✅",
          title:`Tarea completada: ${t.title}`,
          body:`Completada por ${t.responsible?.name||"—"}`,
          date:(t.completedAt||t.createdAt)??null,
          task:t,
          color:"#059669",bg:"#ECFDF5",
        });
      }
    });

    // Avisos recibidos
    avisos.forEach(a=>{
      if(avisoIncludesUser(a,user.id)){
        const leido=(a.leidoPor||[]).includes(user.id);
        list.push({
          type:"aviso",icon:"📢",
          title:`Aviso de ${a.origen?.name||"—"}`,
          body:a.texto,
          date:a.fecha,
          leido,
          aviso:a,
          color:"#D97706",bg:"#FFFBEB",
        });
      }
    });

    // Tareas rápidas creadas donde el usuario sea del depto destinatario, creador, o Dirección
    (quickTasks||[]).forEach(qt=>{
      const isDireccion=user.dept==="Dirección";
      const isDeptUser=qt.dept===user.dept;
      const isCreator=qt.createdBy?.id===user.id;
      if((isDeptUser||isDireccion)&&!isCreator&&!qt.deleted){
        list.push({
          type:"quick_task_created",icon:"⚡",
          title:`Tarea rápida asignada: ${qt.title}`,
          body:`${qt.dept} · ${qt.description||"Sin descripción"}`,
          date:qt.createdAt,
          quickTask:qt,
          color:"#7C3AED",bg:"#F5F3FF",
        });
      }
      // Comentarios en tareas rápidas donde el usuario sea destinatario
      const commentUserIds=(qt.comments||[]).map(cm=>cm.user?.id).filter(Boolean);
      const isQTRecipient=qt.createdBy?.id===user.id||qt.dept===user.dept||user.dept==="Dirección"||commentUserIds.includes(user.id);
      if(isQTRecipient){
        (qt.comments||[]).forEach(c=>{
          if(c.user?.id!==user.id){
            list.push({
              type:"quick_task_comment",icon:"💬",
              title:`Comentario en tarea rápida: ${qt.title}`,
              body:`${c.user?.name||"—"}: ${c.text}`,
              date:c.iso,
              quickTask:qt,
              color:"#7C3AED",bg:"#F5F3FF",
            });
          }
        });
      }
    });

    return list.filter(x=>x.date).sort((a,b)=>new Date(b.date)-new Date(a.date));
  },[tasks,avisos,quickTasks,user]);

  const sinceDate=lastNotifView?new Date(lastNotifView):new Date(0);

  const fmtFecha=d=>new Date(d).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})+" "+new Date(d).toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"});

  return(
    <div ref={scrollRef} style={{minHeight:"100vh",background:BG,overflowY:"auto"}}>
      <NavBar left={<><BackBtn onClick={onBack}/><div>
          <div style={{fontWeight:700,fontSize:15,color:T1}}>Notificaciones</div>
          <div style={{fontSize:11,color:T2}}>{items.length} en total</div>
        </div></>}
        center={null}
        right={<Av u={user} size={36}/>}
      />
      <div style={{maxWidth:760,margin:"0 auto",padding:"24px"}}>
        {items.length===0&&<div style={{textAlign:"center",padding:"60px 0",color:T3,fontSize:14}}>Sin notificaciones aún</div>}
        {items.map((item,i)=>{
          const isNew=new Date(item.date)>sinceDate;
          const bgColor=isNew?"#FFFDF0":CARD;
          return(
          <div key={i} onClick={item.task?()=>onTaskClick(item.task):item.aviso?()=>onAvisoClick(item.aviso):item.quickTask?()=>onQuickTaskClick(item.quickTask):undefined}
            style={{display:"flex",gap:12,alignItems:"flex-start",background:bgColor,border:`1px solid ${BD}`,borderLeft:`3px solid ${item.color}`,borderRadius:12,padding:"14px 16px",marginBottom:10,cursor:(item.task||item.aviso||item.quickTask)?"pointer":"default",transition:"box-shadow .12s"}}
            onMouseEnter={e=>{if(item.task||item.aviso||item.quickTask)e.currentTarget.style.boxShadow=SH;}}
            onMouseLeave={e=>{e.currentTarget.style.boxShadow="none";}}>
            <div style={{width:36,height:36,borderRadius:10,background:item.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{item.icon}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                <span style={{fontSize:13,fontWeight:600,color:T1,overflow:"hidden",textOverflow:"ellipsis"}}>{item.title}</span>
                <span style={{fontSize:10,color:T3,whiteSpace:"nowrap",flexShrink:0}}>{fmtFecha(item.date)}</span>
              </div>
              <p style={{fontSize:12,color:T2,margin:0,lineHeight:1.5,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.body}</p>
              {item.type==="aviso"&&!item.leido&&(
                <span style={{display:"inline-block",marginTop:5,fontSize:10,fontWeight:700,color:"#D97706",background:"#FEF3C7",borderRadius:10,padding:"2px 8px"}}>Sin leer</span>
              )}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   ROOT APP — ALL HOOKS FIRST, ALWAYS
════════════════════════════════════════ */
export default function App(){
  const [user,        setUser]       = useState(()=>{try{return JSON.parse(localStorage.getItem("taskops_user"));}catch{return null;}});
  const [screen,      setScreen]     = useState("dash");
  const [tasks,       setTasks]      = useState([]);
  const [selDept,     setSelDept]    = useState(null);
  const [selTask,     setSelTask]    = useState(null);
  const [selAviso,    setSelAviso]   = useState(null);
  const [fromScr,     setFromScr]    = useState("dash");
  const [filter,      setFilter]     = useState(null);
  const [authedDepts, setAuthedDepts]= useState(()=>{try{return JSON.parse(sessionStorage.getItem("taskops_authed_depts"))||[];}catch{return [];}});
  const [pwdModal,    setPwdModal]   = useState(null);
  const [deptCanAdd,  setDeptCanAdd] = useState(false);
  const [createDept,  setCreateDept] = useState(null);
  const [editingTask,   setEditingTask]  = useState(null);
  const [deleteTask,    setDeleteTask]   = useState(null);
  const [dbReady,       setDbReady]      = useState(false);
  const [dbConnected,   setDbConnected]  = useState(null);
  const [avisos,        setAvisos]       = useState([]);
  const [quickTasks,    setQuickTasks]   = useState([]);
  const [ausencias,     setAusencias]    = useState([]);
  const [deletedTasks,  setDeletedTasks] = useState([]);
  const [saveError,     setSaveError]    = useState(null);
  const [lastNotifView, setLastNotifView]= useState(()=>{
    if(!user) return null;
    return localStorage.getItem(`taskops_last_notif_view_${user.id}`)||null;
  });
  const [showPushBanner, setShowPushBanner]= useState(false);
  const [pushEnabled, setPushEnabled]= useState(()=>localStorage.getItem("taskops_push_enabled")==="true");

  // Estados de conexión Realtime
  const [realtimeStatus,setRealtimeStatus]=useState("connecting");
  const [lastSyncTime,setLastSyncTime]=useState(Date.now());
  const watchdogTimeoutRef=useRef(null);
  const channelsRef=useRef({tasks:null,avisos:null,quickTasks:null,ausencias:null});
  const backgroundTimeRef=useRef(null);

  // Función para recargar datos desde Supabase (resincronización forzada)
  const reloadAllData=useCallback(()=>{
    console.log("[Realtime] Recarga forzada de datos desde Supabase");

    // Recargar tasks
    supabase.from("tasks").select("*").then(({data,error})=>{
      if(error){console.error("[Realtime] Error recargando tasks:",error.message);return;}
      const sorted=[...data].sort((a,b)=>new Date(b.data?.createdAt||0)-new Date(a.data?.createdAt||0));
      const taskData=sorted.map(r=>r.data);
      setTasks(taskData);
      try{localStorage.setItem("nexus_tasks_cache",JSON.stringify(taskData));}catch(e){}
      console.log("[Realtime] Tasks recargadas:",data.length);
    });

    // Recargar avisos
    supabase.from("avisos").select("*").then(({data,error})=>{
      if(error){console.error("[Realtime] Error recargando avisos:",error.message);return;}
      setAvisos([...data].sort((a,b)=>new Date(b.data?.fecha||0)-new Date(a.data?.fecha||0)).map(r=>r.data));
      console.log("[Realtime] Avisos recargados:",data.length);
    });

    // Recargar quick_tasks
    supabase.from("quick_tasks").select("*").then(({data,error})=>{
      if(error){console.error("[Realtime] Error recargando quick_tasks:",error.message);return;}
      setQuickTasks([...data].sort((a,b)=>new Date(b.data?.createdAt||0)-new Date(a.data?.createdAt||0)).map(r=>r.data));
      console.log("[Realtime] Quick tasks recargadas:",data.length);
    });
  },[]);

  // Función para actualizar timestamp de sincronización
  const updateSyncTime=useCallback(()=>{
    setLastSyncTime(Date.now());
    setRealtimeStatus("connected");

    // Reset del watchdog: cancelar timeout anterior y crear uno nuevo
    if(watchdogTimeoutRef.current){
      clearTimeout(watchdogTimeoutRef.current);
    }
    watchdogTimeoutRef.current=setTimeout(()=>{
      // Después de 60s sin eventos, verificar el estado de los canales
      const anyChannelJoined=Object.values(channelsRef.current).some(ch=>ch?.state==="joined");
      if(anyChannelJoined){
        // Canal sigue conectado, actualizar timestamp
        setLastSyncTime(Date.now());
        setRealtimeStatus("connected");
      }else{
        // Ningún canal está "joined" — desconectado
        setRealtimeStatus("disconnected");
      }
    },60000); // 60 segundos
  },[]);

  // Listener de visibilitychange para manejar iOS PWA
  useEffect(()=>{
    const handleVisibilityChange=()=>{
      if(document.visibilityState==="hidden"){
        // App entra en background — guardar timestamp
        backgroundTimeRef.current=Date.now();
      }else if(document.visibilityState==="visible"){
        // App vuelve a foreground
        const timeInBackground=backgroundTimeRef.current?(Date.now()-backgroundTimeRef.current):0;
        const anyChannelJoined=Object.values(channelsRef.current).some(ch=>ch?.state==="joined");

        if(timeInBackground>30000){
          // Más de 30 segundos en background — recargar datos forzadamente
          console.log(`[Realtime] Estuvo ${Math.round(timeInBackground/1000)}s en background — recargando datos`);
          reloadAllData();
          updateSyncTime();
        }else if(anyChannelJoined){
          // Menos de 30s en background y canal conectado — solo actualizar timestamp
          updateSyncTime();
        }else{
          // No hay canales conectados — marcar como desconectado
          setRealtimeStatus("disconnected");
          // Los canales deberían reconectar automáticamente (Supabase realtime lo maneja)
        }

        backgroundTimeRef.current=null;
      }
    };
    document.addEventListener("visibilitychange",handleVisibilityChange);
    return ()=>{
      document.removeEventListener("visibilitychange",handleVisibilityChange);
      if(watchdogTimeoutRef.current) clearTimeout(watchdogTimeoutRef.current);
    };
  },[updateSyncTime,reloadAllData]);

  // Mostrar banner de notificaciones push si el usuario no ha decidido aún
  useEffect(()=>{
    if(!user) return;
    const hasDecided=localStorage.getItem("taskops_push_decided");
    const isPushSupported="serviceWorker" in navigator && "PushManager" in window;
    if(!hasDecided && isPushSupported && !pushEnabled){
      // Mostrar el banner después de 3 segundos de que el usuario inicie sesión
      const timer=setTimeout(()=>setShowPushBanner(true),3000);
      return ()=>clearTimeout(timer);
    }
  },[user,pushEnabled]);

  // Persistir authedDepts en sessionStorage: un reload (ej. tras actualizar el
  // Service Worker) no debe forzar a re-meter la contraseña de departamento
  // si ya se autenticó en esta misma sesión del navegador.
  useEffect(()=>{
    try{sessionStorage.setItem("taskops_authed_depts",JSON.stringify(authedDepts));}catch(e){}
  },[authedDepts]);

  // Resync: si la tarea abierta cambia en el array `tasks` (p.ej. llega un
  // cambio de estado o comentario nuevo por Realtime), refleja la versión viva
  // en vez de quedarse con la foto local tomada al abrirlo.
  useEffect(()=>{
    if(!selTask) return;
    const fresh=tasks.find(t=>t.id===selTask.id);
    if(fresh&&fresh!==selTask) setSelTask(fresh);
  },[tasks,selTask]);

  // Supabase avisos: carga + realtime
  useEffect(()=>{
    supabase.from("avisos").select("*")
      .then(({data,error})=>{
        if(error){console.error("[Supabase] Error SELECT avisos:",error.message);return;}
        console.log(`[Supabase] Avisos SELECT ok — ${data.length} avisos`);
        setAvisos([...data].sort((a,b)=>new Date(b.data?.fecha||0)-new Date(a.data?.fecha||0)).map(r=>r.data));
      });
    const ch=supabase.channel("avisos-realtime")
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"avisos"},({new:row})=>{
        updateSyncTime();
        setAvisos(p=>p.some(a=>a.id===row.id)?p:[row.data,...p]);
      })
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"avisos"},({new:row})=>{
        updateSyncTime();
        setAvisos(p=>p.map(a=>a.id===row.id?row.data:a));
      })
      .subscribe(status=>{
        if(status==="SUBSCRIBED") updateSyncTime();
        if(status==="CHANNEL_ERROR"||status==="CLOSED") setRealtimeStatus("disconnected");
      });
    channelsRef.current.avisos=ch;
    return ()=>{
      supabase.removeChannel(ch);
      channelsRef.current.avisos=null;
    };
  },[updateSyncTime]);

  // Supabase quick_tasks: carga + realtime
  useEffect(()=>{
    supabase.from("quick_tasks").select("*")
      .then(({data,error})=>{
        if(error){console.error("[Supabase] Error SELECT quick_tasks:",error.message);return;}
        console.log(`[Supabase] Quick tasks SELECT ok — ${data.length} tareas`);
        setQuickTasks([...data].sort((a,b)=>new Date(b.data?.createdAt||0)-new Date(a.data?.createdAt||0)).map(r=>r.data));
      });
    const ch=supabase.channel("quick-tasks-realtime")
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"quick_tasks"},({new:row})=>{
        console.log("[Supabase] Realtime INSERT quick_task:", row.id);
        updateSyncTime();
        setQuickTasks(p=>p.some(t=>t.id===row.id)?p:[row.data,...p]);
      })
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"quick_tasks"},({new:row})=>{
        console.log("[Supabase] Realtime UPDATE quick_task:", row.id);
        updateSyncTime();
        setQuickTasks(p=>p.map(t=>t.id===row.id?row.data:t));
      })
      .on("postgres_changes",{event:"DELETE",schema:"public",table:"quick_tasks"},({old:row})=>{
        console.log("[Supabase] Realtime DELETE quick_task:", row.id);
        updateSyncTime();
        setQuickTasks(p=>p.filter(t=>t.id!==row.id));
      })
      .subscribe(status=>{
        if(status==="SUBSCRIBED") updateSyncTime();
        if(status==="CHANNEL_ERROR"||status==="CLOSED") setRealtimeStatus("disconnected");
      });
    channelsRef.current.quickTasks=ch;
    return ()=>{
      supabase.removeChannel(ch);
      channelsRef.current.quickTasks=null;
    };
  },[updateSyncTime]);

  // Función para cargar ausencias (±6 meses) - siempre con fechas frescas
  const cargarAusencias=useCallback(()=>{
    const desde=new Date();desde.setMonth(desde.getMonth()-6);
    const hasta=new Date();hasta.setMonth(hasta.getMonth()+6);
    const fechaDesde=fmtISODateLocal(desde);
    const fechaHasta=fmtISODateLocal(hasta);
    console.log(`[cargarAusencias] Cargando rango: ${fechaDesde} → ${fechaHasta}`);
    supabase.rpc("get_ausencias_en_rango",{
      fecha_desde:fechaDesde,
      fecha_hasta:fechaHasta
    }).then(({data,error})=>{
      if(error){console.error("[Supabase] Error get_ausencias_en_rango:",error.message);return;}
      console.log(`[Supabase] Ausencias cargadas — ${data?.length||0} registros - reemplazando estado completo`);
      setAusencias(data||[]); // Reemplazar completo, no hacer merge
    });
  },[]);

  // Supabase ausencias: carga inicial + realtime
  useEffect(()=>{
    cargarAusencias();
    const ch=supabase.channel("ausencias-realtime")
      .on("postgres_changes",{event:"*",schema:"public",table:"ausencias"},()=>{
        console.log("[Supabase] Cambio detectado en tabla ausencias — recargando...");
        updateSyncTime();
        cargarAusencias();
      })
      .subscribe(status=>{
        if(status==="SUBSCRIBED") updateSyncTime();
        if(status==="CHANNEL_ERROR"||status==="CLOSED") setRealtimeStatus("disconnected");
      });
    channelsRef.current.ausencias=ch;
    return ()=>{
      supabase.removeChannel(ch);
      channelsRef.current.ausencias=null;
    };
  },[cargarAusencias,updateSyncTime]);

  // Service Worker: registrar y detectar actualizaciones, sin interrumpir
  // al usuario a media tarea (ej. mientras llena el formulario de crear tarea).
  useEffect(()=>{
    if(!("serviceWorker" in navigator)) return;
    // Registrar SW incondicionalmente (no solo cuando push está habilitado)
    navigator.serviceWorker.register("/sw.js",{scope:"/"})
      .catch(err=>console.warn("[SW] Error al registrar:",err));
    // hadController: true si ya había un SW controlando esta página al cargar
    // Solo recargamos en ACTUALIZACIONES, no en la primera instalación
    const hadController=!!navigator.serviceWorker.controller;
    let reloading=false;
    let pendingUpdate=false;
    const doReload=()=>{
      if(reloading) return;
      reloading=true;
      console.log("[SW] Aplicando actualización — recargando");
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange",()=>{
      if(!hadController||reloading) return;
      pendingUpdate=true;
      // Si nadie está mirando la pestaña, aplicar de inmediato no interrumpe a nadie.
      // Si la app está en uso, esperar a que el usuario la deje en segundo plano
      // o decida actualizar manualmente, en vez de recargarla debajo de sus manos.
      if(document.visibilityState==="hidden") doReload();
      else showUpdateBanner();
    });
    const onVisChange=()=>{
      if(pendingUpdate&&document.visibilityState==="hidden") doReload();
    };
    document.addEventListener("visibilitychange",onVisChange);
    return ()=>document.removeEventListener("visibilitychange",onVisChange);
  },[]);

  // Supabase: carga inicial + suscripción en tiempo real
  useEffect(()=>{
    // Cargar caché inmediatamente para que la UI no quede vacía
    try {
      const cached = localStorage.getItem("nexus_tasks_cache");
      if(cached) {
        const parsed = JSON.parse(cached);
        if(Array.isArray(parsed) && parsed.length > 0) {
          setTasks(parsed);
          console.log("[Cache] Cargadas", parsed.length, "tareas desde localStorage");
        }
      }
    } catch(e) { console.warn("[Cache] Error leyendo caché:", e); }
    // Carga inicial
    supabase.from("tasks").select("*")
      .then(({data,error})=>{
        if(error){
          console.error("[Supabase] Error en SELECT tasks:", error.message, error);
          setDbConnected(false);
          setDbReady(true);
          return;
        }
        console.log(`[Supabase] SELECT ok — ${data.length} tareas cargadas`);
        setDbConnected(true);
        const sorted=[...data].sort((a,b)=>
          new Date(b.data?.createdAt||0)-new Date(a.data?.createdAt||0)
        );
        const taskData = sorted.map(r=>r.data);
        setTasks(taskData);
        try {
          localStorage.setItem("nexus_tasks_cache", JSON.stringify(taskData));
          console.log("[Cache] Caché actualizado con", sorted.length, "tareas");
        } catch(e) { console.warn("[Cache] Error guardando caché:", e); }
        setDbReady(true);
      });
    supabase.from("deleted_tasks").select("*")
      .then(({data,error})=>{
        if(error){console.error("[Supabase] Error SELECT deleted_tasks:",error.message);return;}
        setDeletedTasks(
          [...data]
            .sort((a,b)=>new Date(b.deleted_at)-new Date(a.deleted_at))
            .map(r=>({...r.data,deletedAt:r.deleted_at}))
        );
      });

    // Suscripción en tiempo real
    const channel=supabase.channel("tasks-realtime")
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"tasks"},({new:row})=>{
        console.log("[Supabase] Realtime INSERT:", row.id);
        updateSyncTime();
        setTasks(p => {
          const updated = p.some(t=>t.id===row.id) ? p : [row.data,...p];
          try { localStorage.setItem("nexus_tasks_cache", JSON.stringify(updated)); } catch(e){}
          return updated;
        });
      })
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"tasks"},({new:row})=>{
        console.log("[Supabase] Realtime UPDATE:", row.id);
        updateSyncTime();
        setTasks(p => {
          const updated = p.map(t=>t.id===row.id?row.data:t);
          try { localStorage.setItem("nexus_tasks_cache", JSON.stringify(updated)); } catch(e){}
          return updated;
        });
      })
      .on("postgres_changes",{event:"DELETE",schema:"public",table:"tasks"},({old:row})=>{
        console.log("[Supabase] Realtime DELETE:", row.id);
        updateSyncTime();
        setTasks(p => {
          const updated = p.filter(t=>t.id!==row.id);
          try { localStorage.setItem("nexus_tasks_cache", JSON.stringify(updated)); } catch(e){}
          return updated;
        });
      })
      .subscribe(status=>{
        console.log("[Supabase] Canal realtime:", status);
        if(status==="SUBSCRIBED"){
          setDbConnected(true);
          updateSyncTime();
        }
        if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"||status==="CLOSED"){
          setDbConnected(false);
          setRealtimeStatus("disconnected");
        }
      });

    channelsRef.current.tasks=channel;
    return ()=>{
      supabase.removeChannel(channel);
      channelsRef.current.tasks=null;
    };
  },[updateSyncTime]);

  // Deep-link: abrir tarea desde URL ?task= y opcionalmente ejecutar ?action=
  useEffect(()=>{
    if(!dbReady||!tasks.length) return;
    const params=new URLSearchParams(window.location.search);
    const taskId=params.get("task");
    const action=params.get("action");
    if(!taskId) return;
    const task=tasks.find(t=>t.id===taskId);
    if(!task) return;
    window.history.replaceState({},"",window.location.pathname);
    setSelTask(task);
    setFromScr("dash");
    setScreen("task");
    if(action==="start"&&task.status!=="En proceso"&&task.status!=="Completada"&&task.status!=="Cancelada"){
      updateTask(task.id,{status:"En proceso"});
    }
  },[dbReady,tasks]); // eslint-disable-line

  // Deep-link: abrir aviso desde URL ?aviso=
  useEffect(()=>{
    if(!dbReady||!avisos.length) return;
    const params=new URLSearchParams(window.location.search);
    const avisoId=params.get("aviso");
    if(!avisoId) return;
    const aviso=avisos.find(a=>a.id===avisoId);
    if(!aviso) return;
    window.history.replaceState({},"",window.location.pathname);
    setSelAviso(aviso);
    setScreen("avisos");
  },[dbReady,avisos]); // eslint-disable-line

  // Operaciones CRUD
  const updateTask=(id,patch)=>{
    setTasks(prev=>{
      const task=prev.find(t=>t.id===id);
      if(!task) return prev;
      const updated={...task,...patch};
      supabase.rpc("merge_task_data",{task_id:id,patch})
        .then(({data:merged,error})=>{
          if(error){
            console.error("[Supabase] Error en UPDATE task:",id,error.message,error);
            setTasks(current=>current.map(t=>t.id===id?task:t));
          } else {
            console.log("[Supabase] UPDATE ok:",id);
            if(merged) setTasks(current=>current.map(t=>t.id===id?merged:t));
          }
        });
      // Push: responsable cambiado
      if(patch.responsible?.id&&patch.responsible.id!==task.responsible?.id){
        setTimeout(()=>sendPushNotification([patch.responsible.id],"Eres el responsable",`Te asignaron como responsable de: "${task.title}"`,`/?task=${task.id}`),0);
      }
      // Push: involucrados nuevos agregados
      if(patch.invIds&&user){
        const newInv=patch.invIds.filter(id=>!(task.invIds||[]).includes(id)&&id!==user.id);
        if(newInv.length>0) setTimeout(()=>sendPushNotification(newInv,"Fuiste agregado a una tarea",`"${task.title}"`,`/?task=${task.id}`),0);
      }
      // Push: nodo de flujo marcado Completado → notificar al siguiente involucrado
      if(patch.flowStates){
        const srcIds=patch.invIds||task.invIds||[];
        const srcSids=getStageIds(srcIds,patch.flowStageIds||task.flowStageIds);
        Object.entries(patch.flowStates).forEach(([uid,newSt])=>{
          const prevSt=(task.flowStates||{})[uid]||"Pendiente";
          if(newSt==="Completado"&&prevSt!=="Completado"){
            const posIdx=srcSids.indexOf(uid);
            if(posIdx>=0&&posIdx<srcIds.length-1){
              const nextId=srcIds[posIdx+1];
              const who=USERS.find(u=>u.id===srcIds[posIdx]);
              setTimeout(()=>sendPushNotification([nextId],"Tu turno en el flujo",`${who?.name||"Un colega"} completó su paso en "${task.title}"`,`/?task=${task.id}`),0);
              const nextUser=USERS.find(u=>u.id===nextId);
              const whoUser=who;
              if(nextUser?.email){
                setTimeout(()=>sendEmailNotification("tu_turno",[nextUser.email],{
                  userName:nextUser.name,
                  taskId:task.id,
                  taskTitle:task.title,
                  prevUserName:whoUser?.name||"Un colega",
                }),0);
              }
              if(nextUser?.phone){
                setTimeout(()=>sendWhatsAppNotification("tu_turno",[nextUser.phone],{
                  userName:nextUser.name,
                  taskId:task.id,
                  taskTitle:task.title,
                  prevUserName:whoUser?.name||"Un colega",
                }),0);
                setTimeout(()=>sendSMSNotification("tu_turno",[nextUser.phone],{
                  userName:nextUser.name,
                  taskId:task.id,
                  taskTitle:task.title,
                  prevUserName:whoUser?.name||"Un colega",
                }),0);
              }
            }
          }
          // Notificación 2: notificar al SIGUIENTE cuando el anterior inicia (En proceso)
          if(newSt==="En proceso"&&prevSt!=="En proceso"&&prevSt!=="Completado"){
            const posIdx=srcSids.indexOf(uid);
            if(posIdx>=0&&posIdx<srcIds.length-1){
              const nextId=srcIds[posIdx+1];
              const who=USERS.find(u=>u.id===srcIds[posIdx]);
              setTimeout(()=>sendPushNotification(
                [nextId],
                "Prepárate — tu turno se acerca",
                `${who?.name||"Un colega"} inició su etapa en "${task.title}"`,
                `/?task=${task.id}`
              ),0);
              const nextUser=USERS.find(u=>u.id===nextId);
              const whoUser=USERS.find(u=>u.id===srcIds[posIdx]);
              if(nextUser?.email){
                setTimeout(()=>sendEmailNotification("preparate",[nextUser.email],{
                  userName:nextUser.name,
                  taskId:task.id,
                  taskTitle:task.title,
                  prevUserName:whoUser?.name||"Un colega",
                }),0);
              }
              if(nextUser?.phone){
                setTimeout(()=>sendWhatsAppNotification("preparate",[nextUser.phone],{
                  userName:nextUser.name,
                  taskId:task.id,
                  taskTitle:task.title,
                  prevUserName:whoUser?.name||"Un colega",
                }),0);
                setTimeout(()=>sendSMSNotification("preparate",[nextUser.phone],{
                  userName:nextUser.name,
                  taskId:task.id,
                  taskTitle:task.title,
                  prevUserName:whoUser?.name||"Un colega",
                }),0);
              }
            }
          }
        });
        // Notificación 1: notificar al creador cuando alguien cambia su estado en el flujo
        Object.entries(patch.flowStates).forEach(([uid,newSt])=>{
          const prevSt=(task.flowStates||{})[uid]||"Pendiente";
          if(newSt!==prevSt&&task.creator?.id&&task.creator.id!==user?.id){
            const posIdx=srcSids.indexOf(uid);
            const whoUser=USERS.find(u=>u.id===srcIds[posIdx]);
            if(!whoUser) return;
            setTimeout(()=>sendPushNotification(
              [task.creator.id],
              `Avance en "${task.title}"`,
              `${whoUser.name} cambió su etapa a "${newSt}"`,
              `/?task=${task.id}`
            ),0);
            const creatorUser=USERS.find(u=>u.id===task.creator.id);
            if(creatorUser?.email){
              setTimeout(()=>sendEmailNotification("avance_flujo",[creatorUser.email],{
                userName:creatorUser.name,
                taskId:task.id,
                taskTitle:task.title,
                whoName:whoUser.name,
                whoDept:whoUser.dept,
                newState:newSt,
              }),0);
            }
            if(creatorUser?.phone){
              setTimeout(()=>sendWhatsAppNotification("avance_flujo",[creatorUser.phone],{
                userName:creatorUser.name,
                taskId:task.id,
                taskTitle:task.title,
                whoName:whoUser.name,
                whoDept:whoUser.dept,
                newState:newSt,
              }),0);
              setTimeout(()=>sendSMSNotification("avance_flujo",[creatorUser.phone],{
                userName:creatorUser.name,
                taskId:task.id,
                taskTitle:task.title,
                whoName:whoUser.name,
                whoDept:whoUser.dept,
                newState:newSt,
              }),0);
            }
          }
        });
      }
      // notifyOnComplete: disparar avisos al completar
      if(patch.status==="Completada"&&task.status!=="Completada"&&user){
        const notify=task.notifyOnComplete||[];
        if(notify.length>0){
          const _txt=`La tarea "${task.title}" ha sido completada por ${user.name}.`;
          const _fecha=new Date().toISOString();
          setTimeout(()=>{
            if(notify.includes("todos")){
              sendAviso({id:`AV-${Date.now()}-ntf-todos`,origen:user,destinatarioIds:"todos",destinatarioLabel:"Todos",texto:_txt,fecha:_fecha,leidoPor:[user.id]});
            } else {
              const notifyUsers=notify.map(destId=>USERS.find(u=>u.id===destId)).filter(Boolean);
              if(notifyUsers.length>0){
                sendAviso({
                  id:`AV-${Date.now()}-ntf-group`,origen:user,
                  destinatarioIds:notifyUsers.map(u=>u.id),
                  destinatarioLabel:notifyUsers.length>1?`${notifyUsers.length} personas`:notifyUsers[0].name,
                  texto:_txt,fecha:_fecha,leidoPor:[user.id],
                });
              }
              notify.forEach(destId=>{
                const destUser=USERS.find(u=>u.id===destId);
                if(!destUser?.email) return;
                setTimeout(()=>sendEmailNotification("tarea_completada",[destUser.email],{
                  userName:destUser.name,
                  taskId:task.id,
                  taskTitle:task.title,
                  completedBy:user?.name||"—",
                }),0);
                if(destUser?.phone){
                  setTimeout(()=>sendWhatsAppNotification("tarea_completada",[destUser.phone],{
                    userName:destUser.name,
                    taskId:task.id,
                    taskTitle:task.title,
                    completedBy:user?.name||"—",
                  }),0);
                  setTimeout(()=>sendSMSNotification("tarea_completada",[destUser.phone],{
                    userName:destUser.name,
                    taskId:task.id,
                    taskTitle:task.title,
                    completedBy:user?.name||"—",
                  }),0);
                }
              });
            }
          },0);
        }
      }
      // Notificación 3: notificar cuando una tarea es bloqueada
      if(patch.status==="Bloqueada"&&task.status!=="Bloqueada"&&user){
        const reason=patch.blockReason||"Sin razón especificada";
        const notifyBlocked=[];
        if(task.creator?.id&&task.creator.id!==user.id) notifyBlocked.push(task.creator.id);
        const dirUser=USERS.find(u=>u.dept==="Dirección");
        if(dirUser&&dirUser.id!==user.id&&!notifyBlocked.includes(dirUser.id)) notifyBlocked.push(dirUser.id);
        if(notifyBlocked.length>0){
          setTimeout(()=>sendPushNotification(
            notifyBlocked,
            `🔒 Tarea bloqueada: "${task.title}"`,
            `Bloqueada por ${user.name}. Razón: ${reason.slice(0,60)}`,
            `/?task=${task.id}`
          ),0);
          notifyBlocked.forEach(destId=>{
            const destUser=USERS.find(u=>u.id===destId);
            if(!destUser?.email) return;
            setTimeout(()=>sendEmailNotification("tarea_bloqueada",[destUser.email],{
              userName:destUser.name,
              taskId:task.id,
              taskTitle:task.title,
              blockedBy:user.name,
              reason:reason,
            }),0);
            if(destUser?.phone){
              setTimeout(()=>sendWhatsAppNotification("tarea_bloqueada",[destUser.phone],{
                userName:destUser.name,
                taskId:task.id,
                taskTitle:task.title,
                blockedBy:user.name,
                reason:reason,
              }),0);
              setTimeout(()=>sendSMSNotification("tarea_bloqueada",[destUser.phone],{
                userName:destUser.name,
                taskId:task.id,
                taskTitle:task.title,
                blockedBy:user.name,
                reason:reason,
              }),0);
            }
          });
        }
      }
      return prev.map(t=>t.id===id?updated:t);
    });
    try {
      setTasks(current => {
        try { localStorage.setItem("nexus_tasks_cache", JSON.stringify(current)); } catch(e){}
        return current;
      });
    } catch(e){}
  };
  const deleteTaskFn=async id=>{
    const task=tasks.find(t=>t.id===id);
    setTasks(p=>p.filter(t=>t.id!==id));
    try {
      const current = JSON.parse(localStorage.getItem("nexus_tasks_cache")||"[]");
      localStorage.setItem("nexus_tasks_cache", JSON.stringify(current.filter(t=>t.id!==id)));
    } catch(e){}
    if(task&&user){
      const deletedRecord={
        ...task,
        deletedBy:{id:user.id,name:user.name,dept:user.dept},
        deletedAt:new Date().toISOString(),
      };
      const {error:insError}=await supabase.from("deleted_tasks").insert({
        id:task.id,
        data:deletedRecord,
      });
      if(!insError) setDeletedTasks(p=>[{...deletedRecord},...p]);
    }
    const {error}=await supabase.from("tasks").delete().eq("id",id);
    if(error) console.error("[Supabase] Error en DELETE task:",id,error.message,error);
    else console.log("[Supabase] DELETE ok:",id);
  };
  const addTask=async t=>{
    setSaveError(null);
    await new Promise(r => setTimeout(r, 50));
    const {error}=await supabase.from("tasks").insert({id:t.id,data:t});
    if(error){
      console.error("[Supabase] Error en INSERT task:",t.id,error.message,error);
      setSaveError("No se pudo guardar la tarea. Verifica tu conexión e intenta de nuevo.");
      return false;
    }
    console.log("[Supabase] INSERT ok:",t.id);
    setTasks(p=>[t,...p]);
    try {
      const current = JSON.parse(localStorage.getItem("nexus_tasks_cache")||"[]");
      localStorage.setItem("nexus_tasks_cache", JSON.stringify([t,...current]));
    } catch(e){}
    const notifyIds=[...new Set([
      ...(t.invIds||[]),
      ...(t.responsible?.id?[t.responsible.id]:[]),
    ])].filter(id=>id!==t.creator?.id);
    if(notifyIds.length>0)
      sendPushNotification(notifyIds,"Nueva tarea asignada",t.title,`/?task=${t.id}`);
    const emailTargets=[...new Set([
      ...(t.invIds||[]),
      ...(t.responsible?.id?[t.responsible.id]:[]),
    ])].filter(id=>id!==t.creator?.id);
    emailTargets.forEach(id=>{
      const u=USERS.find(x=>x.id===id);
      if(!u?.email) return;
      setTimeout(()=>sendEmailNotification("nueva_tarea",[u.email],{
        userName:u.name,
        taskId:t.id,
        taskTitle:t.title,
        taskType:t.type,
        priority:t.priority,
        deadline:t.deadline||"Sin fecha",
        responsible:t.responsible?.name||"—",
      }),0);
      if(u?.phone){
        setTimeout(()=>sendWhatsAppNotification("nueva_tarea",[u.phone],{
          userName:u.name,
          taskId:t.id,
          taskTitle:t.title,
          taskType:t.type,
          priority:t.priority,
          deadline:t.deadline||"Sin fecha",
          responsible:t.responsible?.name||"—",
        }),0);
        setTimeout(()=>sendSMSNotification("nueva_tarea",[u.phone],{
          userName:u.name,
          taskId:t.id,
          taskTitle:t.title,
          taskType:t.type,
          priority:t.priority,
          deadline:t.deadline||"Sin fecha",
          responsible:t.responsible?.name||"—",
        }),0);
      }
    });
    return true;
  };

  const sendAviso=async a=>{
    setAvisos(p=>[a,...p]);
    const {error}=await supabase.from("avisos").insert({id:a.id,data:a});
    if(error) console.error("[Supabase] Error INSERT aviso:",error.message,error);
    else {
      console.log("[Supabase] INSERT aviso ok:",a.id);
      const destIds=avisoRecipients(a);
      const recipientIds=destIds==="todos"
        ?USERS.map(u=>u.id).filter(id=>id!==a.origen?.id)
        :[...new Set(Array.isArray(destIds)?destIds:[destIds])].filter(id=>id&&id!==a.origen?.id);
      const pushTitle=`Aviso de ${a.origen?.name||"NEXUS"}`;
      if(recipientIds.length>0) sendPushNotification(recipientIds,pushTitle,a.texto,`/?aviso=${a.id}`);
      recipientIds.forEach(id=>{
        const u=USERS.find(x=>x.id===id);
        if(!u) return;
        if(u.email){
          setTimeout(()=>sendEmailNotification("aviso",[u.email],{
            userName:u.name,
            fromName:a.origen?.name||"—",
            fromDept:a.origen?.dept||"—",
            texto:a.texto,
            avisoId:a.id,
          }),0);
        }
        if(u.phone){
          setTimeout(()=>sendWhatsAppNotification("aviso",[u.phone],{
            userName:u.name,
            fromName:a.origen?.name||"—",
            fromDept:a.origen?.dept||"—",
            texto:a.texto,
          }),0);
          setTimeout(()=>sendSMSNotification("aviso",[u.phone],{
            userName:u.name,
            fromName:a.origen?.name||"—",
            fromDept:a.origen?.dept||"—",
            texto:a.texto,
          }),0);
        }
      });
    }
  };
  const markAvisoRead=id=>{
    setAvisos(prev=>{
      const a=prev.find(x=>x.id===id);
      if(!a||(a.leidoPor||[]).includes(user.id)) return prev;
      const optimistic={...a,leidoPor:[...(a.leidoPor||[]),user.id]};
      // Append atómico server-side: la marca de lectura se calcula sobre la
      // fila viva, así nunca se pierde por una sobreescritura concurrente
      // de otro usuario leyendo el mismo aviso casi al mismo tiempo.
      supabase.rpc("mark_aviso_read",{aviso_id:id,p_user_id:user.id})
        .then(({data:merged,error})=>{
          if(error){console.error("[Supabase] Error markRead aviso:",error.message);return;}
          if(merged) setAvisos(current=>current.map(x=>x.id===id?merged:x));
        });
      return prev.map(x=>x.id===id?optimistic:x);
    });
  };
  const updateAviso=(id,patch)=>{
    setAvisos(prev=>prev.map(x=>x.id===id?{...x,...patch}:x));
    supabase.rpc("merge_aviso_data",{aviso_id:id,patch})
      .then(({data:merged,error})=>{
        if(error){console.error("[Supabase] Error updateAviso:",error.message);return;}
        if(merged) setAvisos(current=>current.map(x=>x.id===id?merged:x));
      });
  };
  const deleteAviso=async id=>{
    setAvisos(p=>p.filter(a=>a.id!==id));
    const {error}=await supabase.from("avisos").delete().eq("id",id);
    if(error) console.error("[Supabase] Error DELETE aviso:",id,error.message,error);
    else console.log("[Supabase] DELETE aviso ok:",id);
  };
  const unreadAvisos=user?avisos.filter(a=>avisoIncludesUser(a,user.id)&&!(a.leidoPor||[]).includes(user.id)).length:0;

  // ════════════════════════════════════════
  // OPERACIONES CRUD: QUICK TASKS
  // ════════════════════════════════════════
  const createQuickTask=async data=>{
    console.log("[QuickTask Create] iniciando", { title: data.title, assignedToId: data.assignedToId, dept: data.dept, priority: data.priority });
    const now=new Date();
    const qt={
      id:`QT-${now.getTime()}`,
      title:data.title,
      description:data.description||"",
      assignedToId:data.assignedToId,
      dept:data.dept,
      createdBy:{id:user.id,name:user.name,dept:user.dept},
      status:"Pendiente",
      priority:data.priority,
      deadline:data.deadline||null,
      comments:[],
      createdAt:now.toISOString(),
      completedAt:null,
      deletedAt:null,
      deletedBy:null,
      deleteReason:null,
      deleted:false
    };
    setQuickTasks(p=>[qt,...p]);
    const {error}=await supabase.from("quick_tasks").insert({id:qt.id,data:qt});
    if(error){
      console.error("[Supabase] Error INSERT quick_task:",error.message,error);
      setQuickTasks(p=>p.filter(t=>t.id!==qt.id));
    }else{
      console.log("[Supabase] INSERT quick_task ok:",qt.id);
      // Notificar a: usuario asignado + Dirección (SIEMPRE excluir al creador de push/email)
      const assignedUser=USERS.find(u=>u.id===qt.assignedToId);
      const direccionUsers=USERS.filter(u=>u.dept==="Dirección");

      // Dedup: combinar asignado + Dirección, excluir creador de push/email
      const allPotentialRecipients=[assignedUser,...direccionUsers].filter(Boolean);
      const notifyUsers=allPotentialRecipients.reduce((acc,u)=>{
        if(!acc.find(x=>x.id===u.id)&&u.id!==user.id) acc.push(u);
        return acc;
      },[]);

      const notifyIds=notifyUsers.map(u=>u.id);
      const recipientEmails=notifyUsers.filter(u=>u.email).map(u=>u.email);

      console.log("[QuickTask Create] destinatarios calculados", {
        assignedUserId: qt.assignedToId,
        creatorId: user.id,
        recipientIds: notifyIds,
        recipientEmails,
        count: notifyIds.length,
        excludedCreator: true
      });

      if(notifyIds.length>0){
        (async()=>{
          try{
            await sendPushNotification(notifyIds,`⚡ Nueva tarea rápida: ${qt.title}`,`Asignada a ${assignedUser?.name||"—"}`,`/?quickTask=${qt.id}`);
            console.log("[QuickTask Create] push OK a",notifyIds);
          }catch(e){
            console.error("[QuickTask Create] push FAIL",notifyIds,e);
          }
        })();
        notifyUsers.forEach(u=>{
          if(u.email){
            setTimeout(async()=>{
              try{
                await sendEmailNotification("quick_task_created",[u.email],{
                  userName:u.name,
                  taskId:qt.id,
                  taskTitle:qt.title,
                  taskDescription:qt.description||"Sin descripción",
                  dept:qt.dept,
                  assignedToName:assignedUser?.name||"—",
                  priority:{1:"Alta",2:"Media",3:"Baja"}[qt.priority]||"—",
                  creatorName:user.name,
                  deadline:qt.deadline?new Date(qt.deadline).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"}):"Sin fecha",
                });
                console.log("[QuickTask Create] email OK a",u.email);
              }catch(e){
                console.error("[QuickTask Create] email FAIL",u.email,e);
              }
            },0);
          }
        });
      }
    }
  };

  const updateQuickTask=(id,patch)=>{
    setQuickTasks(prev=>prev.map(t=>t.id===id?{...t,...patch}:t));
    supabase.rpc("merge_quick_task_data",{task_id:id,patch})
      .then(({error})=>{
        if(error){
          console.error("[Supabase] Error updateQuickTask:",error.message);
          setQuickTasks(prev=>prev.map(t=>t.id===id?quickTasks.find(x=>x.id===id)||t:t));
        }
      });
  };

  const deleteQuickTask=(id,deleteData)=>{
    updateQuickTask(id,deleteData);
  };

  const restoreQuickTask=(id,restoreData)=>{
    updateQuickTask(id,restoreData);
  };

  const activeQuickTasksCount=useMemo(()=>{
    if(!user) return 0;
    const isDireccion=user.dept==="Dirección";
    return quickTasks.filter(t=>{
      if(t.deleted) return false;
      if(t.status==="Completada") return false;
      if(!isDireccion&&t.dept!==user.dept) return false;
      return true;
    }).length;
  },[quickTasks,user]);

  const logout=()=>{localStorage.removeItem("taskops_user");sessionStorage.removeItem("taskops_authed_depts");setUser(null);setAuthedDepts([]);setScreen("dash");};
  const openNotif=()=>{
    setScreen("notif");
    // Actualizar el timestamp después de 2 segundos para que el usuario vea cuáles son nuevas
    setTimeout(()=>{
      if(!user) return;
      const now=new Date().toISOString();
      localStorage.setItem(`taskops_last_notif_view_${user.id}`,now);
      setLastNotifView(now);
    },2000);
  };
  const enablePushNotifications=async()=>{
    if(!user) return;
    setShowPushBanner(false);
    localStorage.setItem("taskops_push_decided","true");
    try{
      await registerPush(user);
      setPushEnabled(true);
      localStorage.setItem("taskops_push_enabled","true");
    }catch(err){
      console.error("[Push] Error al activar notificaciones:",err);
    }
  };
  const dismissPushBanner=()=>{
    setShowPushBanner(false);
    localStorage.setItem("taskops_push_decided","true");
  };
  const unreadNotif=useMemo(()=>{
    if(!user) return 0;
    const since=lastNotifView?new Date(lastNotifView):new Date(0);
    let n=0;
    tasks.forEach(t=>{
      if((t.invIds||[]).includes(user.id)||t.responsible?.id===user.id){if(new Date(t.createdAt||0)>since)n++;}
      if(t.status==="Completada"&&(t.notifyOnComplete||[]).includes(user.id)){if(new Date((t.completedAt||t.createdAt)||0)>since)n++;}
      const isRecipient=(t.invIds||[]).includes(user.id)||t.responsible?.id===user.id||t.creator?.id===user.id;
      if(isRecipient){
        (t.comments||[]).forEach(c=>{if(c.user?.id!==user.id&&new Date(c.iso||0)>since)n++;});
      }
    });
    avisos.forEach(a=>{if(avisoIncludesUser(a,user.id)){if(new Date(a.fecha||0)>since)n++;}});
    avisos.forEach(a=>{
      const isRecipient=avisoIncludesUser(a,user.id)||a.origen?.id===user.id;
      if(isRecipient)(a.comments||[]).forEach(c=>{if(c.authorId!==user.id&&new Date(c.iso||0)>since)n++;});
    });
    // Tareas rápidas: contar nuevas donde el usuario sea del depto destinatario, creador, o Dirección
    quickTasks.forEach(qt=>{
      const isDireccion=user.dept==="Dirección";
      const isDeptUser=qt.dept===user.dept;
      const isCreator=qt.createdBy?.id===user.id;
      if((isDeptUser||isDireccion)&&!isCreator&&!qt.deleted){
        if(new Date(qt.createdAt||0)>since)n++;
      }
      // Comentarios en tareas rápidas donde el usuario sea destinatario según reglas
      const commentUserIds=(qt.comments||[]).map(cm=>cm.user?.id).filter(Boolean);
      const isQTRecipient=qt.createdBy?.id===user.id||qt.dept===user.dept||user.dept==="Dirección"||commentUserIds.includes(user.id);
      if(isQTRecipient){
        (qt.comments||[]).forEach(c=>{if(c.user?.id!==user.id&&new Date(c.iso||0)>since)n++;});
      }
    });
    return n;
  },[tasks,avisos,quickTasks,user,lastNotifView]);
  const goTask=(t,from)=>{setSelTask(t);setFromScr(from||screen);setScreen("task");};
  const userIsAuthed = user && authedDepts.includes(user.dept);
  const canAddInDept=dept=>{if(!user)return false;if(user.dept==="Dirección")return true;if(user.dept===dept)return true;return authedDepts.includes(dept);};
  const onPickerDeptClick=dept=>{if(canAddInDept(dept)){setSelDept(dept);setDeptCanAdd(true);setScreen("dept");}else setPwdModal({dept});};
  const onWidgetDeptClick=dept=>{setSelDept(dept);setDeptCanAdd(canAddInDept(dept));setScreen("dept");};
  const handlePwdSuccess=()=>{
    const d=pwdModal.dept;
    setAuthedDepts(p=>[...p,d]);
    if(pwdModal.fromFab){setPwdModal(null);setCreateDept(null);setScreen(user?"create":"dash");}
    else{setSelDept(d);setDeptCanAdd(true);setScreen("dept");setPwdModal(null);}
  };
  const handleViewOnly=()=>{
    if(pwdModal.fromFab){setPwdModal(null);return;}
    const d=pwdModal.dept;setSelDept(d);setDeptCanAdd(false);setScreen("dept");setPwdModal(null);
  };

  // Valor del contexto Realtime disponible en todas las pantallas
  const realtimeContextValue={status:realtimeStatus,lastSyncTime};

  if(screen==="login") return <RealtimeContext.Provider value={realtimeContextValue}><style>{CSS}</style><ScreenLogin onLogin={u=>{
    setUser(u);
    setAuthedDepts(p=>[...p,u.dept]);
    setPwdModal(null);
    setDeleteTask(null);
    setSelDept(null);
    setSelTask(null);
    setEditingTask(null);
    setCreateDept(null);
    setFilter(null);
    setDeptCanAdd(false);
    setSaveError(null);
    setFromScr("dash");
    setScreen("dash");
    localStorage.setItem("taskops_user",JSON.stringify(u));
    // Ya NO llamamos registerPush() automáticamente - se activará con interacción explícita
  }} onBack={()=>setScreen("dash")}/></RealtimeContext.Provider>;

  if(screen==="create"&&user) return <RealtimeContext.Provider value={realtimeContextValue}><style>{CSS}</style><ScreenCreate user={user} taskCount={tasks.length} defaultDept={createDept} saveError={saveError} onSave={t=>{return addTask(t).then(ok=>{if(ok)setScreen(createDept?"dept":"dash");}).catch(err=>{console.error("[onSave] Error:",err);});}} onCancel={()=>{setSaveError(null);setScreen(createDept?"dept":"dash");}}/></RealtimeContext.Provider>;

  if(screen==="edit"&&editingTask&&user) return <RealtimeContext.Provider value={realtimeContextValue}><style>{CSS}</style><ScreenCreate user={user} taskCount={tasks.length} taskToEdit={editingTask} onSave={patch=>{updateTask(editingTask.id,patch);setEditingTask(null);setScreen("task");}} onCancel={()=>{setEditingTask(null);setScreen("task");}}/></RealtimeContext.Provider>;

  if(screen==="task"&&selTask){
    const live=tasks.find(t=>t.id===selTask.id)||selTask;
    return <RealtimeContext.Provider value={realtimeContextValue}><style>{CSS}</style>
      <ScreenTaskDetail taskId={live.id} tasks={tasks} user={user} onBack={()=>setScreen(fromScr)} onUpdate={updateTask} onEdit={t=>{setEditingTask(t);setScreen("edit");}} onDelete={t=>setDeleteTask(t)}/>
      {deleteTask&&<DeleteModal task={deleteTask} onConfirm={()=>{deleteTaskFn(deleteTask.id);setDeleteTask(null);setScreen(fromScr);}} onCancel={()=>setDeleteTask(null)}/>}
    </RealtimeContext.Provider>;
  }

  if(screen==="dept"&&selDept) return <RealtimeContext.Provider value={realtimeContextValue}>
    <style>{CSS}</style>
    <ScreenDeptDetail dept={selDept} tasks={tasks} user={user} canAdd={deptCanAdd}
      onBack={()=>setScreen("dash")} onTaskClick={t=>goTask(t,"dept")}
      onNewTask={()=>{setCreateDept(selDept);setScreen("create");}}
      onRequestAccess={user?()=>setPwdModal({dept:selDept}):undefined}
    />
    {pwdModal&&<PasswordModal dept={pwdModal.dept} onSuccess={handlePwdSuccess} onViewOnly={handleViewOnly} onCancel={()=>setPwdModal(null)}/>}
  </RealtimeContext.Provider>;

  if(screen==="filtered"&&filter) return <RealtimeContext.Provider value={realtimeContextValue}><style>{CSS}</style><ScreenFilteredList tasks={tasks} filter={filter} user={user} onBack={()=>setScreen("dash")} onTaskClick={t=>goTask(t,"filtered")}/></RealtimeContext.Provider>;

  if(screen==="search") return <RealtimeContext.Provider value={realtimeContextValue}><style>{CSS}</style><ScreenSearch tasks={tasks} user={user} onBack={()=>setScreen("dash")} onTaskClick={t=>goTask(t,"search")} avisos={avisos} onAvisoClick={a=>{setSelAviso(a);setScreen("avisos");}}/></RealtimeContext.Provider>;

  if(screen==="myTasks"&&user) return <RealtimeContext.Provider value={realtimeContextValue}><style>{CSS}</style><ScreenMyTasks tasks={tasks} user={user} onBack={()=>setScreen("dash")} onTaskClick={t=>goTask(t,"myTasks")}/></RealtimeContext.Provider>;

  if(screen==="calendar") return <RealtimeContext.Provider value={realtimeContextValue}><style>{CSS}</style><ScreenCalendar tasks={tasks} user={user} onBack={()=>setScreen("dash")} onTaskClick={t=>goTask(t,"calendar")}/></RealtimeContext.Provider>;

  if(screen==="stats") return <RealtimeContext.Provider value={realtimeContextValue}><style>{CSS}</style><ScreenStats tasks={tasks} user={user} onBack={()=>setScreen("dash")}/></RealtimeContext.Provider>;

  if(screen==="delays"&&user) return <RealtimeContext.Provider value={realtimeContextValue}><style>{CSS}</style><ScreenDelays tasks={tasks} user={user} onBack={()=>setScreen("dash")} onTaskClick={t=>goTask(t,"delays")}/></RealtimeContext.Provider>;

  if(screen==="stuck"&&user) return <RealtimeContext.Provider value={realtimeContextValue}><style>{CSS}</style><ScreenStuckTasks tasks={tasks} user={user} onBack={()=>setScreen("dash")} onTaskClick={t=>goTask(t,"stuck")}/></RealtimeContext.Provider>;

  if(screen==="deleted"&&user&&(user.dept==="Dirección"||user.dept==="Ingenieria")) return <RealtimeContext.Provider value={realtimeContextValue}><style>{CSS}</style><ScreenDeletedTasks deletedTasks={deletedTasks} user={user} onBack={()=>setScreen("dash")}/></RealtimeContext.Provider>;

  if(screen==="avisos"&&user) return <RealtimeContext.Provider value={realtimeContextValue}><style>{CSS}</style><ScreenAviso user={user} avisos={avisos} onSend={sendAviso} onMarkRead={markAvisoRead} onUpdateAviso={updateAviso} onDeleteAviso={deleteAviso} onBack={()=>{setSelAviso(null);setScreen("dash");}} initialSelected={selAviso}/></RealtimeContext.Provider>;

  if(screen==="notif"&&user) return <RealtimeContext.Provider value={realtimeContextValue}><style>{CSS}</style><ScreenNotificaciones tasks={tasks} avisos={avisos} quickTasks={quickTasks} user={user} onBack={()=>setScreen("dash")} onTaskClick={t=>goTask(t,"notif")} onAvisoClick={a=>{setSelAviso(a);setScreen("avisos");}} onQuickTaskClick={qt=>setScreen("quickTasks")} lastNotifView={lastNotifView}/></RealtimeContext.Provider>;

  if(screen==="ausencias") return <RealtimeContext.Provider value={realtimeContextValue}><style>{CSS}</style><ScreenAusencias user={user} ausencias={ausencias} onBack={()=>setScreen("dash")} cargarAusencias={cargarAusencias}/></RealtimeContext.Provider>;

  if(screen==="quickTasks"&&user) return <RealtimeContext.Provider value={realtimeContextValue}><style>{CSS}</style><ScreenQuickTasks user={user} quickTasks={quickTasks} onBack={()=>setScreen("dash")} onCreateTask={createQuickTask} onUpdateTask={updateQuickTask} onDeleteTask={deleteQuickTask} onRestoreTask={restoreQuickTask}/></RealtimeContext.Provider>;

  return(
    <RealtimeContext.Provider value={realtimeContextValue}>
      <style>{CSS}</style>
      <ScreenDashboard tasks={tasks} user={user}
        onStatClick={f=>{setFilter(f);setScreen("filtered");}}
        onDeptClick={onWidgetDeptClick}
        onPickerDeptClick={onPickerDeptClick}
        onTaskClick={t=>goTask(t,"dash")}
        onNewTask={()=>{setCreateDept(null);setScreen("create");}}
        onSearch={()=>setScreen("search")}
        onStats={()=>setScreen("stats")}
        onMyTasks={()=>setScreen("myTasks")}
        onCalendar={()=>setScreen("calendar")}
        onDelays={()=>setScreen("delays")}
        onStuck={()=>setScreen("stuck")}
        onDeleted={()=>setScreen("deleted")}
        userIsAuthed={userIsAuthed}
        onRequestAuth={user?()=>setPwdModal({dept:user.dept,fromFab:true}):()=>setScreen("login")}
        deptIsAuthed={canAddInDept}
        dbConnected={dbConnected}
        onAvisos={()=>setScreen("avisos")}
        onAusencias={()=>setScreen("ausencias")}
        onQuickTasks={()=>setScreen("quickTasks")}
        quickTasksCount={activeQuickTasksCount}
        ausencias={ausencias}
        cargarAusencias={cargarAusencias}
        unreadAvisos={unreadAvisos}
        isGuest={!user}
        onLogin={()=>setScreen("login")}
        onNotif={openNotif}
        onLogout={logout}
        unreadNotif={unreadNotif}
      />
      {pwdModal&&<PasswordModal dept={pwdModal.dept} onSuccess={handlePwdSuccess} onViewOnly={handleViewOnly} onCancel={()=>setPwdModal(null)} hideViewOnly={!!pwdModal.fromFab}/>}
      {deleteTask&&<DeleteModal task={deleteTask} onConfirm={()=>{deleteTaskFn(deleteTask.id);setDeleteTask(null);}} onCancel={()=>setDeleteTask(null)}/>}
      {showPushBanner&&(
        <div style={{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",maxWidth:480,width:"calc(100% - 40px)",background:"#1E293B",color:"#fff",borderRadius:12,padding:"16px 20px",boxShadow:"0 10px 25px rgba(0,0,0,.3)",zIndex:9999,display:"flex",alignItems:"center",gap:12}}>
          <div style={{fontSize:24}}>🔔</div>
          <div style={{flex:1}}>
            <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>Activa las notificaciones</div>
            <div style={{fontSize:12,color:"#CBD5E1",lineHeight:1.4}}>Recibe alertas instantáneas de comentarios, tareas asignadas y actualizaciones.</div>
          </div>
          <button onClick={enablePushNotifications} style={{background:"#3B82F6",color:"#fff",border:"none",padding:"8px 16px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
            Activar
          </button>
          <button onClick={dismissPushBanner} style={{background:"transparent",color:"#94A3B8",border:"none",fontSize:20,cursor:"pointer",padding:"4px 8px",lineHeight:1}}>
            ×
          </button>
        </div>
      )}
    </RealtimeContext.Provider>
  );
}
