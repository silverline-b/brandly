import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useAdminData } from "@/hooks/useAdminData";

type OverviewData = {
  totalRevenue: number;
  revenueThisMonth: number;
  totalUsers: number;
  newUsersThisMonth: number;
  completedRuns: number;
  runsThisMonth: number;
  dailyChart: { date: string; revenue: number; newUsers: number }[];
};

const KPI = ({ label, value }: { label: string; value: string | number }) => (
  <Card>
    <CardContent className="py-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
    </CardContent>
  </Card>
);

export function AdminOverview() {
  const { data, loading } = useAdminData<OverviewData>("overview");

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return <p className="text-muted-foreground">Failed to load data.</p>;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KPI label="Total Revenue" value={`$${data.totalRevenue.toFixed(2)}`} />
        <KPI label="Revenue This Month" value={`$${data.revenueThisMonth.toFixed(2)}`} />
        <KPI label="Total Users" value={data.totalUsers} />
        <KPI label="New Users This Month" value={data.newUsersThisMonth} />
        <KPI label="Completed Runs" value={data.completedRuns} />
        <KPI label="Runs This Month" value={data.runsThisMonth} />
      </div>

      <Card>
        <CardContent className="pt-6">
          <h3 className="text-sm font-medium text-foreground mb-4">Last 30 Days</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data.dailyChart}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} className="text-xs" />
              <YAxis yAxisId="left" className="text-xs" />
              <YAxis yAxisId="right" orientation="right" className="text-xs" />
              <Tooltip />
              <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" name="Revenue ($)" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="newUsers" stroke="hsl(var(--destructive))" name="New Users" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
