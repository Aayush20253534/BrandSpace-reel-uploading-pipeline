export default function DashboardLoading() {
  return (
    <main
      className="mx-auto max-w-[1100px] p-6"
      aria-label="Loading operations"
    >
      <div className="mb-6 h-8 w-64 animate-pulse rounded bg-[#dce5e6]" />
      <div className="grid gap-3 sm:grid-cols-3">
        {[1, 2, 3].map((item) => (
          <div
            key={item}
            className="h-28 animate-pulse rounded-lg bg-[#e6edec]"
          />
        ))}
      </div>
      <div className="mt-6 h-64 animate-pulse rounded-lg bg-[#e6edec]" />
    </main>
  );
}
