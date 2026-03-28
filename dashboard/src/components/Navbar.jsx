import { NavLink, useNavigate } from "react-router-dom";

const links = [
  { to: "/", label: "Overview" },
  { to: "/recipients", label: "Recipients" },
  { to: "/templates", label: "Templates" },
];

export default function Navbar() {
  const navigate = useNavigate();

  function logout() {
    localStorage.removeItem("trackmail_token");
    navigate("/login");
  }

  return (
    <nav className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center gap-6">
      <span className="font-bold text-blue-400 text-lg mr-4">Trackmail</span>
      {links.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          className={({ isActive }) =>
            `text-sm font-medium transition-colors ${isActive ? "text-blue-400" : "text-slate-300 hover:text-white"}`
          }
        >
          {label}
        </NavLink>
      ))}
      <button
        onClick={logout}
        className="ml-auto text-sm text-slate-400 hover:text-white transition-colors"
      >
        Logout
      </button>
    </nav>
  );
}
