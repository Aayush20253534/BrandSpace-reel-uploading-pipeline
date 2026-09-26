import { notFound } from "next/navigation";
import { DashboardShell } from "../../../components/dashboard-shell";
import { OperatorView } from "../../../components/operator-view";
import {
  canViewSection,
  firstQueryValue,
  getOperatorContext,
  parseSection,
  type Query,
} from "../../../lib/operator-context";

export default async function OperatorSectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<Query>;
}) {
  const [{ section: rawSection }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const section = parseSection(rawSection);
  if (!section || section === "overview") notFound();
  const context = await getOperatorContext(query);
  if (context.membership && !canViewSection(context.membership.role, section)) {
    notFound();
  }
  const rawPage = Number(firstQueryValue(query.page) ?? "1");
  const page =
    Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 100 ? rawPage : 1;
  return (
    <DashboardShell context={context} section={section}>
      <OperatorView context={context} section={section} page={page} />
    </DashboardShell>
  );
}
