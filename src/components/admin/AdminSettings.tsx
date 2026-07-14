import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { useAdminData } from "@/hooks/useAdminData";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type SettingsData = {
  todaySpend: number;
  admins: string[];
  contactMessages: {
    id: string;
    created_at: string | null;
    name: string;
    email: string;
    subject: string;
    message: string;
  }[];
};

export function AdminSettings() {
  const { data, loading, refetch } = useAdminData<SettingsData>("settings");
  const { toast } = useToast();
  const [grantEmail, setGrantEmail] = useState("");
  const [granting, setGranting] = useState(false);

  const handleGrantAdmin = async () => {
    if (!grantEmail.trim()) return;
    setGranting(true);
    try {
      const { data: result, error } = await supabase.functions.invoke("admin-stats", {
        body: { report: "grant_admin", email: grantEmail.trim() },
      });
      if (error) throw error;
      if (result?.error) throw new Error(result.error);
      toast({ title: "Admin granted", description: `${grantEmail} is now an admin.` });
      setGrantEmail("");
      refetch();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setGranting(false);
    }
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return <p className="text-muted-foreground">Failed to load data.</p>;

  return (
    <div className="space-y-8">
      {/* Cost Controls */}
      <Card>
        <CardHeader><CardTitle>Cost Controls</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Badge variant="secondary">Monitoring only — limits not yet active</Badge>
          <p className="text-sm text-muted-foreground">Estimated cost per run range: $0.38–$0.50</p>
          <p className="text-sm text-muted-foreground">Daily spend (today): <span className="font-medium text-foreground">${Number(data.todaySpend).toFixed(2)}</span> — shown as info only, no cap enforced</p>
        </CardContent>
      </Card>

      {/* Make User Admin */}
      <Card>
        <CardHeader><CardTitle>Make User Admin</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input placeholder="user@example.com" value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)} className="max-w-sm" />
            <Button onClick={handleGrantAdmin} disabled={granting || !grantEmail.trim()}>
              {granting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Grant Admin Access
            </Button>
          </div>
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Current Admins</p>
            {data.admins.length === 0 ? (
              <p className="text-sm text-muted-foreground">No admins configured.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.admins.map((email) => (
                  <Badge key={email} variant="outline">{email}</Badge>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Contact Messages */}
      <Card>
        <CardHeader><CardTitle>Contact Messages</CardTitle></CardHeader>
        <CardContent>
          {data.contactMessages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contact messages.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Date</th>
                    <th className="pb-2 font-medium">Name</th>
                    <th className="pb-2 font-medium">Email</th>
                    <th className="pb-2 font-medium">Subject</th>
                    <th className="pb-2 font-medium">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {data.contactMessages.map((msg) => (
                    <tr key={msg.id} className="border-b border-border last:border-0">
                      <td className="py-2">{msg.created_at ? new Date(msg.created_at).toLocaleDateString() : "—"}</td>
                      <td className="py-2">{msg.name}</td>
                      <td className="py-2">{msg.email}</td>
                      <td className="py-2">{msg.subject}</td>
                      <td className="py-2 max-w-[300px] truncate">{msg.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
