import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import ErrorBoundary from "@/components/ErrorBoundary";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import AppShell from "./components/AppShell";
import Assistant from "./pages/Assistant";
import NotFound from "./pages/NotFound";

// Lazy-loaded routes for code splitting — these pages are heavier
// and not needed on initial load
const Forecast = lazy(() => import("./pages/Forecast"));
const Plans = lazy(() => import("./pages/Plans"));
const Profile = lazy(() => import("./pages/Profile"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

function PageLoader() {
  return (
    <div className="min-h-[60vh] grid place-items-center text-muted-foreground">
      <div className="flex items-center gap-2">
        <div className="h-4 w-4 rounded-full bg-secondary animate-pulse" />
        Loading…
      </div>
    </div>
  );
}

function ProtectedShell() {
  const { user, isGuest, loading } = useAuth();
  if (loading) return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  if (!user && !isGuest) return <Navigate to="/auth" replace />;
  return <AppShell />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <ErrorBoundary>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/app" element={<ProtectedShell />}>
                <Route index element={<Assistant />} />
                <Route path="forecast" element={<Suspense fallback={<PageLoader />}><Forecast /></Suspense>} />
                <Route path="plans" element={<Suspense fallback={<PageLoader />}><Plans /></Suspense>} />
                <Route path="profile" element={<Suspense fallback={<PageLoader />}><Profile /></Suspense>} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
