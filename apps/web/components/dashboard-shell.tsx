import Link from "next/link";
import {
  canViewSection,
  operatorHref,
  operatorSections,
  type OperatorContext,
  type OperatorSection,
} from "../lib/operator-context";
import { SignOutButton } from "./sign-out-button";

export function DashboardShell({
  context,
  section,
  children,
}: {
  context: OperatorContext;
  section: OperatorSection;
  children: React.ReactNode;
}) {
  const membership = context.membership;
  const organizationId = membership?.organization.id ?? null;
  const clientId = context.client?.id ?? null;
  const currentPath =
    section === "overview" ? "/dashboard" : `/dashboard/${section}`;
  const visibleSections = operatorSections.filter(
    (item) => membership && canViewSection(membership.role, item.id),
  );

  return (
    <div className="forge-shell">
      <aside className="forge-rail" aria-label="Workspace navigation">
        <Link href="/dashboard" className="forge-brand no-underline text-white">
          <span className="forge-mark">F</span>
          <span>
            BRANDSPACE <span className="text-[#9acac3]">FORGE</span>
          </span>
        </Link>
        <div className="flex-1">
          {membership && organizationId && (
            <nav className="grid gap-4" aria-label="Operations sections">
              {visibleSections.map((item, index) => {
                const showGroup =
                  item.group !== visibleSections[index - 1]?.group;
                return (
                  <div key={item.id}>
                    {showGroup && (
                      <p className="forge-rail-label">{item.group}</p>
                    )}
                    <div className="forge-nav">
                      <Link
                        href={operatorHref(item.id, organizationId, clientId)}
                        aria-current={section === item.id ? "page" : undefined}
                      >
                        <span className="forge-nav-glyph" aria-hidden="true">
                          {item.glyph}
                        </span>
                        {item.label}
                      </Link>
                    </div>
                  </div>
                );
              })}
            </nav>
          )}
        </div>
        <div className="forge-rail-footer border-t border-[#345056] px-3 pt-4">
          <p className="m-0 truncate text-[12px] font-bold text-white">
            {context.user.name}
          </p>
          <p className="mt-1 mb-3 text-[11px] text-[#91aaa9]">
            {membership?.role.replaceAll("_", " ") ?? "No organization"}
          </p>
          <SignOutButton />
        </div>
      </aside>

      <div className="forge-main">
        <header className="forge-topbar">
          <div className="min-w-0">
            <p className="m-0 text-[10px] font-bold tracking-[0.16em] text-[#78908d] uppercase">
              Operations workspace
            </p>
            <p className="mt-1 mb-0 truncate text-[13px] font-semibold text-[#263b42]">
              {membership?.organization.name ?? "No organization"}
              {context.client ? `  /  ${context.client.name}` : ""}
            </p>
          </div>
          {membership && (
            <div className="flex flex-wrap items-center gap-2">
              <form
                action={currentPath}
                method="get"
                aria-label="Select organization"
              >
                <label className="sr-only" htmlFor="organization-picker">
                  Organization
                </label>
                <select
                  id="organization-picker"
                  name="organizationId"
                  defaultValue={membership.organization.id}
                  className="h-9 min-w-[138px] max-w-[220px] rounded-md border border-[#d8e2e2] bg-white px-2 text-[12px] font-semibold text-[#334950]"
                >
                  {context.memberships.map((item) => (
                    <option
                      key={item.organization.id}
                      value={item.organization.id}
                    >
                      {item.organization.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="ml-1 rounded-md border border-[#d8e2e2] px-2 py-[7px] text-[11px] font-semibold hover:bg-[#f3f6f5]"
                >
                  Go
                </button>
              </form>
              {context.clients.length > 0 && (
                <form
                  action={currentPath}
                  method="get"
                  aria-label="Select client"
                >
                  <input
                    type="hidden"
                    name="organizationId"
                    value={membership.organization.id}
                  />
                  <label className="sr-only" htmlFor="client-picker">
                    Client
                  </label>
                  <select
                    id="client-picker"
                    name="clientId"
                    defaultValue={clientId ?? undefined}
                    className="h-9 min-w-[138px] max-w-[220px] rounded-md border border-[#d8e2e2] bg-white px-2 text-[12px] font-semibold text-[#334950]"
                  >
                    {context.clients.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="ml-1 rounded-md border border-[#d8e2e2] px-2 py-[7px] text-[11px] font-semibold hover:bg-[#f3f6f5]"
                  >
                    Go
                  </button>
                </form>
              )}
            </div>
          )}
        </header>
        <main className="forge-content" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
