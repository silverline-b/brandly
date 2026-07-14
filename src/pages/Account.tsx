import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { PricingCards } from "@/components/PricingCards";

type Purchase = {
  id: string;
  package_id: string;
  credits_total: number;
  credits_used: number | null;
  purchased_at: string | null;
  expires_at: string | null;
};

type RunRow = {
  id: string;
  product_description: string;
  status: string | null;
  results_count: number | null;
  batches_run: number | null;
  created_at: string | null;
};

function AccountSkeleton() {
  return (
    <div className="space-y-10">
      <div><Skeleton className="h-9 w-40 mb-2" /><Skeleton className="h-5 w-60" /></div>
      <Skeleton className="h-40 rounded-lg" />
      <Skeleton className="h-40 rounded-lg" />
      <Skeleton className="h-40 rounded-lg" />
    </div>
  );
}

const Account = () => {
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Payment cancelled toast
  useEffect(() => {
    const payment = searchParams.get("payment");
    if (payment === "cancelled") {
      toast({ title: "Payment not completed", description: "You have not been charged.", variant: "destructive" });
      searchParams.delete("payment");
      setSearchParams(searchParams, { replace: true });
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase.from("purchases").select("id, package_id, credits_total, credits_used, purchased_at, expires_at").eq("user_id", user.id).order("purchased_at", { ascending: false }),
      supabase.from("runs").select("id, product_description, status, results_count, batches_run, created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
    ]).then(([pRes, rRes]) => {
      if (pRes.data) setPurchases(pRes.data as Purchase[]);
      if (rRes.data) setRuns(rRes.data as RunRow[]);
      setLoading(false);
    });
  }, [user]);

  const handleChangePassword = async () => {
    if (!user?.email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/account`,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Check your email", description: "We sent you a password reset link." });
    }
  };

  if (authLoading || loading) {
    return (
      <div className="py-8 px-4">
        <div className="mx-auto max-w-4xl"><AccountSkeleton /></div>
      </div>
    );
  }

  if (!user) return null;

  const getPurchaseStatus = (p: Purchase) => {
    if (p.expires_at && new Date(p.expires_at) < new Date()) return "expired";
    if ((p.credits_used ?? 0) >= p.credits_total) return "exhausted";
    return "active";
  };

  return (
    <div className="py-8 px-4">
      <div className="mx-auto max-w-4xl space-y-10">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Account</h1>
          <p className="text-muted-foreground mt-1">Manage your profile, credits, and runs</p>
        </div>

        {/* Profile */}
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm"><span className="text-muted-foreground">Name:</span> {user.user_metadata?.full_name || "—"}</p>
            <p className="text-sm"><span className="text-muted-foreground">Email:</span> {user.email}</p>
            <button onClick={handleChangePassword} className="text-sm text-primary hover:underline" aria-label="Send password reset email">Change Password</button>
          </CardContent>
        </Card>

        {/* Credits */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>My Credits</CardTitle>
          </CardHeader>
          <CardContent>
            {purchases.length === 0 ? (
              <p className="text-muted-foreground text-sm">No purchases yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="pb-2 font-medium">Package</th>
                      <th className="pb-2 font-medium">Credits</th>
                      <th className="pb-2 font-medium">Purchased</th>
                      <th className="pb-2 font-medium">Expires</th>
                      <th className="pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.map((p) => {
                      const status = getPurchaseStatus(p);
                      return (
                        <tr key={p.id} className="border-b border-border last:border-0">
                          <td className="py-2 capitalize">{p.package_id}</td>
                          <td className="py-2">{p.credits_used ?? 0}/{p.credits_total}</td>
                          <td className="py-2">{p.purchased_at ? new Date(p.purchased_at).toLocaleDateString() : "—"}</td>
                          <td className="py-2">{p.expires_at ? new Date(p.expires_at).toLocaleDateString() : "—"}</td>
                          <td className="py-2">
                            <Badge variant={status === "active" ? "default" : "secondary"}>
                              {status}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Run History */}
        <Card>
          <CardHeader><CardTitle>Run History</CardTitle></CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <p className="text-muted-foreground text-sm">No runs yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium">Description</th>
                      <th className="pb-2 font-medium">Batches</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium">Results</th>
                      <th className="pb-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id} className="border-b border-border last:border-0">
                        <td className="py-2">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</td>
                        <td className="py-2 max-w-[200px] truncate">{r.product_description}</td>
                        <td className="py-2">{r.batches_run ?? 0}</td>
                        <td className="py-2">
                          <Badge variant={r.status === "complete" ? "default" : "secondary"}>
                            {r.status?.replace("_", " ") ?? "unknown"}
                          </Badge>
                        </td>
                        <td className="py-2">{r.results_count ?? 0}</td>
                        <td className="py-2">
                          <Link to={`/runs/${r.id}`} className="text-primary text-xs hover:underline" aria-label={`View run details for ${r.product_description}`}>View →</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pricing */}
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-4">Buy More Credits</h2>
          <PricingCards />
        </div>
      </div>
    </div>
  );
};

export default Account;
