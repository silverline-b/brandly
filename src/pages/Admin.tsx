import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, LayoutDashboard, DollarSign, Users, Activity, Cpu, Settings } from "lucide-react";
import { AdminOverview } from "@/components/admin/AdminOverview";
import { AdminRevenue } from "@/components/admin/AdminRevenue";
import { AdminUsers } from "@/components/admin/AdminUsers";
import { AdminUsage } from "@/components/admin/AdminUsage";
import { AdminApiCosts } from "@/components/admin/AdminApiCosts";
import { AdminSettings } from "@/components/admin/AdminSettings";

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "revenue", label: "Revenue", icon: DollarSign },
  { id: "users", label: "Users", icon: Users },
  { id: "usage", label: "Usage", icon: Activity },
  { id: "api_costs", label: "API Costs", icon: Cpu },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

type TabId = (typeof TABS)[number]["id"];

const Admin = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  useEffect(() => {
    if (!user) return;
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setIsAdmin(true);
        } else {
          setIsAdmin(false);
          navigate("/dashboard", { replace: true });
        }
      });
  }, [user, navigate]);

  if (authLoading || isAdmin === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-56 border-r border-border bg-card flex flex-col shrink-0">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-bold text-foreground">Brandly Admin</h2>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-6 lg:p-8 overflow-auto">
        <h1 className="text-2xl font-bold text-foreground mb-6">
          {TABS.find((t) => t.id === activeTab)?.label}
        </h1>
        {activeTab === "overview" && <AdminOverview />}
        {activeTab === "revenue" && <AdminRevenue />}
        {activeTab === "users" && <AdminUsers />}
        {activeTab === "usage" && <AdminUsage />}
        {activeTab === "api_costs" && <AdminApiCosts />}
        {activeTab === "settings" && <AdminSettings />}
      </main>
    </div>
  );
};

export default Admin;
