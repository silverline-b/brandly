import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

const PACKAGES = [
  { id: "starter", name: "Starter", price: "$24.99", runs: 3, names: 50, badge: null },
  { id: "standard", name: "Standard", price: "$44.99", runs: 6, names: 50, badge: "Most Popular" },
  { id: "pro", name: "Pro", price: "$79.99", runs: 12, names: 50, badge: "Best value" },
] as const;

export function PricingCards() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleBuy = async (packageId: string) => {
    if (!user) {
      navigate("/login");
      return;
    }
    setLoadingId(packageId);
    try {
      const { data, error } = await supabase.functions.invoke("start-checkout", {
        body: { package_id: packageId },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to start checkout", variant: "destructive" });
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-3">
        {PACKAGES.map((pkg) => (
          <Card
            key={pkg.id}
            className={`relative ${pkg.id === "standard" ? "border-primary ring-1 ring-primary" : ""}`}
          >
            {pkg.badge && (
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">{pkg.badge}</Badge>
            )}
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-lg">{pkg.name}</CardTitle>
              <p className="text-3xl font-bold text-foreground">{pkg.price}</p>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <p className="text-muted-foreground text-sm">
                {pkg.runs} runs × {pkg.names} names
              </p>
              <Button
                className="w-full"
                variant={pkg.id === "standard" ? "default" : "outline"}
                onClick={() => handleBuy(pkg.id)}
                disabled={loadingId === pkg.id}
              >
                {loadingId === pkg.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Get started
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Credits expire 12 months from purchase · Not a subscription · Pay once, use when you need it
      </p>
    </div>
  );
}
