import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendSms(to: string, message: string) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const body = new URLSearchParams({
    To: to,
    From: TWILIO_PHONE_NUMBER ?? "",
    Body: message,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("[SMS] Error sending to", to, ":", JSON.stringify(data));
    return { to, success: false, error: data };
  }
  console.log("[SMS] Sent to:", to, "sid:", data.sid);
  return { to, success: true, sid: data.sid };
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { type, to, data } = await req.json();

    if (!to || !to.length) {
      return new Response(JSON.stringify({ error: "No recipients" }), { status: 400, headers: corsHeaders });
    }

    let message = "";

    const APP = "https://taskops-kappa.vercel.app";

    switch (type) {
      case "nueva_tarea":
        message = `NEXUS: Nueva tarea para ${data.userName}: ${data.taskTitle}. Prioridad ${data.priority}. Vence ${data.deadline}. ${APP}/?task=${data.taskId}`;
        break;

      case "tu_turno":
        message = `NEXUS: Es tu turno, ${data.userName}. Tarea: ${data.taskTitle}. ${data.prevUserName} completo su etapa. Inicia: ${APP}/?task=${data.taskId}&action=start`;
        break;

      case "preparate":
        message = `NEXUS: Preparate ${data.userName}, tu turno se acerca. Tarea: ${data.taskTitle}. ${data.prevUserName} esta en proceso. Ver: ${APP}/?task=${data.taskId}`;
        break;

      case "avance_flujo":
        message = `NEXUS: Avance en "${data.taskTitle}". ${data.whoName} (${data.whoDept}) cambio su etapa a: ${data.newState}. ${APP}/?task=${data.taskId}`;
        break;

      case "tarea_completada":
        message = `NEXUS: Tarea completada: ${data.taskTitle}. Completada por: ${data.completedBy}. ${APP}/?task=${data.taskId}`;
        break;

      case "tarea_bloqueada":
        message = `NEXUS: Tarea bloqueada: ${data.taskTitle}. Bloqueada por: ${data.blockedBy}. Razon: ${data.reason}. Atender: ${APP}/?task=${data.taskId}`;
        break;

      case "aviso":
        message = `NEXUS: Aviso de ${data.fromName} (${data.fromDept}): ${data.texto}`;
        break;

      case "nuevo_comentario":
        message = `NEXUS: Nuevo comentario de ${data.commenterName} en "${data.taskTitle}": ${data.commentText}. ${APP}/?task=${data.taskId}`;
        break;

      case "deadline_proximo":
        message = `NEXUS: Tu tarea vence pronto, ${data.userName}. ${data.taskTitle}. Limite: ${data.deadline} (${data.hoursLeft}h). ${APP}/?task=${data.taskId}`;
        break;

      default:
        return new Response(JSON.stringify({ error: "Unknown type" }), { status: 400, headers: corsHeaders });
    }

    // Send to all recipients
    const results = await Promise.all(
      to.map((phone: string) => sendSms(phone, message))
    );
    const sent = results.filter((r) => r.success).length;

    return new Response(JSON.stringify({ ok: true, sent, total: to.length, results }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });

  } catch (err) {
    console.error("[SMS] Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders
    });
  }
});
