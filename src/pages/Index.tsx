import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

export default function Index() {
  const navigate = useNavigate();
  const { user, isGuest, loading } = useAuth();
  useEffect(() => {
    if (loading) return;
    navigate(user || isGuest ? "/app" : "/auth", { replace: true });
  }, [user, isGuest, loading, navigate]);
  return null;
}
