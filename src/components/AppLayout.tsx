import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Menu, X, User, LogOut, Sparkles, LayoutDashboard } from "lucide-react";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [credits, setCredits] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("purchases")
      .select("credits_total, credits_used")
      .eq("user_id", user.id)
      .gte("expires_at", new Date().toISOString())
      .then(({ data }) => {
        if (data) {
          const avail = data.reduce((s, p) => s + (p.credits_total - (p.credits_used ?? 0)), 0);
          setCredits(avail);
        } else {
          setCredits(0);
        }
      });
  }, [user]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const initials = user?.user_metadata?.full_name
    ? user.user_metadata.full_name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
    : user?.email?.slice(0, 2).toUpperCase() || "U";

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top nav */}
      <header className="border-b border-border bg-card sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          {/* Left: Logo */}
          <Link
            to="/dashboard"
            className="text-lg font-bold text-foreground tracking-tight flex items-center gap-2"
            aria-label="Go to dashboard"
          >
            <Sparkles className="h-5 w-5 text-primary" />
            Brandly
          </Link>

          {/* Centre: Nav links (desktop) */}
          <nav className="hidden sm:flex items-center gap-1" aria-label="Main navigation">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/new-run">New Run</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/dashboard">My Runs</Link>
            </Button>
          </nav>

          {/* Right: Credits + Avatar */}
          <div className="hidden sm:flex items-center gap-3">
            {credits === null ? (
              <Skeleton className="h-6 w-20 rounded-full" />
            ) : (
              <Badge
                variant="outline"
                className={`text-xs font-medium ${
                  credits > 0
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                    : "border-border bg-muted text-muted-foreground"
                }`}
                aria-label={`${credits} credits remaining`}
              >
                {credits} credit{credits !== 1 ? "s" : ""}
              </Badge>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full" aria-label="User menu">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs bg-primary/10 text-primary">{initials}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild>
                  <Link to="/account" className="flex items-center gap-2">
                    <User className="h-4 w-4" /> Account
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="flex items-center gap-2 text-destructive focus:text-destructive">
                  <LogOut className="h-4 w-4" /> Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Mobile hamburger */}
          <Button
            variant="ghost"
            size="icon"
            className="sm:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="sm:hidden border-t border-border bg-card px-4 py-3 space-y-2">
            <Link
              to="/new-run"
              className="block px-3 py-2 rounded-md text-sm text-foreground hover:bg-muted"
              onClick={() => setMobileMenuOpen(false)}
            >
              New Run
            </Link>
            <Link
              to="/dashboard"
              className="block px-3 py-2 rounded-md text-sm text-foreground hover:bg-muted"
              onClick={() => setMobileMenuOpen(false)}
            >
              My Runs
            </Link>
            <Link
              to="/account"
              className="block px-3 py-2 rounded-md text-sm text-foreground hover:bg-muted"
              onClick={() => setMobileMenuOpen(false)}
            >
              Account
            </Link>
            <div className="flex items-center justify-between px-3 py-2">
              {credits !== null && (
                <Badge
                  variant="outline"
                  className={`text-xs ${credits > 0 ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-border bg-muted text-muted-foreground"}`}
                >
                  {credits} credit{credits !== 1 ? "s" : ""}
                </Badge>
              )}
              <button onClick={handleSignOut} className="text-sm text-destructive hover:underline">
                Sign Out
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Main content */}
      <main className="flex-1">{children}</main>

      {/* Disclaimer footer */}
      <footer className="border-t border-border py-4 px-4">
        <p className="text-center text-xs text-muted-foreground">
          Brandly results are informational only and do not constitute legal advice. © {new Date().getFullYear()} Silverline Brands LLC
        </p>
      </footer>
    </div>
  );
}
