import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useAdminData } from "@/hooks/useAdminData";

type ApiCostsData = {
  totalMonth: string;
  openaiMonth: string;
  serperMonth: string;
  domainrMonth: string;
  avgCostPerRun: string;
  dailySpend: { date: string; openai: number; serper: number; domainr: number; total: number }[];
  highCostRuns: { id: string; email: string; date: string; batches: number; cost: string; status: string }[];
};

export function AdminApiCosts() {
  const { data, loading } = useAdminData<ApiCostsData>("api_costs");

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return <p className="text-muted-foreground">Failed to load data.</p>;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card><CardContent className="py-4"><p className="text-sm text-muted-foreground">Total This Month</p><p className="text-2xl font-bold text-foreground">${data.totalMonth}</p></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-sm text-muted-foreground">OpenAI</p><p className="text-2xl font-bold text-foreground">${data.openaiMonth}</p></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-sm text-muted-foreground">Serper</p><p className="text-2xl font-bold text-foreground">${data.serperMonth}</p></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-sm text-muted-foreground">Domainr</p><p className="text-2xl font-bold text-foreground">${data.domainrMonth}</p></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-sm text-muted-foreground">Avg Cost/Run</p><p className="text-2xl font-bold text-foreground">${data.avgCostPerRun}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <h3 className="text-sm font-medium text-foreground mb-4">Daily Spend (Last 30 Days)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data.dailySpend}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} className="text-xs" />
              <YAxis className="text-xs" tickFormatter={(v) => `$${v}`} />
              <Tooltip formatter={(v: number) => `$${v.toFixed(4)}`} />
              <Area type="monotone" dataKey="openai" stackId="1" fill="hsl(210, 80%, 50%)" stroke="hsl(210, 80%, 50%)" fillOpacity={0.6} name="OpenAI" />
              <Area type="monotone" dataKey="serper" stackId="1" fill="hsl(142, 71%, 45%)" stroke="hsl(142, 71%, 45%)" fillOpacity={0.6} name="Serper" />
              <Area type="monotone" dataKey="domainr" stackId="1" fill="hsl(38, 92%, 50%)" stroke="hsl(38, 92%, 50%)" fillOpacity={0.6} name="Domainr" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">High-Cost Runs (&gt; $1.00)</h3>
        {data.highCostRuns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No high-cost runs found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Run ID</th>
                  <th className="pb-2 font-medium">User</th>
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">Batches</th>
                  <th className="pb-2 font-medium">Cost</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.highCostRuns.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="py-2 font-mono text-xs">{r.id.slice(0, 8)}…</td>
                    <td className="py-2">{r.email}</td>
                    <td className="py-2">{r.date ? new Date(r.date).toLocaleDateString() : "—"}</td>
                    <td className="py-2">{r.batches}</td>
                    <td className="py-2 font-medium">${r.cost}</td>
                    <td className="py-2 capitalize">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-4">Note: No spending caps are active yet. This section is for monitoring and understanding usage during testing.</p>
      </div>
    </div>
  );
}
