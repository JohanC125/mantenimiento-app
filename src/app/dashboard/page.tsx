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
    <main className="min-h-screen bg-slate-100">
      {/* =====================================================
          BARRA SUPERIOR
      ===================================================== */}

      <header className="bg-slate-900 text-white shadow">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-bold">
              Sistema de Mantenimiento
            </h1>

            <p className="text-sm text-slate-400">
              Panel de administración
            </p>
          </div>

          <div className="text-right">
            <p className="font-semibold">{name}</p>

            <p className="text-sm capitalize text-slate-400">
              {role}
            </p>
          </div>
        </div>
      </header>

      {/* =====================================================
          CONTENIDO PRINCIPAL
      ===================================================== */}

      <div className="mx-auto max-w-7xl px-6 py-8">

        {/* TÍTULO */}

        <div className="mb-8">
          <h2 className="text-3xl font-bold text-slate-900">
            Dashboard
          </h2>

          <p className="mt-2 text-slate-600">
            Bienvenido al sistema de gestión de mantenimiento.
          </p>
        </div>

        {/* ===================================================
            TARJETAS PRINCIPALES
        =================================================== */}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">

          {/* Órdenes abiertas */}

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">
              Órdenes abiertas
            </p>

            <p className="mt-2 text-3xl font-bold text-slate-900">
              0
            </p>
          </div>

          {/* En mantenimiento */}

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">
              En mantenimiento
            </p>

            <p className="mt-2 text-3xl font-bold text-slate-900">
              0
            </p>
          </div>

          {/* Completadas */}

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">
              Completadas
            </p>

            <p className="mt-2 text-3xl font-bold text-slate-900">
              0
            </p>
          </div>

          {/* Usuarios */}

          <a
            href="/dashboard/usuarios"
            className="block rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <p className="text-sm text-slate-500">
              Usuarios
            </p>

            <p className="mt-2 text-3xl font-bold text-slate-900">
              0
            </p>

            <p className="mt-2 text-xs text-blue-600">
              Administrar usuarios →
            </p>
          </a>
        </div>

        {/* ===================================================
            MÓDULOS
        =================================================== */}

        <div className="mt-8">
          <h3 className="mb-4 text-xl font-bold text-slate-900">
            Módulos del sistema
          </h3>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">

            {/* =================================================
                ÓRDENES DE MANTENIMIENTO
            ================================================= */}

            <a
              href="/dashboard/ordenes"
              className="block rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-lg font-bold text-slate-900">
                    Órdenes de mantenimiento
                  </h4>

                  <p className="mt-2 text-sm text-slate-600">
                    Crear, consultar y gestionar órdenes
                    de mantenimiento.
                  </p>
                </div>

                <span className="text-xl text-blue-600">
                  →
                </span>
              </div>
            </a>

            {/* =================================================
                PROVEEDORES
            ================================================= */}

            <button
              type="button"
              className="rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <h4 className="text-lg font-bold text-slate-900">
                Proveedores
              </h4>

              <p className="mt-2 text-sm text-slate-600">
                Administrar proveedores asociados a las
                diferentes sedes.
              </p>
            </button>

            {/* =================================================
                USUARIOS
            ================================================= */}

            <a
              href="/dashboard/usuarios"
              className="block rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <h4 className="text-lg font-bold text-slate-900">
                Usuarios
              </h4>

              <p className="mt-2 text-sm text-slate-600">
                Gestionar usuarios, perfiles y roles del
                sistema.
              </p>
            </a>

            {/* =================================================
                HISTORIAL
            ================================================= */}

            <button
              type="button"
              className="rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <h4 className="text-lg font-bold text-slate-900">
                Historial
              </h4>

              <p className="mt-2 text-sm text-slate-600">
                Consultar la trazabilidad de las
                actividades realizadas.
              </p>
            </button>

            {/* =================================================
                REPORTES
            ================================================= */}

            <button
              type="button"
              className="rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <h4 className="text-lg font-bold text-slate-900">
                Reportes
              </h4>

              <p className="mt-2 text-sm text-slate-600">
                Consultar información y estadísticas del
                mantenimiento.
              </p>
            </button>

            {/* =================================================
                CONFIGURACIÓN
            ================================================= */}

            <button
              type="button"
              className="rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <h4 className="text-lg font-bold text-slate-900">
                Configuración
              </h4>

              <p className="mt-2 text-sm text-slate-600">
                Configurar opciones generales del sistema.
              </p>
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}