import Link from "next/link";
import { env } from "@forge/config";
import { prisma } from "@forge/database";
import { isSafeToReconcilePublishingJob } from "@forge/queue";
import { reconcilePublishingJob } from "../app/dashboard/actions";
import { ApprovalDecisionForm } from "./approval-decision-form";
import {
  operatorHref,
  type OperatorContext,
  type OperatorSection,
} from "../lib/operator-context";

type Cell = React.ReactNode;

const descriptions: Record<OperatorSection, string> = {
  overview: "Live work, decisions and distribution health for this client.",
  media: "Canonical source and generated assets available to the pipeline.",
  projects: "Reel work from draft through publication.",
  versions: "Immutable creative plans and their rendered artifacts.",
  render: "Deterministic rendering attempts and recent failures.",
  qa: "Technical and creative review decisions.",
  approvals: "Human decisions bound to reel projects.",
  schedule: "Publishing intent due now and next.",
  publishing: "Durable Instagram job state and provider references.",
  accounts: "Connection, token expiry and reauthorization needs.",
  analytics: "Provider observations captured for published reels.",
  audit: "Recorded actions for this client.",
};

const titles: Record<OperatorSection, string> = {
  overview: "Operations overview",
  media: "Media library",
  projects: "Reel projects",
  versions: "Reel versions",
  render: "Render jobs",
  qa: "Quality review",
  approvals: "Approvals",
  schedule: "Publication schedule",
  publishing: "Publishing jobs",
  accounts: "Instagram accounts",
  analytics: "Analytics",
  audit: "Audit timeline",
};

function date(value: Date | null | undefined, timezone: string) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(value);
  } catch {
    return value.toISOString();
  }
}

function bytes(value: bigint | null) {
  if (value === null) return "—";
  const amount = Number(value);
  if (amount < 1024 * 1024) return `${Math.round(amount / 1024)} KB`;
  return `${(amount / (1024 * 1024)).toFixed(1)} MB`;
}

function tone(value: string): "good" | "warn" | "bad" | "neutral" {
  if (
    [
      "PUBLISHED",
      "CONNECTED",
      "READY",
      "SUCCEEDED",
      "PASS",
      "APPROVED",
    ].includes(value)
  )
    return "good";
  if (
    [
      "NEEDS_ATTENTION",
      "NEEDS_REAUTH",
      "FAILED",
      "INVALID",
      "REJECTED",
      "RENDER_FAILED",
      "PUBLISH_FAILED",
    ].includes(value)
  )
    return "bad";
  if (
    [
      "PENDING",
      "SCHEDULED",
      "PROCESSING",
      "DISPATCHED",
      "RUNNING",
      "AWAITING_APPROVAL",
      "RETRY_WAIT",
    ].includes(value)
  )
    return "warn";
  return "neutral";
}

function Badge({ value }: { value: string }) {
  return (
    <span className="forge-badge" data-tone={tone(value)}>
      {value.replaceAll("_", " ")}
    </span>
  );
}

function Header({
  section,
  clientName,
}: {
  section: OperatorSection;
  clientName: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="m-0 text-[10px] font-extrabold tracking-[0.17em] text-[#0f6b64] uppercase">
          {clientName} / Operations
        </p>
        <h1 className="mt-2 mb-1 text-[clamp(26px,2.5vw,36px)] font-semibold tracking-[-0.04em]">
          {titles[section]}
        </h1>
        <p className="m-0 text-[13px] text-[#607078]">
          {descriptions[section]}
        </p>
      </div>
      <div className="rounded-md border border-[#dce5e6] bg-white px-3 py-2 text-[11px] font-semibold text-[#52646c]">
        Client scope · {clientName}
      </div>
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="m-0 text-[14px] font-semibold text-[#31434a]">
        Nothing to show yet
      </p>
      <p className="mt-2 mb-0 text-[12px] text-[#718187]">{message}</p>
    </div>
  );
}

function Table({
  columns,
  rows,
  empty,
}: {
  columns: string[];
  rows: { id: string; cells: Cell[] }[];
  empty: string;
}) {
  return (
    <div className="forge-card overflow-hidden">
      {rows.length === 0 ? (
        <Empty message={empty} />
      ) : (
        <div className="forge-table-wrap">
          <table className="forge-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-[#fbfdfc]">
                  {row.cells.map((cell, index) => (
                    <td key={index}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Pager({
  context,
  section,
  page,
  hasNext,
}: {
  context: OperatorContext;
  section: OperatorSection;
  page: number;
  hasNext: boolean;
}) {
  if (!context.membership || (!hasNext && page === 1)) return null;
  const orgId = context.membership.organization.id;
  const clientId = context.client?.id ?? null;
  return (
    <nav
      aria-label="Page navigation"
      className="mt-4 flex items-center justify-between text-[12px]"
    >
      <span className="text-[#718187]">Page {page}</span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link
            className="rounded-md border border-[#d7e2e1] bg-white px-3 py-2 font-semibold text-[#0f6b64]"
            href={operatorHref(section, orgId, clientId, page - 1)}
          >
            Previous
          </Link>
        )}
        {hasNext && (
          <Link
            className="rounded-md border border-[#d7e2e1] bg-white px-3 py-2 font-semibold text-[#0f6b64]"
            href={operatorHref(section, orgId, clientId, page + 1)}
          >
            Next
          </Link>
        )}
      </div>
    </nav>
  );
}

function takePage<T>(items: T[]) {
  return { items: items.slice(0, 25), hasNext: items.length > 25 };
}

function metricValues(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]),
    )
    .slice(0, 5);
}

export async function OperatorView({
  context,
  section,
  page,
}: {
  context: OperatorContext;
  section: OperatorSection;
  page: number;
}) {
  const client = context.client;
  if (!client) {
    return (
      <div className="forge-card p-8">
        <h1 className="m-0 text-[25px] font-semibold">
          No client is available
        </h1>
        <p className="mt-3 mb-0 text-[13px] text-[#607078]">
          {context.membership
            ? "This organization has no clients yet. An owner or administrator can add one through the operator setup workflow."
            : "Your account is not a member of an organization. Ask an administrator to grant access."}
        </p>
      </div>
    );
  }
  const timezone = client.timezone;
  const skip = (page - 1) * 25;
  const clientId = client.id;

  if (section === "overview") {
    const [
      projects,
      pendingApprovals,
      scheduled,
      attention,
      accounts,
      recent,
      upcoming,
    ] = await Promise.all([
      prisma.reelProject.count({
        where: {
          clientId,
          state: { notIn: ["CANCELLED", "PUBLISHED", "REJECTED"] },
        },
      }),
      prisma.approval.count({
        where: { reelProject: { clientId }, decision: "PENDING" },
      }),
      prisma.publishingJob.count({
        where: { reelProject: { clientId }, state: "SCHEDULED" },
      }),
      prisma.publishingJob.count({
        where: { reelProject: { clientId }, state: "NEEDS_ATTENTION" },
      }),
      prisma.socialAccount.count({ where: { clientId, status: "CONNECTED" } }),
      prisma.reelProject.findMany({
        where: { clientId },
        orderBy: { updatedAt: "desc" },
        take: 6,
        select: {
          id: true,
          title: true,
          state: true,
          activeVersion: true,
          updatedAt: true,
        },
      }),
      prisma.publishingJob.findMany({
        where: {
          reelProject: { clientId },
          state: {
            in: ["SCHEDULED", "RETRY_WAIT", "DISPATCHED", "PROCESSING"],
          },
        },
        orderBy: { scheduledAt: "asc" },
        take: 5,
        select: {
          id: true,
          state: true,
          scheduledAt: true,
          reelProject: { select: { title: true } },
        },
      }),
    ]);
    const metrics = [
      ["Active projects", projects, "projects"],
      ["Awaiting approval", pendingApprovals, "approvals"],
      ["Scheduled", scheduled, "schedule"],
      ["Needs attention", attention, "publishing"],
      ["Connected accounts", accounts, "accounts"],
    ] as const;
    const orgId = context.membership!.organization.id;
    return (
      <>
        <Header section={section} clientName={client.name} />
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {metrics.map(([label, value, target]) => (
            <Link
              key={label}
              href={operatorHref(target, orgId, clientId)}
              className="forge-card group px-4 py-4 no-underline hover:border-[#a9ccc7]"
            >
              <p className="m-0 text-[11px] font-semibold text-[#718187]">
                {label}
              </p>
              <p className="mt-3 mb-0 text-[28px] leading-none font-semibold tracking-[-0.05em] text-[#17242b]">
                {value}
              </p>
              <p className="mt-4 mb-0 text-[11px] font-semibold text-[#0f6b64] group-hover:underline">
                Inspect →
              </p>
            </Link>
          ))}
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <section>
            <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.02em]">
              Recently active reels
            </h2>
            <Table
              columns={["Project", "State", "Version", "Updated"]}
              empty="Projects appear here when creative work begins."
              rows={recent.map((item) => ({
                id: item.id,
                cells: [
                  <span key="title" className="font-semibold">
                    {item.title}
                  </span>,
                  <Badge key="state" value={item.state} />,
                  `v${item.activeVersion}`,
                  date(item.updatedAt, timezone),
                ],
              }))}
            />
          </section>
          <section>
            <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.02em]">
              Upcoming distribution
            </h2>
            <Table
              columns={["Reel", "State", "Due"]}
              empty="Approved reels with a schedule appear here."
              rows={upcoming.map((item) => ({
                id: item.id,
                cells: [
                  <span key="title" className="font-semibold">
                    {item.reelProject.title}
                  </span>,
                  <Badge key="state" value={item.state} />,
                  date(item.scheduledAt, timezone),
                ],
              }))}
            />
          </section>
        </div>
      </>
    );
  }

  let table: React.ReactNode;
  let hasNext = false;
  switch (section) {
    case "media": {
      const result = takePage(
        await prisma.mediaAsset.findMany({
          where: { clientId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 26,
          skip,
          select: {
            id: true,
            name: true,
            kind: true,
            state: true,
            mimeType: true,
            sizeBytes: true,
            durationMs: true,
            createdAt: true,
          },
        }),
      );
      hasNext = result.hasNext;
      table = (
        <Table
          columns={["Asset", "Kind", "State", "Size", "Duration", "Added"]}
          empty="Ingest media from the client's canonical Drive folder."
          rows={result.items.map((item) => ({
            id: item.id,
            cells: [
              <span key="name" title={item.mimeType} className="font-semibold">
                {item.name}
              </span>,
              item.kind.replaceAll("_", " "),
              <Badge key="state" value={item.state} />,
              bytes(item.sizeBytes),
              item.durationMs ? `${(item.durationMs / 1000).toFixed(1)}s` : "—",
              date(item.createdAt, timezone),
            ],
          }))}
        />
      );
      break;
    }
    case "projects": {
      const result = takePage(
        await prisma.reelProject.findMany({
          where: { clientId },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: 26,
          skip,
          select: {
            id: true,
            title: true,
            state: true,
            objective: true,
            campaignKey: true,
            activeVersion: true,
            updatedAt: true,
          },
        }),
      );
      hasNext = result.hasNext;
      table = (
        <Table
          columns={[
            "Project",
            "Objective",
            "Campaign",
            "State",
            "Active version",
            "Updated",
          ]}
          empty="Create a reel project to start the production flow."
          rows={result.items.map((item) => ({
            id: item.id,
            cells: [
              <span key="title" className="font-semibold">
                {item.title}
              </span>,
              item.objective ?? "—",
              item.campaignKey ?? "—",
              <Badge key="state" value={item.state} />,
              `v${item.activeVersion}`,
              date(item.updatedAt, timezone),
            ],
          }))}
        />
      );
      break;
    }
    case "versions": {
      const result = takePage(
        await prisma.reelVersion.findMany({
          where: { reelProject: { clientId } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 26,
          skip,
          select: {
            id: true,
            version: true,
            caption: true,
            renderedAssetId: true,
            createdAt: true,
            reelProject: { select: { title: true, state: true } },
          },
        }),
      );
      hasNext = result.hasNext;
      table = (
        <Table
          columns={[
            "Project",
            "Version",
            "Caption",
            "Artifact",
            "Project state",
            "Created",
          ]}
          empty="Planned versions appear here with their immutable creative record."
          rows={result.items.map((item) => ({
            id: item.id,
            cells: [
              <span key="title" className="font-semibold">
                {item.reelProject.title}
              </span>,
              `v${item.version}`,
              <span
                key="caption"
                className="block max-w-[320px] truncate"
                title={item.caption ?? ""}
              >
                {item.caption ?? "—"}
              </span>,
              item.renderedAssetId ? "Rendered" : "Not rendered",
              <Badge key="state" value={item.reelProject.state} />,
              date(item.createdAt, timezone),
            ],
          }))}
        />
      );
      break;
    }
    case "render": {
      const result = takePage(
        await prisma.renderJob.findMany({
          where: { reelVersion: { reelProject: { clientId } } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 26,
          skip,
          select: {
            id: true,
            state: true,
            attemptCount: true,
            errorCode: true,
            createdAt: true,
            reelVersion: {
              select: {
                version: true,
                reelProject: { select: { title: true } },
              },
            },
          },
        }),
      );
      hasNext = result.hasNext;
      table = (
        <Table
          columns={[
            "Project",
            "Version",
            "State",
            "Attempts",
            "Error code",
            "Started",
          ]}
          empty="Rendering attempts appear when a reel is sent to FFmpeg."
          rows={result.items.map((item) => ({
            id: item.id,
            cells: [
              <span key="title" className="font-semibold">
                {item.reelVersion.reelProject.title}
              </span>,
              `v${item.reelVersion.version}`,
              <Badge key="state" value={item.state} />,
              item.attemptCount,
              item.errorCode ?? "—",
              date(item.createdAt, timezone),
            ],
          }))}
        />
      );
      break;
    }
    case "qa": {
      const result = takePage(
        await prisma.qaReview.findMany({
          where: { reelVersion: { reelProject: { clientId } } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 26,
          skip,
          select: {
            id: true,
            decision: true,
            summary: true,
            createdAt: true,
            reelVersion: {
              select: {
                version: true,
                reelProject: { select: { title: true } },
              },
            },
          },
        }),
      );
      hasNext = result.hasNext;
      table = (
        <Table
          columns={["Project", "Version", "Decision", "Summary", "Reviewed"]}
          empty="QA results appear after technical and creative checks run."
          rows={result.items.map((item) => ({
            id: item.id,
            cells: [
              <span key="title" className="font-semibold">
                {item.reelVersion.reelProject.title}
              </span>,
              `v${item.reelVersion.version}`,
              <Badge key="state" value={item.decision} />,
              <span
                key="summary"
                className="block max-w-[340px] truncate"
                title={item.summary ?? ""}
              >
                {item.summary ?? "—"}
              </span>,
              date(item.createdAt, timezone),
            ],
          }))}
        />
      );
      break;
    }
    case "approvals": {
      const canDecide =
        context.membership !== null &&
        ["OWNER", "ADMIN", "CONTENT_MANAGER", "REVIEWER"].includes(
          context.membership.role,
        );
      const result = takePage(
        await prisma.approval.findMany({
          where: { reelProject: { clientId } },
          orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
          take: 26,
          skip,
          select: {
            id: true,
            decision: true,
            requestedAt: true,
            decidedAt: true,
            note: true,
            reelVersion: {
              select: { version: true, renderedAssetId: true },
            },
            reelProject: {
              select: { title: true, state: true, activeVersion: true },
            },
          },
        }),
      );
      hasNext = result.hasNext;
      const artifactIds = result.items
        .map((item) => item.reelVersion?.renderedAssetId)
        .filter((id): id is string => Boolean(id));
      const artifacts = await prisma.mediaAsset.findMany({
        where: {
          id: { in: artifactIds },
          clientId,
          kind: "GENERATED_REEL",
          state: "READY",
        },
        select: { id: true, driveFileId: true },
      });
      const artifactById = new Map(
        artifacts.map((artifact) => [artifact.id, artifact.driveFileId]),
      );
      table = (
        <Table
          columns={[
            "Project",
            "Version",
            "Artifact",
            "Decision",
            "Note",
            "Requested",
            "Decided",
            ...(canDecide ? ["Action"] : []),
          ]}
          empty="Review requests appear here when a reel reaches human approval."
          rows={result.items.map((item) => ({
            id: item.id,
            cells: [
              <span key="title" className="font-semibold">
                {item.reelProject.title}
              </span>,
              item.reelVersion ? `v${item.reelVersion.version}` : "Unbound",
              item.reelVersion?.renderedAssetId &&
              artifactById.has(item.reelVersion.renderedAssetId) ? (
                <a
                  key="artifact"
                  href={`https://drive.google.com/file/d/${encodeURIComponent(artifactById.get(item.reelVersion.renderedAssetId)!)}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-[#0f6b64] underline-offset-2 hover:underline"
                >
                  Review reel ↗
                </a>
              ) : (
                "—"
              ),
              <Badge key="state" value={item.decision} />,
              <span
                key="note"
                className="block max-w-[300px] truncate"
                title={item.note ?? ""}
              >
                {item.note ?? "—"}
              </span>,
              date(item.requestedAt, timezone),
              date(item.decidedAt, timezone),
              ...(canDecide
                ? [
                    item.decision === "PENDING" &&
                    item.reelVersion &&
                    item.reelVersion.renderedAssetId &&
                    artifactById.has(item.reelVersion.renderedAssetId) &&
                    item.reelProject.state === "AWAITING_APPROVAL" &&
                    item.reelVersion.version ===
                      item.reelProject.activeVersion ? (
                      <ApprovalDecisionForm
                        key="decision"
                        approvalId={item.id}
                        organizationId={context.membership!.organization.id}
                        clientId={clientId}
                        projectTitle={item.reelProject.title}
                      />
                    ) : (
                      "—"
                    ),
                  ]
                : []),
            ],
          }))}
        />
      );
      break;
    }
    case "schedule":
    case "publishing": {
      const canReconcile =
        section === "publishing" &&
        Boolean(env.REDIS_URL) &&
        context.membership !== null &&
        ["OWNER", "ADMIN", "CONTENT_MANAGER"].includes(context.membership.role);
      const result = takePage(
        await prisma.publishingJob.findMany({
          where: {
            reelProject: { clientId },
            ...(section === "schedule"
              ? {
                  state: {
                    in: [
                      "SCHEDULED",
                      "RETRY_WAIT",
                      "DISPATCHED",
                      "PROCESSING",
                    ] as const,
                  },
                }
              : {}),
          },
          orderBy:
            section === "schedule"
              ? [{ scheduledAt: "asc" }, { id: "asc" }]
              : [{ createdAt: "desc" }, { id: "desc" }],
          take: 26,
          skip,
          select: {
            id: true,
            state: true,
            scheduledAt: true,
            publishedAt: true,
            attemptCount: true,
            externalContainerId: true,
            externalMediaId: true,
            lastErrorCode: true,
            reelProject: { select: { title: true } },
            socialAccount: { select: { username: true } },
          },
        }),
      );
      hasNext = result.hasNext;
      table = (
        <Table
          columns={[
            "Reel",
            "Account",
            "State",
            "Due",
            "Attempts",
            "Provider",
            "Error code",
            ...(canReconcile ? ["Action"] : []),
          ]}
          empty={
            section === "schedule"
              ? "Approved reels with a publication time appear here."
              : "Publishing jobs appear after an approved reel is scheduled."
          }
          rows={result.items.map((item) => ({
            id: item.id,
            cells: [
              <span key="title" className="font-semibold">
                {item.reelProject.title}
              </span>,
              item.socialAccount.username
                ? `@${item.socialAccount.username}`
                : "—",
              <Badge key="state" value={item.state} />,
              date(item.scheduledAt, timezone),
              item.attemptCount,
              item.externalMediaId
                ? "Published media"
                : item.externalContainerId
                  ? "Container created"
                  : "—",
              item.lastErrorCode ?? "—",
              ...(canReconcile
                ? [
                    isSafeToReconcilePublishingJob(item) ? (
                      <form key="reconcile" action={reconcilePublishingJob}>
                        <input
                          type="hidden"
                          name="organizationId"
                          value={context.membership!.organization.id}
                        />
                        <input type="hidden" name="clientId" value={clientId} />
                        <input
                          type="hidden"
                          name="publishingJobId"
                          value={item.id}
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-[#a9ccc7] px-2 py-1 text-[11px] font-bold text-[#0f6b64] hover:bg-[#eef7f4]"
                        >
                          Reconcile queue
                        </button>
                      </form>
                    ) : (
                      "—"
                    ),
                  ]
                : []),
            ],
          }))}
        />
      );
      break;
    }
    case "accounts": {
      const result = takePage(
        await prisma.socialAccount.findMany({
          where: { clientId },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: 26,
          skip,
          select: {
            id: true,
            platform: true,
            username: true,
            status: true,
            tokenExpiresAt: true,
            lastRefreshedAt: true,
            lastAuthErrorCode: true,
            updatedAt: true,
          },
        }),
      );
      hasNext = result.hasNext;
      table = (
        <Table
          columns={[
            "Account",
            "Platform",
            "Health",
            "Token expires",
            "Last refresh",
            "Auth issue",
          ]}
          empty="Connect a professional Instagram account to enable distribution."
          rows={result.items.map((item) => ({
            id: item.id,
            cells: [
              <span key="name" className="font-semibold">
                {item.username ? `@${item.username}` : "Unnamed account"}
              </span>,
              item.platform,
              <Badge key="state" value={item.status} />,
              date(item.tokenExpiresAt, timezone),
              date(item.lastRefreshedAt, timezone),
              item.lastAuthErrorCode ?? "—",
            ],
          }))}
        />
      );
      break;
    }
    case "analytics": {
      const result = takePage(
        await prisma.reelAnalyticsSnapshot.findMany({
          where: { publishingJob: { reelProject: { clientId } } },
          orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
          take: 26,
          skip,
          select: {
            id: true,
            capturedAt: true,
            metrics: true,
            publishingJob: {
              select: { reelProject: { select: { title: true } } },
            },
          },
        }),
      );
      hasNext = result.hasNext;
      table = (
        <Table
          columns={["Published reel", "Provider metrics", "Captured"]}
          empty="Provider insights will appear here after the analytics collector is enabled."
          rows={result.items.map((item) => ({
            id: item.id,
            cells: [
              <span key="title" className="font-semibold">
                {item.publishingJob.reelProject.title}
              </span>,
              <span key="metrics" className="text-[12px]">
                {metricValues(item.metrics)
                  .map(
                    ([name, value]) =>
                      `${name}: ${value.toLocaleString("en-IN")}`,
                  )
                  .join(" · ") || "No numeric metrics"}
              </span>,
              date(item.capturedAt, timezone),
            ],
          }))}
        />
      );
      break;
    }
    case "audit": {
      const result = takePage(
        await prisma.auditEvent.findMany({
          where: { clientId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 26,
          skip,
          select: {
            id: true,
            action: true,
            actorType: true,
            entityType: true,
            createdAt: true,
          },
        }),
      );
      hasNext = result.hasNext;
      table = (
        <Table
          columns={["Action", "Actor", "Entity", "Time"]}
          empty="Audited workflow actions appear here."
          rows={result.items.map((item) => ({
            id: item.id,
            cells: [
              <span key="action" className="font-semibold">
                {item.action}
              </span>,
              item.actorType,
              item.entityType,
              date(item.createdAt, timezone),
            ],
          }))}
        />
      );
      break;
    }
  }
  return (
    <>
      <Header section={section} clientName={client.name} />
      {section === "accounts" &&
        env.META_APP_ID &&
        context.membership &&
        ["OWNER", "ADMIN"].includes(context.membership.role) && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#dce5e6] bg-white px-4 py-3">
            <p className="m-0 text-[12px] text-[#52646c]">
              Authorize or renew an Instagram professional account for this
              client.
            </p>
            <a
              href={`/api/social/instagram/connect?clientId=${encodeURIComponent(clientId)}`}
              className="rounded-md bg-[#0f6b64] px-3 py-2 text-[12px] font-bold text-white no-underline hover:bg-[#0b5650]"
            >
              Connect Instagram
            </a>
          </div>
        )}
      {table}
      <Pager
        context={context}
        section={section}
        page={page}
        hasNext={hasNext}
      />
    </>
  );
}
