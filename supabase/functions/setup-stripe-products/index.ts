import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

serve(async () => {
  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2023-10-16" });

  const products = [
    { name: "Brandly Starter", price: 2499, id: "starter" },
    { name: "Brandly Standard", price: 4499, id: "standard" },
    { name: "Brandly Pro", price: 7999, id: "pro" },
  ];

  const results: Record<string, string> = {};

  for (const p of products) {
    const product = await stripe.products.create({ name: p.name, metadata: { package_id: p.id } });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: p.price,
      currency: "usd",
    });
    results[p.id] = price.id;
  }

  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json" },
  });
});
