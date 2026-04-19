import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { MessageSquare, CloudSun, FileText, User, Shield, LogOut, LogIn } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/app", label: "Assistant", icon: MessageSquare, end: true },
  { to: "/app/forecast", label: "Forecast Watch", icon: CloudSun },
  { to: "/app/plans", label: "Plans", icon: FileText },
  { to: "/app/profile", label: "Profile", icon: User },
];

export default function AppShell() {
  const { user, isGuest, signOut, setGuest } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex h-screen w-full bg-background">
      <aside className="hidden md:flex w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <div className="p-5 flex items-center gap-2 border-b border-sidebar-border">
          <div className="h-9 w-9 rounded-lg bg-secondary flex items-center justify-center">
            <Shield className="h-5 w-5 text-secondary-foreground" />
          </div>
          <div>
            <div className="font-semibold leading-tight">DisasterReady</div>
            <div className="text-xs text-sidebar-foreground/60">AI preparedness</div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/60"
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-2">
          {user ? (
            <>
              <div className="text-xs text-sidebar-foreground/70 px-2 truncate">{user.email}</div>
              <Button variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent" onClick={signOut}>
                <LogOut className="h-4 w-4 mr-2" /> Sign out
              </Button>
            </>
          ) : (
            <>
              <div className="text-xs text-sidebar-foreground/70 px-2">
                {isGuest ? "Guest mode (not saved)" : "Not signed in"}
              </div>
              <Button variant="secondary" size="sm" className="w-full" onClick={() => { setGuest(false); navigate("/auth"); }}>
                <LogIn className="h-4 w-4 mr-2" /> Sign in
              </Button>
            </>
          )}
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 bg-sidebar text-sidebar-foreground border-b border-sidebar-border">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-secondary" />
            <span className="font-semibold text-sm">DisasterReady</span>
          </div>
          <div className="flex gap-1">
            {nav.map(({ to, icon: Icon, end, label }) => (
              <NavLink key={to} to={to} end={end} aria-label={label}
                className={({ isActive }) => cn("p-2 rounded-md", isActive ? "bg-sidebar-accent" : "")}>
                <Icon className="h-4 w-4" />
              </NavLink>
            ))}
          </div>
        </div>
      </div>

      <main className="flex-1 overflow-hidden pt-12 md:pt-0">
        <Outlet />
      </main>
    </div>
  );
}
