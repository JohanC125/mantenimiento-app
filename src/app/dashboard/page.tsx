"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function Dashboard() {
  const [name, setName] = useState("Cargando...");
  const [role, setRole] = useState("");

  useEffect(() => {
    const loadProfile = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.href = "/";
        return;
      }

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", user.id)
        .single();

      if (error) {
        setName("Error");
        console.error(error);
        return;
      }

      setName(profile.full_name);
      setRole(profile.role);
    };

    loadProfile();
  }, []);

  return (
    <main className="min-h-screen bg-slate-100 p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900">
          Dashboard
        </h1>

        <div className="mt-6 bg-white rounded-2xl shadow p-6">
          <p className="text-lg">
            Bienvenido, <strong>{name}</strong>
          </p>

          <p className="mt-2 text-slate-600">
            Rol: <strong>{role}</strong>
          </p>
        </div>
      </div>
    </main>
  );
}