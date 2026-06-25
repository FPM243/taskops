import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ---- Config: ids/roles a ajustar si cambian en NEXUS ----
// IMPORTANTE: esta lista debe mantenerse en sync con la constante USERS en App.jsx.
// Vive duplicada aquí porque este Edge Function corre en el servidor y no tiene
// acceso al bundle del frontend. Si agregas/quitas/editas usuarios en App.jsx,
// actualiza esta misma lista aquí.
const USERS = [
  {id:1,  name:"Dir. General",               email:"agbaxter@fpm.com.mx",        dept:"Dirección"},
  {id:2,  name:"Gerente de Ingeniería",      email:"ingenieria@fpm.com.mx",      dept:"Ingenieria"},
  {id:3,  name:"Gerente de Calidad",         email:"calidad@fpm.com.mx",         dept:"Calidad"},
  {id:4,  name:"Gerente de Producción",      email:"administracion@fpm.com.mx",  dept:"Producción"},
  {id:5,  name:"Gerente de Compras",         email:"compras@fpm.com.mx",         dept:"Compras"},
  {id:6,  name:"Gerente de Logística",       email:"logistica@fpm.com.mx",       dept:"Logistica/IT"},
  {id:7,  name:"Gerente de Finanzas",        email:"cmartinez@fpm.com.mx",       dept:"Finanzas"},
  {id:8,  name:"Mantenimiento",              email:"mpacheco@fpm.com.mx",        dept:"Mantenimiento"},
  {id:9,  name:"SMT",                        email:"smt@fpm.com.mx",             dept:"SMT"},
  {id:10, name:"Gerente de RR.HH",           email:"recursoshumanos@fpm.com.mx", dept:"RR.HH"},
  {id:11, name:"Supervisor de Calidad",      email:"icc@fpm.com.mx",             dept:"Calidad"},
  {id:12, name:"Inspector de Calidad",       email:"auxcalidad@fpm.com.mx",      dept:"Calidad"},
  {id:13, name:"Supervisor V",               email:"produccion@fpm.com.mx",      dept:"Producción"},
  {id:14, name:"Supervisor N",               email:"produccion@fpm.com.mx",      dept:"Producción"},
  {id:15, name:"Supervisor E",               email:"produccion@fpm.com.mx",      dept:"Producción"},
  {id:16, name:"Almacén",                    email:"almacen@fpm.com.mx",         dept:"Logistica/IT"},
  {id:17, name:"Cobranza",                   email:"cobranzas@fpm.com.mx",       dept:"Finanzas"},
  {id:18, name:"Investigación y Desarrollo", email:"laboratorio@fpm.com.mx",     dept:"Investigación y Desarrollo"},
  {id:19, name:"Recepción",                  email:"recepcion@fpm.com.mx",       dept:"Recepción"},
];
const usersById = new Map(USERS.map((u) => [u.id, u]));

function todayISO() {
  // Fecha del día actual en formato YYYY-MM-DD (UTC, suficiente para dedupe diario)
  return new Date().toISOString().slice(0, 10);
}

function isActiveStatus(status) {
  return status && status !== "Completada" && status !== "Cancelada";
}

async function alreadyNotifiedToday(taskId, type) {
  const { data, error } = await supabase
    .from("notification_log")
    .select("id")
    .eq("task_id", taskId)
    .eq("notification_type", type)
    .eq("sent_date", todayISO())
    .maybeSingle();
  if (error) {
    console.error("[daily-cron] Error checking notification_log:", error.message);
    return false; // si falla la lectura, preferimos intentar enviar antes que silenciar todo
  }
  return !!data;
}

async function logNotification(taskId, type) {
  const { error } = await supabase
    .from("notification_log")
    .insert({ task_id: taskId, notification_type: type, sent_date: todayISO() });
  if (error && error.code !== "23505") {
    // 23505 = unique_violation, esperado si hay carrera; cualquier otro error sí se reporta
    console.error("[daily-cron] Error logging notification:", error.message);
  }
}

async function callSendEmail(type, to, data) {
  if (!to || !to.length) return;
  try {
    const { error } = await supabase.functions.invoke("send-email", {
      body: { type, to, data },
    });
    if (error) console.error(`[daily-cron] send-email error (${type}):`, error.message);
  } catch (err) {
    console.error(`[daily-cron] Exception invoking send-email (${type}):`, err.message);
  }
}

async function callSendPush(userIds: number[], title: string, body: string, url: string) {
  if (!userIds || !userIds.length) return;
  try {
    const { error } = await supabase.functions.invoke("send-push", {
      body: { userIds: userIds.map(String), title, body, url },
    });
    if (error) console.error("[daily-cron] send-push error:", error.message);
  } catch (err) {
    console.error("[daily-cron] Exception invoking send-push:", (err as Error).message);
  }
}

serve(async (req) => {
  try {
    // Cargar todas las tareas y usuarios necesarios
    const { data: taskRows, error: tasksErr } = await supabase.from("tasks").select("id, data");
    if (tasksErr) throw new Error("Error leyendo tasks: " + tasksErr.message);

    const tasks = (taskRows || []).map((r) => ({ id: r.id, ...r.data }));

    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    let deadlineProximoCount = 0;
    let tareaVencidaCount = 0;
    const proximas = [];
    const vencidas = [];

    for (const task of tasks) {
      if (!isActiveStatus(task.status) || !task.deadline) continue;

      const dl = new Date(task.deadline + "T23:59:59");
      const hoursLeft = (dl - now) / (1000 * 60 * 60);
      const responsibleName = task.responsible?.name || "—";

      // --- deadline_proximo: 0 < horas restantes <= 48 ---
      if (hoursLeft > 0 && hoursLeft <= 48) {
        const already = await alreadyNotifiedToday(task.id, "deadline_proximo");
        if (!already) {
          if (task.responsible?.id) {
            await callSendPush(
              [task.responsible.id],
              `⏰ Tarea vence en ${Math.round(hoursLeft)}h`,
              task.title,
              `/?task=${task.id}`
            );
          }
          proximas.push({
            taskId: task.id,
            taskTitle: task.title,
            responsible: responsibleName,
            deadline: task.deadline,
          });
          await logNotification(task.id, "deadline_proximo");
          deadlineProximoCount++;
        }
      }

      // --- tarea_vencida: ya pasó la fecha límite, status sigue activo ---
      if (hoursLeft <= 0) {
        const daysLate = Math.max(1, Math.ceil(Math.abs(hoursLeft) / 24));
        const already = await alreadyNotifiedToday(task.id, "tarea_vencida");
        if (!already) {
          if (task.responsible?.id) {
            await callSendPush(
              [task.responsible.id],
              "⚠️ Tarea vencida",
              task.title,
              `/?task=${task.id}`
            );
          }
          vencidas.push({
            taskId: task.id,
            taskTitle: task.title,
            responsible: responsibleName,
            daysLate,
          });
          await logNotification(task.id, "tarea_vencida");
          tareaVencidaCount++;
        }
      }
    }

    // Resumen único a Dirección, en vez de un correo por tarea.
    let resumenEnviado = false;
    if (proximas.length > 0 || vencidas.length > 0) {
      const direccionEmails = USERS.filter((u) => u.dept === "Dirección" && u.email).map((u) => u.email);
      if (direccionEmails.length > 0) {
        await callSendEmail("resumen_deadlines", direccionEmails, { proximas, vencidas });
        resumenEnviado = true;
      }
    }

    const summary = {
      ok: true,
      deadlineProximoEnviados: deadlineProximoCount,
      tareaVencidaEnviados: tareaVencidaCount,
      resumenEnviado,
    };
    console.log("[daily-cron] Resultado:", JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[daily-cron] Error fatal:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
