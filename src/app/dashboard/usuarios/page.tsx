
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type UserProfile = {
    id: string;
    full_name: string;
    email: string;
    role: string;
    active: boolean;
    created_at: string;
};

export default function UsuariosPage() {
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [loading, setLoading] = useState(true);

    const [showForm, setShowForm] = useState(false);
    const [creating, setCreating] = useState(false);

    const [fullName, setFullName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [role, setRole] = useState("auxiliar");

    const [message, setMessage] = useState("");
    const [errorMessage, setErrorMessage] = useState("");

    const loadUsers = async () => {
        setLoading(true);

        const { data, error } = await supabase
            .from("profiles")
            .select("id, full_name, email, role, active, created_at")
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Error cargando usuarios:", error);
            setLoading(false);
            return;
        }

        setUsers(data || []);
        setLoading(false);
    };

    useEffect(() => {
        loadUsers();
    }, []);

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault();

        setCreating(true);
        setMessage("");
        setErrorMessage("");

        try {
            const response = await fetch("/api/admin/users", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    full_name: fullName,
                    email,
                    password,
                    role,
                }),
            });

            const result = await response.json();

            if (!response.ok) {
                setErrorMessage(result.error || "No se pudo crear el usuario.");
                setCreating(false);
                return;
            }

            setMessage("Usuario creado correctamente.");

            setFullName("");
            setEmail("");
            setPassword("");
            setRole("auxiliar");

            await loadUsers();

            setTimeout(() => {
                setShowForm(false);
                setMessage("");
            }, 1500);
        } catch (error) {
            console.error(error);
            setErrorMessage("Ocurrió un error al crear el usuario.");
        }

        setCreating(false);
    };

    return (
        <main className="min-h-screen bg-slate-100">
            {/* Barra superior */}
            <header className="bg-slate-900 text-white shadow">
                <div className="max-w-7xl mx-auto px-6 py-4">
                    <h1 className="text-xl font-bold">
                        Sistema de Mantenimiento
                    </h1>

                    <p className="text-sm text-slate-400">
                        Gestión de usuarios
                    </p>
                </div>
            </header>

            {/* Contenido */}
            <div className="max-w-7xl mx-auto px-6 py-8">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 className="text-3xl font-bold text-slate-900">
                            Usuarios
                        </h2>

                        <p className="mt-2 text-slate-600">
                            Usuarios registrados en el sistema.
                        </p>
                    </div>

                    <button
                        onClick={() => {
                            setShowForm(true);
                            setMessage("");
                            setErrorMessage("");
                        }}
                        className="bg-slate-900 text-white px-5 py-3 rounded-xl font-semibold hover:bg-slate-800 transition"
                    >
                        + Nuevo usuario
                    </button>
                </div>

                {/* Formulario */}
                {showForm && (
                    <div className="mb-8 bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h3 className="text-xl font-bold text-slate-900">
                                    Crear nuevo usuario
                                </h3>

                                <p className="text-sm text-slate-500 mt-1">
                                    Registra un usuario y asígnale un rol.
                                </p>
                            </div>

                            <button
                                onClick={() => setShowForm(false)}
                                className="text-slate-500 hover:text-slate-900 text-xl"
                            >
                                ×
                            </button>
                        </div>

                        <form onSubmit={handleCreateUser}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                {/* Nombre */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">
                                        Nombre completo
                                    </label>

                                    <input
                                        type="text"
                                        value={fullName}
                                        onChange={(e) => setFullName(e.target.value)}
                                        required
                                        className="w-full border border-slate-300 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-slate-500"
                                        placeholder="Nombre completo"
                                    />
                                </div>

                                {/* Correo */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">
                                        Correo electrónico
                                    </label>

                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                        className="w-full border border-slate-300 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-slate-500"
                                        placeholder="correo@ejemplo.com"
                                    />
                                </div>

                                {/* Contraseña */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">
                                        Contraseña
                                    </label>

                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        minLength={6}
                                        className="w-full border border-slate-300 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-slate-500"
                                        placeholder="Mínimo 6 caracteres"
                                    />
                                </div>

                                {/* Rol */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">
                                        Rol
                                    </label>

                                    <select
                                        value={role}
                                        onChange={(e) => setRole(e.target.value)}
                                        className="w-full border border-slate-300 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                                    >
                                        <option value="auxiliar">Auxiliar</option>
                                        <option value="ingeniero">Ingeniero</option>
                                        <option value="administrador">Administrador</option>
                                    </select>
                                </div>
                            </div>

                            {/* Mensajes */}
                            {message && (
                                <div className="mt-5 bg-green-100 text-green-700 rounded-xl px-4 py-3">
                                    {message}
                                </div>
                            )}

                            {errorMessage && (
                                <div className="mt-5 bg-red-100 text-red-700 rounded-xl px-4 py-3">
                                    {errorMessage}
                                </div>
                            )}

                            {/* Botones */}
                            <div className="mt-6 flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowForm(false)}
                                    className="px-5 py-3 rounded-xl border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50"
                                >
                                    Cancelar
                                </button>

                                <button
                                    type="submit"
                                    disabled={creating}
                                    className="px-5 py-3 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 disabled:opacity-50"
                                >
                                    {creating ? "Creando..." : "Crear usuario"}
                                </button>
                            </div>
                        </form>
                    </div>
                )}

                {/* Tabla */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    {loading ? (
                        <div className="p-8 text-center text-slate-500">
                            Cargando usuarios...
                        </div>
                    ) : users.length === 0 ? (
                        <div className="p-8 text-center text-slate-500">
                            No hay usuarios registrados.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-slate-50 border-b border-slate-200">
                                    <tr>
                                        <th className="text-left px-6 py-4 text-sm font-semibold text-slate-600">
                                            Nombre
                                        </th>

                                        <th className="text-left px-6 py-4 text-sm font-semibold text-slate-600">
                                            Correo
                                        </th>

                                        <th className="text-left px-6 py-4 text-sm font-semibold text-slate-600">
                                            Rol
                                        </th>

                                        <th className="text-left px-6 py-4 text-sm font-semibold text-slate-600">
                                            Estado
                                        </th>

                                        <th className="text-left px-6 py-4 text-sm font-semibold text-slate-600">
                                            Fecha de creación
                                        </th>
                                    </tr>
                                </thead>

                                <tbody>
                                    {users.map((user) => (
                                        <tr
                                            key={user.id}
                                            className="border-b border-slate-100 hover:bg-slate-50"
                                        >
                                            <td className="px-6 py-4 font-medium text-slate-900">
                                                {user.full_name}
                                            </td>

                                            <td className="px-6 py-4 text-slate-600">
                                                {user.email}
                                            </td>

                                            <td className="px-6 py-4">
                                                <span className="inline-flex px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-sm font-medium">
                                                    {user.role}
                                                </span>
                                            </td>

                                            <td className="px-6 py-4">
                                                {user.active ? (
                                                    <span className="inline-flex px-3 py-1 rounded-full bg-green-100 text-green-700 text-sm font-medium">
                                                        Activo
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex px-3 py-1 rounded-full bg-red-100 text-red-700 text-sm font-medium">
                                                        Inactivo
                                                    </span>
                                                )}
                                            </td>

                                            <td className="px-6 py-4 text-slate-600">
                                                {new Date(user.created_at).toLocaleDateString("es-CO")}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}

