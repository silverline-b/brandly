import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search } from "lucide-react";
import { useAdminData } from "@/hooks/useAdminData";

type UsersData = {
  totalUsers: number;
  activeCredits: number;
  exhaustedCredits: number;
  conversionRate: string;
  users: {
    email: string;
    joined: string | null;
    package_id: string | null;
    creditsRemaining: number;
    expiresAt: string | null;
    lastRun: string | null;
  }[];
};

const PAGE_SIZE = 25;

export function AdminUsers() {
  const { data, loading } = useAdminData<UsersData>("users");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    return q ? data.users.filter((u) => u.email.toLowerCase().includes(q)) : data.users;
  }, [data, search]);

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return <p className="text-muted-foreground">Failed to load data.</p>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardContent className="py-4"><p className="text-sm text-muted-foreground">Total Users</p><p className="text-2xl font-bold text-foreground">{data.totalUsers}</p></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-sm text-muted-foreground">Active Credits</p><p className="text-2xl font-bold text-foreground">{data.activeCredits}</p></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-sm text-muted-foreground">Exhausted/Expired</p><p className="text-2xl font-bold text-foreground">{data.exhaustedCredits}</p></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-sm text-muted-foreground">Conversion Rate</p><p className="text-2xl font-bold text-foreground">{data.conversionRate}%</p></CardContent></Card>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search by email..." className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="pb-2 font-medium">Email</th>
              <th className="pb-2 font-medium">Joined</th>
              <th className="pb-2 font-medium">Package</th>
              <th className="pb-2 font-medium">Credits</th>
              <th className="pb-2 font-medium">Expires</th>
              <th className="pb-2 font-medium">Last Run</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((u, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="py-2">{u.email}</td>
                <td className="py-2">{u.joined ? new Date(u.joined).toLocaleDateString() : "—"}</td>
                <td className="py-2 capitalize">{u.package_id || "—"}</td>
                <td className="py-2">{u.creditsRemaining}</td>
                <td className="py-2">{u.expiresAt ? new Date(u.expiresAt).toLocaleDateString() : "—"}</td>
                <td className="py-2">{u.lastRun ? new Date(u.lastRun).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-2 justify-center">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
