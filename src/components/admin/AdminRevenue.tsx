import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { useAdminData } from "@/hooks/useAdminData";

type RevenueData = {
  byPackage: { name: string; value: number }[];
  transactions: { date: string; email: string; package_id: string; amount: number; stripe_id: string | null }[];
};

const COLORS = ["hsl(var(--primary))", "hsl(var(--destructive))", "hsl(210, 80%, 50%)"];
const RANGES = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "All", days: 99999 },
];

export function AdminRevenue() {
  const { data, loading } = useAdminData<RevenueData>("revenue");
  const [range, setRange] = useState(30);

  const filtered = useMemo(() => {
    if (!data) return [];
    const cutoff = new Date(Date.now() - range * 86400000).toISOString();
    return range >= 99999
      ? data.transactions
      : data.transactions.filter((t) => t.date && t.date >= cutoff);
  }, [data, range]);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return <p className="text-muted-foreground">Failed to load data.</p>;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <h3 className="text-sm font-medium text-foreground mb-4">Revenue by Package</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={data.byPackage} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: $${value.toFixed(0)}`}>
                {data.byPackage.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        {RANGES.map((r) => (
          <Button key={r.label} size="sm" variant={range === r.days ? "default" : "outline"} onClick={() => setRange(r.days)}>
            {r.label}
          </Button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="pb-2 font-medium">Date</th>
              <th className="pb-2 font-medium">User</th>
              <th className="pb-2 font-medium">Package</th>
              <th className="pb-2 font-medium">Amount</th>
              <th className="pb-2 font-medium">Stripe ID</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="py-2">{t.date ? new Date(t.date).toLocaleDateString() : "—"}</td>
                <td className="py-2">{t.email}</td>
                <td className="py-2 capitalize">{t.package_id}</td>
                <td className="py-2">${t.amount.toFixed(2)}</td>
                <td className="py-2 text-xs font-mono text-muted-foreground truncate max-w-[150px]">{t.stripe_id || "—"}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">No transactions in this period.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
