# Operación y despliegue de la versión integral

## Estado y límites

El frontend y los endpoints se implementaron sobre los cambios locales existentes.
No se ejecutó SQL contra Supabase, ni se leyó `.env.local`, ni se hizo commit/push.
No hay una conexión disponible para inspeccionar la base remota. El build NO valida
las tablas, RPC, triggers ni RLS de Supabase. No desplegar el frontend nuevo sobre
una base sin preparar: usa los contratos RPC `_v2` descritos a continuación.

## Archivos intervenidos en esta pasada

Modificados (sobre los cambios locales previos):

- `src/app/page.tsx`: navegación de login.
- `src/app/globals.css`: paleta clara consistente, foco y controles táctiles.
- `src/app/dashboard/layout.tsx`: validación de sesión en servidor, perfil compartido.
- `src/components/dashboard/DashboardShell.tsx` y `Sidebar.tsx`: navegación según rol,
  perfil recibido del servidor y manejo de error al salir; Sedes solo administrador.
- `src/app/dashboard/page.tsx`: login correcto, métricas y recientes del ingeniero
  filtrados por asignación, acceso a sedes según rol.
- `src/app/dashboard/ordenes/page.tsx`: carga completa visible, filtro de ingeniero,
  separación de eliminadas, permisos nuevos, solo Seguridad Social, integración de
  operaciones y seguimiento; protección contra respuestas de checks fuera de orden.
- `src/app/dashboard/sedes/page.tsx`: conecta la gestión real de sedes.
- `src/app/dashboard/usuarios/page.tsx`: formulario de edición y errores recuperables.
- `src/app/api/admin/users/route.ts`: PATCH autorizado para nombre, rol y estado.
- `src/app/dashboard/proveedores/page.tsx`: anotación localizada del efecto de carga
  asíncrona para lint; se mantiene el módulo fuera del menú principal.

Nuevos:

- `src/lib/access.ts`, `admin-api.ts`, `errors.ts`, `orders.ts`.
- `src/components/dashboard/OrderWorkflow.tsx`, `SitesManager.tsx`.
- `src/app/api/admin/sites/route.ts`.
- `src/app/dashboard/usuarios/layout.tsx`, `sedes/layout.tsx`, `proveedores/layout.tsx`.
- `supabase/diagnostics/01_inspect.sql`.
- `supabase/migrations/20260921_operations.sql`.
- Este documento.

Reubicados sin descartar el contenido:

- `proxy.ts` → `src/proxy.ts` (incluye protección de Sedes).
- `src/app/dashboard/ordenes/page_backup.tsx` → `docs/archive/ordenes-page-backup.tsx.txt`.

Verificación local final:

- `npm run lint`: código de salida 0, sin errores ni advertencias.
- `npm run build`: código de salida 0; TypeScript correcto; proxy detectado y
  todas las rutas del dashboard dinámicas.
- Servidor compilado temporal en puerto 3107: `/` devuelve 200; `/dashboard`,
  `/dashboard/ordenes`, `/dashboard/sedes`, `/dashboard/usuarios` y
  `/dashboard/proveedores` devuelven 307 a `/` sin sesión.
- POST anónimo a `/api/admin/users`, `/api/admin/sites`, `/api/admin/providers`:
  401 en los tres casos. El servidor temporal se detuvo al terminar.
- `git diff --check`: sin errores de espacios (Git informa conversión LF/CRLF).
- No se probaron visualmente sesiones autenticadas ni escrituras contra Supabase.

## Primero: inspección de base (solo lectura)

En Supabase → SQL Editor, ejecutar el contenido de
`supabase/diagnostics/01_inspect.sql`. Guardar el resultado antes de cambiar nada.
Revisar todas las funciones y triggers que escriben `order_document_checks`.
En especial buscar triggers INSERT/UPDATE sobre `maintenance_orders`: la creación
inserta la OT y después actualiza `root_order_id`; un trigger que corre en ambos
eventos también puede duplicar checks. Revisar asimismo triggers de la tabla de checks.

Evidencia actual confirmada por el usuario (revisión final):

- La página activa contiene una llamada de creación por envío de formulario.
- No contiene INSERT de checks; solo lectura y validación.
- La RPC desplegada `create_maintenance_order` NO inserta checks. El trigger
  `trigger_create_order_document_checks` AFTER INSERT sí crea los cuatro tipos,
  con ON CONFLICT DO NOTHING. Esta combinación confirmada no explica por sí sola
  el error antiguo de duplicado; no atribuirlo al frontend sin evidencia adicional.
- La migración revisada reemplaza la función de ese trigger para generar solamente
  Seguridad Social. Las RPC v2 no insertan checks y la validación solo actualiza.
- No se eliminó la restricción ni se borraron registros para ocultar el problema.

## Segundo: revisión y aplicación manual de la migración

Archivo: `supabase/migrations/20260921_operations.sql`.
Primero probarlo en una copia/staging con el mismo esquema y las mismas políticas.
Es transaccional (`BEGIN`/`COMMIT`) y repetible sobre el mismo esquema compatible:
reemplaza funciones, recrea exclusivamente sus propias políticas y conserva el trigger
confirmado (lo crea si falta). No reconstruye ni modifica datos históricos. Si falla,
hacer ROLLBACK de la transacción fallida y revisar la causa; no saltarse fragmentos.
El timeout de locks es 10 segundos: un bloqueo concurrente aborta, no justifica
quitar protecciones. Aplicar sin tráfico de escritura y con el rol administrativo.

ANTES de ejecutarla confirmar:

1. Las tablas y columnas coinciden con el diagnóstico. `IF NOT EXISTS` no valida
   tipos, FK ni defaults de columnas que ya existan.
2. `maintenance_orders.id` y `order_number` se generan al omitirlos, y la secuencia
   de `order_number` no está atrasada. No se reinicia ninguna secuencia automáticamente.
3. Existe la unicidad de `(order_id, check_type)` y se acepta `seguridad_social`.
4. El trigger conocido es AFTER INSERT FOR EACH ROW, habilitado normalmente, sin
   argumentos ni condición WHEN. El preflight aborta si su definición diverge, si
   la función tiene otro trigger vinculado o si la restricción única no coincide.
   Revisar otros triggers/RPC/views: no se borran ni reescriben objetos desconocidos.
5. Revisar políticas RESTRICTIVE existentes: las nuevas no pueden ampliar una
   restricción anterior. Revisar también otras funciones SECURITY DEFINER con
   acceso de escritura; revocar o corregir cualquier vía antigua que el diagnóstico
   identifique. No se asume que el catálogo remoto coincide con el repositorio.
6. Respaldar definiciones de funciones/políticas y disponer de copia de seguridad.
   La migración revoca ejecución cliente de las tres RPC antiguas: coordinar el
   despliegue de frontend y migración en una ventana de mantenimiento.

La migración agrega soporte de asignación, llegada, inicio, cierre, informe y borrado
lógico si no existe. Crea `maintenance_events` sin inventar eventos históricos.
No elimina tablas, datos ni relaciones `provider_id`, ni modifica triggers desconocidos.
Las funciones originales se conservan pero se revoca su ejecución desde clientes;
esto impide que su antigua matriz autorice a ingenieros a gestionar otras órdenes.
Solo reemplaza `create_order_document_checks()` según el contrato confirmado.
Conserva `order_document_checks_unique`; no hace backfill, DELETE ni TRUNCATE.
Las funciones DEFINER usan search_path vacío y referencias de esquema explícitas;
se exige propietario administrativo BYPASSRLS. El trigger no es invocable por
clientes. No se cambian los cuerpos de las RPC antiguas, pero se revoca EXECUTE
a PUBLIC/anon/authenticated en todas sus sobrecargas.

Contratos de frontend:

- `create_maintenance_order_v2(...)`: devuelve `order_number`, generado por la BD.
- `reprogram_maintenance_order_v2(...)`: bloquea la OT padre durante la operación,
  conserva raíz/parentesco, incrementa la reprogramación, registra motivo y usuario;
  devuelve el nuevo `order_number`. Conserva proveedor y asignación por compatibilidad.
  Rechaza órdenes con llegada/inicio o en ejecución; audita padre e hija.
- `delete_maintenance_order_v2(...)`: solo administrador, requiere motivo y guarda
  `deleted_at`, `deleted_by`, `deletion_reason`.
- `maintenance_workflow(...)`: programación/asignación de administrador o auxiliar;
  llegada → inicio → cierre solo del ingeniero asignado, con informe obligatorio.
  La fecha de una OT ya programada cambia mediante reprogramación con motivo.
- `validate_security_social(...)`: solo administrador/auxiliar activo, para órdenes
  no eliminadas; actualiza exclusivamente el check existente de Seguridad Social
  y audita estado/observación. Si falta, falla: requiere diagnóstico y reparación
  manual aprobada, no crea un check silenciosamente.

Políticas finales: ingeniero lee solamente sus OT; administrador/auxiliar leen las
OT visibles. Las antiguas policies desplegadas se retiran explícitamente por nombre.
Se conserva una policy permisiva de lectura por tabla y policies restrictivas solo
para denegar mutaciones directas; no se duplica una policy restrictiva equivalente
para lectura. Escrituras directas de OT/checks se bloquean; las operaciones pasan
por RPC con controles explícitos y bloqueos.
Profiles impide edición directa de roles: gestión por API que verifica administrador.
Sedes/proveedores admiten escritura de administrador; referencias inactivas siguen
visibles para conservar los nombres en el historial. Acceso anónimo a esas tablas
se revoca. Revisar antes de aplicar si existe alguna integración pública legítima.

## Prueba de aplicación

Procedimiento de despliegue y verificación final:

1. Respaldar datos y definiciones; guardar el diagnóstico `01_inspect.sql` y los
   totales por check_type antes de aplicar. Confirmar que coordinador se almacena
   como `auxiliar`, no como un cuarto valor `coordinador`.
2. En una copia de la base actual, revisar columnas/tipos/defaults, FK de
   assigned_engineer_id/deleted_by hacia profiles(id), secuencias, CHECK/ENUM y
   constraints NOT NULL. `IF NOT EXISTS` no valida estructuras preexistentes.
   La creación requiere root_order_id nullable durante el INSERT inicial.
3. Revisar otras RPC DEFINER, views (incluidas las que eludan RLS), triggers,
   privilegios de columna, roles heredados y políticas restrictivas anteriores.
   Comprobar USAGE de las secuencias de sedes/proveedores para sus INSERT directos.
   No se alteran automáticamente estas rutas/privilegios desconocidos.
4. Sin escrituras concurrentes, pegar el archivo completo de migración en SQL
   Editor con rol administrativo y ejecutarlo una vez. Si falla, hacer ROLLBACK
   si la sesión sigue en transacción fallida y resolver la causa antes de reintentar.
5. Ejecutar `supabase/diagnostics/02_verify_operations.sql`: unicidad intacta,
   totales históricos iguales, cero duplicados, trigger único esperado; anon sin
   EXECUTE, authenticated sin EXECUTE en las tres RPC antiguas ni en el trigger,
   con EXECUTE en las nuevas RPC. Revisar todas las policies, no solo las nuevas.
6. Ejecutar de nuevo la migración en staging para comprobar repetibilidad real.
   Crear y reprogramar OT de prueba desde la app autenticada: cada OT nueva debe
   tener exactamente una fila seguridad_social, incluso en sede copropiedad.
   Verificar eventos de padre/hija y ejecutar las pruebas por rol de abajo.
7. Solo tras pasar esas pruebas, repetir respaldo, diagnóstico, aplicación y
   verificación en producción en una ventana sin escrituras, coordinando el
   frontend que usa las RPC v2. No aplicar fragmentos ni borrar datos para superar
   un error. Tras COMMIT, ROLLBACK ya no revierte: cualquier reversión necesita
   un plan revisado a partir del respaldo y de los datos nuevos.

Casos históricos que requieren decisión manual: OT sin Seguridad Social (la
validación ahora falla explícitamente), OT en ejecución sin started_at o sin
asignación (no inventar llegada/inicio/ingeniero), asignaciones a ingenieros
inactivos (la reprogramación conserva la asignación original). El flujo ordinario
no reprograma después de llegada; necesitaría un flujo excepcional autorizado.
Las lecturas de OT eliminadas siguen disponibles según rol para el historial;
el borrado es lógico. No se impone aprobación documental como requisito de inicio,
porque esa regla no fue solicitada. La auditoría cubre las RPC nuevas, no escrituras
externas hechas con un rol administrativo/service role.

Pruebas funcionales por rol:

1. Aplicar la migración revisada en staging; refrescar el esquema API si es necesario.
2. `npm run build`, después `npm run start`; abrir el login `/`.
3. Sin sesión: entrar directamente a `/dashboard`, `/dashboard/sedes`,
   `/dashboard/usuarios`, `/dashboard/proveedores` debe volver al login.
4. Administrador: crear/editar/activar/desactivar sede. Crear usuario y editar nombre,
   rol/estado. El correo es de solo lectura al editar para no desincronizar Supabase Auth.
   No puede quitarse a sí mismo el rol administrador ni desactivarse desde esta API.
5. Administrador/auxiliar: crear OT usando sede/proveedor activo, comprobar una sola
   Seguridad Social activa en UI, asignar ingeniero y validar el documento.
6. Ingeniero: ver solo las OT asignadas en resumen y bandeja. Registrar llegada,
   inicio y cierre con informe. Repetir una acción ya realizada debe ser rechazada
   por SQL. No puede gestionar usuarios/sedes ni validar documentos.
7. Reprogramar con motivo: comprobar nueva OT y familia, padre reprogramado y
   trazabilidad. Dos reprogramaciones simultáneas del mismo padre no deben prosperar.
8. Administrador: eliminación con motivo. La OT solo aparece en Eliminadas, conserva
   familia/checks/eventos, no acepta nuevas escrituras.
9. Probar acceso directo RPC con rol incorrecto y usuario inactivo: debe rechazarse.
10. Probar filtros por sede, estado, tipo, fechas e ingeniero, búsqueda y cierre de sesión.
    Probar viewport 375px: menú móvil, formulario, panel del ingeniero y tabla desplazable.

## Decisiones y pendientes externos

- La creación sigue usando proveedor y fecha, con estado `programada`, para preservar
  el contrato previo. Proveedores no figura en navegación principal; su ruta administrativa
  sigue disponible para compatibilidad.
- Solo Seguridad Social aparece activa. El trigger revisado deja de generar los
  otros tipos para nuevas OT; sus registros históricos permanecen intactos.
- Ingenieros antiguos no reciben asignaciones inventadas: administrador/auxiliar debe
  asignar las OT existentes. Sin asignación, no aparecerán en la bandeja del ingeniero.
- La bandeja obtiene páginas de hasta 500 filas bajo RLS y calcula filtros/totales sobre
  el conjunto visible completo; no hay truncamiento intencional a 100. Para volúmenes
  grandes falta mover búsqueda, paginación visual y agregados al servidor.
- El conteo de perfiles respeta RLS; un SELECT exitoso no demuestra que vea todos los
  perfiles si políticas RESTRICTIVE remotas filtran filas. Confirmarlo en staging.
- Supabase JS avisa sobre deprecación futura de Node 20. No cambiamos versiones ni
  credenciales. Next advierte de un lockfile fuera del repositorio; no se borró ese archivo.
- Esta entrega requiere la revisión SQL remota y pruebas autenticadas por rol antes
  de considerarse lista para producción. No se ejecutaron mutaciones sobre datos reales.
