import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useAdminData } from "@/hooks/useAdminData";

type UsageData = {
  totalRuns: number;
  runsThisMonth: number;
  successRate: string;
  avgResults: string;
  avgBatches: string;
  runsPerDay: { date: string; count: number }[];
  starsDist: { stars: number; count: number }[];
  tldDist: { tld: string; count: number }[];
  statusBreakdown: { status: string; count: number }[];
};

const STATUS_COLORS: Record<string, string> = {
  complete: "hsl(142, 71%, 45%)",
  partial_complete: "hsl(38, 92%, 50%)",
  failed: "hsl(0, 84%, 60%)",
  pending: "hsl(210, 80%, 50%)",
  running: "hsl(210, 80%, 50%)",
};

export function AdminUsage() {
  const { data, loading } = useAdminData<UsageData>("usage");

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return <p className="text-muted-foreground">Failed to load data.</p>;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card><CardContent className="py-4"><p className="text-sm text-muted-foreground">Total Runs</p><p className="text-2xl font-bold text-foreground">{data.totalRuns}</p></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-sm text-muted-foreground">This Month</p><p className="text-2xl font-bold text-foreground">{data.runsThisMonth}</p></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-sm text-muted-foreground">Success Rate</p><p className="text-2xl font-bold text-foreground">{data.successRate}%</p></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-sm text-muted-foreground">Avg Results</p><p className="text-2xl font-bold text-foreground">{data.avgResults}</p></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-sm text-muted-foreground">Avg Batches</p><p className="text-2xl font-bold text-foreground">{data.avgBatches}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <h3 className="text-sm font-medium text-foreground mb-4">Runs per Day (Last 30 Days)</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.runsPerDay}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} className="text-xs" />
              <YAxis className="text-xs" />
              <Tooltip />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-medium text-foreground mb-4">Min Stars Filter Distribution</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.starsDist}>
                <XAxis dataKey="stars" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-medium text-foreground mb-4">TLD Selections</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.tldDist.slice(0, 10)} layout="vertical">
                <XAxis type="number" />
                <YAxis type="category" dataKey="tld" width={50} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <h3 className="text-sm font-medium text-foreground mb-4">Run Status Breakdown</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={data.statusBreakdown} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={80} label={({ status, count }) => `${status}: ${count}`}>
                {data.statusBreakdown.map((entry) => (
                  <Cell key={entry.status} fill={STATUS_COLORS[entry.status] || "hsl(var(--muted-foreground))"} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
