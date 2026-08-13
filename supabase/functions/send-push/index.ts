import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.6";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const { userIds, title, body, url = "/" } = await req.json();

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0, total: 0 }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // VAPID setup
    const vapidPublic  = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
    if (!vapidPublic || !vapidPrivate) {
      throw new Error("VAPID keys no configuradas en variables de entorno");
    }
    webpush.setVapidDetails("mailto:admin@taskops.app", vapidPublic, vapidPrivate);

    // Supabase admin client
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch push tokens for the requested userIds
    const { data: tokens, error: dbErr } = await supabase
      .from("push_tokens")
      .select("id, subscription")
      .in("id", userIds.map(String));

    if (dbErr) throw new Error(dbErr.message);

    if (!tokens || tokens.length === 0) {
      console.log("[send-push] No se encontraron tokens para userIds:", userIds);
      return new Response(JSON.stringify({ sent: 0, total: 0 }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.stringify({ title, body, url });
    let sent = 0;
    const expired: string[] = [];
    const failed: Array<{ userId: string, error: string }> = [];
    const userFailureMap = new Map<string, { total: number, failed: number }>();

    // Inicializar contador de fallos por usuario
    for (const userId of userIds.map(String)) {
      userFailureMap.set(userId, { total: 0, failed: 0 });
    }

    for (const token of tokens) {
      const userId = String(token.id);
      const stats = userFailureMap.get(userId);
      if (stats) stats.total++;

      try {
        const subscription = typeof token.subscription === "string"
          ? JSON.parse(token.subscription)
          : token.subscription;

        await webpush.sendNotification(subscription, payload, {
          TTL: 86400, // TTL de 24 horas (86400 segundos)
        });
        sent++;
        console.log(`[send-push] ✓ Enviado a user ${token.id}`);
      } catch (err: any) {
        const statusCode = err.statusCode || 0;
        const errorMsg = err.message || String(err);

        console.error(`[send-push] ✗ Fallo para user ${token.id}: ${statusCode} ${errorMsg}`);

        // Incrementar contador de fallos para este usuario
        if (stats) stats.failed++;

        // 410 Gone / 404 Not Found → subscription expirada
        if (statusCode === 410 || statusCode === 404) {
          expired.push(token.id);
          console.log(`[send-push] → Token expirado, marcado para eliminación: ${token.id}`);
        }
        // 400 Bad Request / 401 Unauthorized → token inválido
        else if (statusCode === 400 || statusCode === 401) {
          expired.push(token.id);
          console.log(`[send-push] → Token inválido, marcado para eliminación: ${token.id}`);
        }
        // Otros errores (network, timeout, etc.) → solo loguear, no eliminar
        else {
          failed.push({ userId: token.id, error: `${statusCode}: ${errorMsg}` });
        }
      }
    }

    // Limpiar subscriptions expiradas/inválidas
    if (expired.length > 0) {
      const { error: deleteErr } = await supabase
        .from("push_tokens")
        .delete()
        .in("id", expired);

      if (deleteErr) {
        console.error("[send-push] Error al eliminar tokens expirados:", deleteErr.message);
      } else {
        console.log(`[send-push] ✓ Eliminados ${expired.length} tokens expirados/inválidos`);
      }
    }

    // Log de errores no fatales (network, etc.)
    if (failed.length > 0) {
      console.warn(`[send-push] ${failed.length} notificaciones fallaron (errores no-token):`,
        JSON.stringify(failed, null, 2));
    }

    // Detectar usuarios con >50% de fallos y marcarlos para re-registro
    const usersNeedingReRegistration: string[] = [];
    for (const [userId, stats] of userFailureMap.entries()) {
      if (stats.total > 0 && (stats.failed / stats.total) > 0.5) {
        usersNeedingReRegistration.push(userId);
        console.warn(`[send-push] ⚠️ Usuario ${userId} tiene ${stats.failed}/${stats.total} tokens fallidos (>${50}%) - requiere re-registro`);
      }
    }

    // Marcar usuarios para re-registro (crear/actualizar flag en tabla)
    if (usersNeedingReRegistration.length > 0) {
      try {
        const { error: flagErr } = await supabase
          .from("push_tokens")
          .update({ needs_reregister: true })
          .in("id", usersNeedingReRegistration);

        if (flagErr) {
          console.error("[send-push] Error marcando usuarios para re-registro:", flagErr.message);
        } else {
          console.log(`[send-push] ✓ Marcados ${usersNeedingReRegistration.length} usuarios para re-registro`);
        }
      } catch (err: any) {
        console.error("[send-push] Error al marcar para re-registro:", err.message);
      }
    }

    return new Response(
      JSON.stringify({
        sent,
        total: tokens.length,
        expired: expired.length,
        failed: failed.length,
        needsReRegistration: usersNeedingReRegistration.length
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[send-push] Error fatal:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
