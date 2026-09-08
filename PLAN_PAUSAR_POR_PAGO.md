# PLAN DE IMPLEMENTACIÓN — Pausar por Falta de Pago

**Opción A confirmada:** Campo booleano `pausedForPayment`, no nuevo status.
**Sin restricciones de permisos:** Cualquiera puede pausar/reanudar/ver la lista.

---

## ESTRUCTURA DE DATOS

Agregar a **Tareas Normales** y **Quick Tasks**:

```javascript
{
  pausedForPayment: false,      // default false
  pausedAt: null,                // ISO timestamp o null
  pausedBy: null,                // {id, name} o null
  pausedNote: ""                 // string (opcional)
}
```

---

## PARTE 1 — Botón Pausar/Reanudar en Tareas Normales

### **Ubicación:** `App.jsx` línea ~3425-3450 (ScreenTaskDetail)

### **Cambios necesarios:**

**1.1 — Agregar estados para el formulario de pausa** (después de línea 3432)

```javascript
// ANTES (línea 3432):
const [showBlockForm,setShowBlockForm]=useState(false);
const [blockReason,setBlockReason]=useState("");

// AGREGAR DESPUÉS:
const [showPauseForm,setShowPauseForm]=useState(false);
const [pauseNote,setPauseNote]=useState("");
```

**1.2 — Agregar badge visual si está pausada** (después de línea 3617, donde muestra blockReason)

```javascript
// INSERTAR DESPUÉS de línea ~3623 (después del bloque de Bloqueada):

{task.pausedForPayment&&(
  <div style={{display:"flex",gap:10,alignItems:"flex-start",background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8,padding:"10px 14px",marginBottom:10}}>
    <span style={{fontSize:16,flexShrink:0}}>💳</span>
    <div style={{flex:1}}>
      <div style={{fontSize:11,fontWeight:700,color:"#D97706",marginBottom:2}}>
        Pausada por falta de pago
        {task.pausedBy?` — ${task.pausedBy.name}`:""} 
        {task.pausedAt?` · ${new Date(task.pausedAt).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})}`:""} 
        {task.pausedAt?` (hace ${Math.floor((new Date()-new Date(task.pausedAt))/86400000)} días)`:""} 
      </div>
      {task.pausedNote&&<p style={{fontSize:13,color:"#92400E",lineHeight:1.5,margin:0}}>{task.pausedNote}</p>}
    </div>
  </div>
)}
```

**1.3 — Formulario de pausa** (después de línea ~3677, donde está showCancelForm)

```javascript
// INSERTAR DESPUÉS del bloque showCancelForm (línea ~3677):

{showPauseForm&&(
  <div style={{background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:10,padding:14,marginBottom:10}}>
    <div style={{fontSize:12,fontWeight:700,color:"#D97706",marginBottom:8}}>Motivo de la pausa (opcional)</div>
    <textarea value={pauseNote} onChange={e=>setPauseNote(e.target.value)} rows={2}
      placeholder="Ej: Cliente no ha pagado factura #1234, Falta anticipo del 50%, etc."
      style={{...inp,borderRadius:6,fontSize:12,marginBottom:10}}/>
    <div style={{display:"flex",gap:8}}>
      <button onClick={()=>{
        onUpdate(taskId,{
          pausedForPayment:true,
          pausedAt:new Date().toISOString(),
          pausedBy:{id:user.id,name:user.name},
          pausedNote:pauseNote.trim()
        });
        setShowPauseForm(false);
        setPauseNote("");
      }}
        style={{background:"#D97706",color:"#fff",border:"none",padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700}}>
        Confirmar pausa
      </button>
      <button onClick={()=>setShowPauseForm(false)}
        style={{background:CARD,border:`1px solid ${BD}`,color:T2,padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12}}>
        Cancelar
      </button>
    </div>
  </div>
)}
```

**1.4 — Botones de acción** (modificar línea ~3584-3585)

```javascript
// ANTES (línea ~3584):
{canEdit&&user.dept==="Dirección"&&<button onClick={()=>{setShowBlockForm(true);setBlockReason("");setShowCancelForm(false);}} style={{background:"#FEF2F2",color:"#DC2626",border:"1px solid #FECACA",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>🔒{isMobile?"":" Bloquear"}</button>}
{canEdit&&<button onClick={()=>{setShowCancelForm(true);setCancelReason("");setShowBlockForm(false);}} style={{background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>✕{isMobile?"":" Cancelar"}</button>}

// AGREGAR DESPUÉS (mantener los anteriores y agregar):
{canEdit&&!task.pausedForPayment&&<button onClick={()=>{setShowPauseForm(true);setPauseNote("");setShowBlockForm(false);setShowCancelForm(false);}} style={{background:"#FFFBEB",color:"#D97706",border:"1px solid #FDE68A",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>⏸{isMobile?"":" Pausar por pago"}</button>}
{canEdit&&task.pausedForPayment&&<button onClick={()=>{
  onUpdate(taskId,{pausedForPayment:false,pausedAt:null,pausedBy:null,pausedNote:""});
}} style={{background:"#ECFDF5",color:"#059669",border:"1px solid #A7F3D0",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>▶️{isMobile?"":" Reanudar"}</button>}
```

---

## PARTE 2 — Mismo Patrón en Quick Tasks

### **Ubicación:** `App.jsx` línea ~2820-2980 (ScreenQuickTasks modal de detalle)

### **Cambios necesarios:**

**2.1 — Agregar estados** (buscar donde están los useState de ScreenQuickTasks, línea ~2410 aprox)

```javascript
// AGREGAR junto a los otros estados de Quick Tasks:
const [showPauseFormQt,setShowPauseFormQt]=useState(false);
const [pauseNoteQt,setPauseNoteQt]=useState("");
```

**2.2 — Badge visual en el modal de detalle** (después de línea ~2868, antes de "Estado")

```javascript
// INSERTAR ANTES del bloque "Estado" (línea ~2872):

{selectedTask.pausedForPayment&&(
  <div style={{display:"flex",gap:10,alignItems:"flex-start",background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8,padding:"10px 14px",marginBottom:16}}>
    <span style={{fontSize:16,flexShrink:0}}>💳</span>
    <div style={{flex:1}}>
      <div style={{fontSize:11,fontWeight:700,color:"#D97706",marginBottom:2}}>
        Pausada por falta de pago
        {selectedTask.pausedBy?` — ${selectedTask.pausedBy.name}`:""} 
        {selectedTask.pausedAt?` · ${new Date(selectedTask.pausedAt).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})}`:""} 
        {selectedTask.pausedAt?` (hace ${Math.floor((new Date()-new Date(selectedTask.pausedAt))/86400000)} días)`:""} 
      </div>
      {selectedTask.pausedNote&&<p style={{fontSize:12,color:"#92400E",lineHeight:1.5,margin:0}}>{selectedTask.pausedNote}</p>}
    </div>
  </div>
)}
```

**2.3 — Formulario de pausa** (después del bloque de "Estado", línea ~2884)

```javascript
// INSERTAR DESPUÉS del bloque "Estado":

{showPauseFormQt&&!selectedTask.deleted&&(
  <div style={{marginBottom:20}}>
    <div style={{background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8,padding:14}}>
      <div style={{fontSize:12,fontWeight:600,color:"#D97706",marginBottom:8}}>Motivo de la pausa (opcional)</div>
      <textarea value={pauseNoteQt} onChange={e=>setPauseNoteQt(e.target.value)} rows={2}
        placeholder="Ej: Cliente no ha pagado, falta anticipo, etc."
        style={{width:"100%",padding:10,borderRadius:6,border:`1px solid ${BD}`,fontSize:12,background:CARD,color:T1,resize:"vertical",marginBottom:10}}/>
      <div style={{display:"flex",gap:8}}>
        <button onClick={()=>{
          onUpdateTask(selectedTask.id,{
            pausedForPayment:true,
            pausedAt:new Date().toISOString(),
            pausedBy:{id:user.id,name:user.name},
            pausedNote:pauseNoteQt.trim()
          });
          setShowPauseFormQt(false);
          setPauseNoteQt("");
        }}
          style={{background:"#D97706",color:"#fff",border:"none",padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700}}>
          Confirmar pausa
        </button>
        <button onClick={()=>{setShowPauseFormQt(false);setPauseNoteQt("");}}
          style={{background:CARD,border:`1px solid ${BD}`,color:T2,padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12}}>
          Cancelar
        </button>
      </div>
    </div>
  </div>
)}
```

**2.4 — Botones de acción** (modificar línea ~2948-2968)

```javascript
// AGREGAR en la sección de botones de acción (línea ~2948):
{!selectedTask.deleted&&!selectedTask.pausedForPayment&&(
  <button onClick={()=>{setShowPauseFormQt(true);setPauseNoteQt("");}}
    style={{background:"#FFFBEB",color:"#D97706",border:"1px solid #FDE68A",padding:"10px 16px",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:600}}>
    ⏸ Pausar por pago
  </button>
)}
{!selectedTask.deleted&&selectedTask.pausedForPayment&&(
  <button onClick={()=>{
    onUpdateTask(selectedTask.id,{pausedForPayment:false,pausedAt:null,pausedBy:null,pausedNote:""});
  }}
    style={{background:"#ECFDF5",color:"#059669",border:"1px solid #A7F3D0",padding:"10px 16px",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:600}}>
    ▶️ Reanudar
  </button>
)}
```

---

## PARTE 3 — Badge Visual en Listas

### **Ubicación:** 
- `TRow` (línea 191-223) para tareas normales
- Lista de Quick Tasks (línea ~3100-3200 aprox)

### **Cambios necesarios:**

**3.1 — Badge en TRow (tareas normales)** — modificar línea ~201-208

```javascript
// ANTES (línea ~201-208):
<div style={{display:"flex",gap:6,alignItems:"center",marginBottom:6,flexWrap:"wrap"}}>
  <span style={{fontSize:10,color:T3,fontWeight:500}}>{t.id}</span>
  {roleBadge&&<Badge ch={roleBadge} c={roleBadge==="Responsable"?PR:"#059669"} bg={roleBadge==="Responsable"?PRl:"#ECFDF5"}/>}
  <Badge ch={t.type}     c={tt.c} bg={tt.bg}/>
  <Badge ch={t.priority} c={pc.c} bg={pc.bg}/>
  <Badge ch={t.status}   c={sc.c} bg={sc.bg}/>
  {dl.isOver&&<Badge ch="⚠ Vencida" c="#DC2626" bg="#FEF2F2"/>}
  {dl.isToday&&<Badge ch="🟠 Vence hoy" c="#EA580C" bg="#FFF7ED"/>}
</div>

// AGREGAR DESPUÉS de la línea del status:
  {t.pausedForPayment&&<Badge ch="💳 Pausada" c="#D97706" bg="#FFFBEB"/>}
```

**3.2 — Badge en lista Quick Tasks** (buscar donde se renderiza el badge de status, línea ~3112)

```javascript
// BUSCAR línea ~3112:
<Badge ch={task.status} c={statusColor(task.status)} bg={statusColor(task.status)+"15"}/>

// AGREGAR DESPUÉS:
{task.pausedForPayment&&<Badge ch="💳" c="#D97706" bg="#FFFBEB"/>}
```

**3.3 — También en segunda ocurrencia** (línea ~3155 similar)

```javascript
// BUSCAR línea ~3155:
<Badge ch={task.status} c={statusColor(task.status)} bg={statusColor(task.status)+"15"}/>

// AGREGAR DESPUÉS:
{task.pausedForPayment&&<Badge ch="💳" c="#D97706" bg="#FFFBEB"/>}
```

---

## PARTE 4 — Nueva Pantalla "Pausadas por Pago"

### **Ubicación:** Nuevo componente + routing

**4.1 — Crear componente ScreenPausedForPayment** (agregar ANTES de la línea 6230, antes del routing)

```javascript
/* ════════════════════════════════════════
   SCREEN: PAUSADAS POR PAGO
════════════════════════════════════════ */
function ScreenPausedForPayment({tasks,quickTasks,user,onBack,onTaskClick,onQuickTaskClick}){
  const isMobile=useIsMobile();
  
  // Combinar tareas normales + quick tasks pausadas
  const pausedTasks=useMemo(()=>{
    const normalTasks=tasks
      .filter(t=>t.pausedForPayment===true)
      .map(t=>({
        ...t,
        itemType:"normal",
        pausedDays:t.pausedAt?Math.floor((new Date()-new Date(t.pausedAt))/86400000):0
      }));
    
    const quickTasksPaused=quickTasks
      .filter(qt=>qt.pausedForPayment===true && !qt.deleted)
      .map(qt=>({
        ...qt,
        itemType:"quick",
        pausedDays:qt.pausedAt?Math.floor((new Date()-new Date(qt.pausedAt))/86400000):0
      }));
    
    // Ordenar por antigüedad de pausa (más antiguas primero)
    return [...normalTasks,...quickTasksPaused].sort((a,b)=>
      new Date(a.pausedAt||0)-new Date(b.pausedAt||0)
    );
  },[tasks,quickTasks]);

  const handleResume=(item)=>{
    if(item.itemType==="normal"){
      onTaskClick({...item,_action:"resume"});
    } else {
      onQuickTaskClick({...item,_action:"resume"});
    }
  };

  return(
    <div style={{minHeight:"100vh",background:BG}}>
      <NavBar left={
        <><BackBtn onClick={onBack}/>
        <div>
          <div style={{fontWeight:700,fontSize:15,color:T1}}>💳 Pausadas por Pago</div>
          <div style={{fontSize:11,color:T2}}>{pausedTasks.length} {pausedTasks.length===1?"tarea":"tareas"}</div>
        </div></>
      }/>
      
      <div style={{maxWidth:900,margin:"0 auto",padding:isMobile?"16px":"24px"}}>
        {pausedTasks.length===0?(
          <div style={{textAlign:"center",padding:"60px 20px",color:T3}}>
            <div style={{fontSize:48,marginBottom:16}}>✓</div>
            <div style={{fontSize:15,fontWeight:600,marginBottom:6}}>Sin tareas pausadas por pago</div>
            <div style={{fontSize:13}}>Todas las tareas tienen pagos al día</div>
          </div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {pausedTasks.map((item,idx)=>{
              const isNormal=item.itemType==="normal";
              const typeLabel=isNormal?"Tarea":"Quick Task";
              const dept=isNormal?item.responsible?.dept:item.dept;
              const responsible=isNormal?item.responsible?.name:(item.assignedUserIds?.length>0?`${item.assignedUserIds.length} asignados`:"—");
              
              return(
                <Card key={`${item.itemType}-${item.id}`} cls="rw" sx={{padding:"14px 18px",borderLeft:`4px solid #D97706`}}>
                  <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                    <div style={{flex:1,minWidth:0}}>
                      {/* Header */}
                      <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:6,flexWrap:"wrap"}}>
                        <Badge ch={typeLabel} c="#6B7280" bg="#F9FAFB"/>
                        <Badge ch={dept||"—"} c={dc(dept)} bg={dc(dept)+"15"}/>
                        <Badge ch={`⏸ ${item.pausedDays}d pausada`} c="#D97706" bg="#FFFBEB"/>
                      </div>
                      
                      {/* Título */}
                      <div 
                        onClick={()=>isNormal?onTaskClick(item):onQuickTaskClick(item)}
                        style={{fontSize:14,fontWeight:600,color:T1,marginBottom:8,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",cursor:"pointer"}}>
                        {item.title}
                      </div>
                      
                      {/* Info */}
                      <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center",marginBottom:item.pausedNote?8:0}}>
                        <span style={{fontSize:11,color:T2}}>👤 {responsible}</span>
                        <span style={{fontSize:11,color:T3}}>
                          Pausada por: {item.pausedBy?.name||"—"}
                        </span>
                        {item.pausedAt&&(
                          <span style={{fontSize:11,color:T3}}>
                            {new Date(item.pausedAt).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})}
                          </span>
                        )}
                      </div>
                      
                      {/* Nota de pausa */}
                      {item.pausedNote&&(
                        <div style={{background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:6,padding:"8px 12px",marginBottom:8}}>
                          <div style={{fontSize:10,fontWeight:600,color:"#92400E",marginBottom:2}}>MOTIVO:</div>
                          <div style={{fontSize:12,color:"#92400E",lineHeight:1.5}}>{item.pausedNote}</div>
                        </div>
                      )}
                    </div>
                    
                    {/* Botón reanudar */}
                    <button 
                      onClick={(e)=>{
                        e.stopPropagation();
                        handleResume(item);
                      }}
                      style={{background:"#ECFDF5",color:"#059669",border:"1px solid #A7F3D0",padding:"8px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,flexShrink:0,whiteSpace:"nowrap"}}>
                      ▶️ Reanudar
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
```

**4.2 — Agregar routing** (línea ~6296, después de screen==="versions")

```javascript
// INSERTAR DESPUÉS de línea ~6296:

if(screen==="pausedForPayment"&&user) return <RealtimeContext.Provider value={realtimeContextValue}><style>{CSS}</style><ScreenPausedForPayment tasks={tasks} quickTasks={quickTasks} user={user} onBack={()=>setScreen("dash")} onTaskClick={t=>{
  if(t._action==="resume"){
    updateTask(t.id,{pausedForPayment:false,pausedAt:null,pausedBy:null,pausedNote:""});
  } else {
    goTask(t,"pausedForPayment");
  }
}} onQuickTaskClick={qt=>{
  if(qt._action==="resume"){
    updateQuickTask(qt.id,{pausedForPayment:false,pausedAt:null,pausedBy:null,pausedNote:""});
  } else {
    setSelQuickTask(qt);
    setScreen("quickTasks");
  }
}}/></RealtimeContext.Provider>;
```

**4.3 — Agregar botón en menú de navegación** (línea ~1162-1170)

```javascript
// BUSCAR línea ~1162 (dentro de .snav):
<button className="nb" onClick={onStuck}  style={{fontSize:11}}>⏸ Estancadas</button>

// AGREGAR DESPUÉS:
<button className="nb" onClick={onPausedForPayment} style={{fontSize:11,position:"relative"}}>
  💳 Pausadas por pago
  {pausedCount>0&&<span style={{background:"#D97706",color:"#fff",borderRadius:20,fontSize:9,fontWeight:700,padding:"1px 6px",lineHeight:"14px",marginLeft:4}}>{pausedCount}</span>}
</button>
```

**4.4 — Calcular contador** (buscar donde se define unreadAvisos, línea ~5982)

```javascript
// AGREGAR junto a unreadAvisos (línea ~5982):
const pausedCount=user?(tasks.filter(t=>t.pausedForPayment===true).length + quickTasks.filter(qt=>qt.pausedForPayment===true && !qt.deleted).length):0;
```

**4.5 — Pasar props al Dashboard** (línea ~6301-6329)

```javascript
// BUSCAR línea ~6301 (ScreenDashboard):
// AGREGAR en las props:
onPausedForPayment={()=>setScreen("pausedForPayment")}
pausedCount={pausedCount}

// Y en la definición de ScreenDashboard (línea ~1061):
// AGREGAR parámetros:
function ScreenDashboard({..., onPausedForPayment, pausedCount, ...}){
```

---

## PARTE 5 — Notificaciones al Pausar

### **Ubicación:** `updateTask` función (línea ~5576)

**5.1 — Agregar notificación al pausar** (después de línea ~5722, donde están las otras notificaciones)

```javascript
// BUSCAR línea ~5722 (notificaciones de Completada):
// AGREGAR DESPUÉS del bloque de notificaciones:

// Notificación 4: tarea pausada por falta de pago
if(patch.pausedForPayment===true && task.pausedForPayment!==true && user){
  const direccion=USERS.filter(u=>u.dept==="Dirección").map(u=>u.id);
  if(direccion.length>0){
    const pauseMsg=patch.pausedNote?` — Motivo: ${patch.pausedNote}`:""`;
    setTimeout(()=>sendPushNotification(
      direccion,
      "⏸ Tarea pausada por falta de pago",
      `${user.name} pausó: "${task.title}"${pauseMsg}`,
      `/?task=${task.id}`
    ),0);
    // Email a Dirección
    direccion.forEach(id=>{
      const u=USERS.find(x=>x.id===id);
      if(u?.email){
        setTimeout(()=>sendEmailNotification("tarea_pausada_pago",[u.email],{
          userName:u.name,
          taskId:task.id,
          taskTitle:task.title,
          pausedByName:user.name,
          pausedNote:patch.pausedNote||"Sin motivo especificado",
        }),0);
      }
    });
  }
}
```

**5.2 — Mismo para Quick Tasks** (en updateQuickTask, buscar línea ~6144)

```javascript
// BUSCAR updateQuickTask y agregar notificación similar al final:

// Notificación: quick task pausada por falta de pago
if(patch.pausedForPayment===true && qt.pausedForPayment!==true && user){
  const direccion=USERS.filter(u=>u.dept==="Dirección").map(u=>u.id);
  if(direccion.length>0){
    const pauseMsg=patch.pausedNote?` — Motivo: ${patch.pausedNote}`:""`;
    setTimeout(()=>sendPushNotification(
      direccion,
      "⏸ Quick Task pausada por falta de pago",
      `${user.name} pausó: "${qt.title}"${pauseMsg}`,
      `/?quickTask=${qt.id}`
    ),0);
  }
}
```

---

## VERIFICACIONES POST-IMPLEMENTACIÓN

Después de cada parte, ejecutar:

```bash
# Verificar que no rompimos referencias a status:
grep -n "status===" src/App.jsx | grep -v "pausedForPayment"

# Verificar que isActive sigue funcionando:
grep -n "isActive" src/App.jsx

# Verificar importaciones y constantes:
grep -n "pausedForPayment" src/App.jsx

# Verificar que los componentes se importan:
grep -n "ScreenPausedForPayment" src/App.jsx
```

---

## BUILD FINAL

```bash
npm run build
```

---

## RESUMEN DE ARCHIVOS MODIFICADOS

1. `src/App.jsx` — Único archivo modificado
   - **Parte 1:** +~60 líneas (ScreenTaskDetail)
   - **Parte 2:** +~60 líneas (ScreenQuickTasks)
   - **Parte 3:** +~6 líneas (TRow y listas)
   - **Parte 4:** +~150 líneas (nueva pantalla + routing)
   - **Parte 5:** +~30 líneas (notificaciones)
   
   **Total:** ~306 líneas agregadas (sin contar líneas en blanco y comentarios)

---

## ¿PROCEDER CON LA IMPLEMENTACIÓN?

✅ **Confirma antes de aplicar:**
1. Estructura de datos correcta
2. UI/UX de los badges y botones
3. Lógica de notificaciones
4. Nombres de funciones y variables

**Responde "CONFIRMAR" para comenzar con PARTE 1.**
