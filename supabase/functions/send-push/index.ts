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

    const payload = JSON.stringify({ title, body, url });
    let sent = 0;
    const expired: string[] = [];

    for (const token of tokens ?? []) {
      try {
        await webpush.sendNotification(
          typeof token.subscription === "string"
            ? JSON.parse(token.subscription)
            : token.subscription,
          payload
        );
        sent++;
      } catch (err: any) {
        console.error(`[send-push] Fallo para user ${token.id}: ${err.statusCode} ${err.message}`);
        // 410 Gone / 404 Not Found → subscription expirada, eliminar
        if (err.statusCode === 410 || err.statusCode === 404) {
          expired.push(token.id);
        }
      }
    }

    // Limpiar subscriptions expiradas
    if (expired.length > 0) {
      await supabase.from("push_tokens").delete().in("id", expired);
      console.log(`[send-push] Eliminadas ${expired.length} subscriptions expiradas`);
    }

    return new Response(
      JSON.stringify({ sent, total: (tokens ?? []).length }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[send-push] Error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
