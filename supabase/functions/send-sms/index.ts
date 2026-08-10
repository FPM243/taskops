import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Rate limiting: 1 SMS por segundo (Twilio límite estándar)
const RATE_LIMIT_MS = 1000;

interface SmsResult {
  to: string;
  success: boolean;
  sid?: string;
  error?: any;
  errorCode?: string;
}

async function sendSms(to: string, message: string): Promise<SmsResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const body = new URLSearchParams({
    To: to,
    From: TWILIO_PHONE_NUMBER ?? "",
    Body: message,
  });

  try {
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
      console.error(`[SMS] ✗ Error enviando a ${to}:`, JSON.stringify(data));
      return {
        to,
        success: false,
        error: data.message || data.detail || "Unknown error",
        errorCode: data.code || String(res.status),
      };
    }

    console.log(`[SMS] ✓ Enviado a ${to}, SID: ${data.sid}`);
    return { to, success: true, sid: data.sid };

  } catch (err: any) {
    console.error(`[SMS] ✗ Excepción enviando a ${to}:`, err.message);
    return {
      to,
      success: false,
      error: err.message,
      errorCode: "EXCEPTION",
    };
  }
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
    console.log(`[SMS] Received request - type: ${type}, recipients: ${to?.length || 0}`);

    if (!to || !to.length) {
      return new Response(JSON.stringify({ error: "No recipients" }), {
        status: 400,
        headers: corsHeaders
      });
    }

    // Validación defensiva: asegurar que data existe
    if (!data || typeof data !== 'object') {
      console.error("[SMS] data es inválido:", data);
      return new Response(JSON.stringify({ error: "Invalid data payload" }), {
        status: 400,
        headers: corsHeaders
      });
    }

    // Validar credenciales de Twilio
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
      console.error("[SMS] Credenciales de Twilio no configuradas");
      return new Response(JSON.stringify({ error: "Twilio no configurado" }), {
        status: 500,
        headers: corsHeaders
      });
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

      case "aviso": {
        const textoSafe = String(data.texto || "Sin texto");
        message = `NEXUS: Aviso de ${data.fromName || "—"} (${data.fromDept || "—"}): ${textoSafe}. Ver: ${APP}/?aviso=${data.avisoId}`;
        break;
      }

      case "nuevo_comentario":
        message = `NEXUS: Nuevo comentario de ${data.commenterName} en "${data.taskTitle}": ${data.commentText}. ${APP}/?task=${data.taskId}`;
        break;

      case "deadline_proximo":
        message = `NEXUS: Tu tarea vence pronto, ${data.userName}. ${data.taskTitle}. Limite: ${data.deadline} (${data.hoursLeft}h). ${APP}/?task=${data.taskId}`;
        break;

      default:
        return new Response(JSON.stringify({ error: "Unknown type" }), {
          status: 400,
          headers: corsHeaders
        });
    }

    // Validar longitud del mensaje (Twilio límite: 1600 caracteres)
    if (message.length > 1600) {
      message = message.substring(0, 1597) + "...";
      console.warn("[SMS] Mensaje truncado a 1600 caracteres");
    }

    // Enviar SMS con rate limiting
    const results: SmsResult[] = [];
    for (let i = 0; i < to.length; i++) {
      const phone = to[i];

      // Enviar SMS
      const result = await sendSms(phone, message);
      results.push(result);

      // Rate limiting: esperar entre envíos (excepto en el último)
      if (i < to.length - 1) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
      }
    }

    const sent = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success);

    // Log detallado de resultados
    console.log(`[SMS] Resumen: ${sent}/${to.length} enviados exitosamente`);
    if (failed.length > 0) {
      console.warn(`[SMS] ${failed.length} SMS fallaron:`,
        JSON.stringify(failed.map(f => ({ to: f.to, error: f.error, code: f.errorCode })), null, 2));
    }

    return new Response(JSON.stringify({
      ok: true,
      sent,
      total: to.length,
      results, // Incluye detalle completo para debugging
    }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });

  } catch (err: any) {
    console.error("[SMS] Error fatal:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
});
