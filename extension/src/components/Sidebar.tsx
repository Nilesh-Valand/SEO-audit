import { NavLink } from "react-router-dom";

const navItems = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/audits/new", label: "New Audit" },
  { to: "/projects", label: "Projects" },
  { to: "/issues", label: "Issues" },
  { to: "/pages", label: "Pages" },
  { to: "/report", label: "Report" },
  { to: "/current-page", label: "Current Page Check" },
  { to: "/settings", label: "Settings" },
];

export function Sidebar() {
  return (
    <aside className="flex w-64 shrink-0 flex-col bg-gray-900 text-gray-100">
      <div className="flex items-center gap-3 border-b border-gray-700 px-6 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
          S
        </div>
        <div>
          <div className="text-lg font-bold tracking-tight">SEO Audit</div>
          <div className="text-xs text-gray-400">Chrome extension</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-brand-600 text-white"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-gray-700 px-6 py-4 text-xs text-gray-500">v0.1.0</div>
    </aside>
  );
}
