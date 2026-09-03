import AdminTokenForm from "./AdminTokenForm";

/**
 * 401 body for GET /admin without a moderator session. Token form only — the
 * console stays behind canOpenAdminDocument. POST /api/admin/session still
 * sets the cookie; a successful submit reloads this path.
 */
export default function AdminUnauthorized() {
  return <AdminTokenForm />;
}
