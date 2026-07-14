import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CREDITS_MAP: Record<string, number> = { starter: 3, standard: 6, pro: 12 };

serve(async (req) => {
  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2023-10-16" });
  const sig = req.headers.get("stripe-signature");
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig!, Deno.env.get("STRIPE_WEBHOOK_SECRET")!);
  } catch (err: any) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    const userId = pi.metadata.user_id;
    const packageId = pi.metadata.package_id;
    const credits = CREDITS_MAP[packageId] || 0;

    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    await supabase.from("purchases").insert({
      user_id: userId,
      package_id: packageId,
      stripe_payment_intent_id: pi.id,
      credits_total: credits,
      credits_used: 0,
      expires_at: expiresAt.toISOString(),
    });

    await supabase.from("analytics_events").insert({
      event_type: "purchase",
      user_id: userId,
      metadata: { package_id: packageId, amount_usd: pi.amount / 100 },
    });
  }

  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;

    if (piId) {
      const { data: purchase } = await supabase
        .from("purchases")
        .select("id, credits_used, user_id, package_id")
        .eq("stripe_payment_intent_id", piId)
        .single();

      if (purchase) {
        await supabase.from("purchases").update({ credits_total: purchase.credits_used ?? 0 }).eq("id", purchase.id);
        await supabase.from("analytics_events").insert({
          event_type: "refund",
          user_id: purchase.user_id,
          metadata: { package_id: purchase.package_id },
        });
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
