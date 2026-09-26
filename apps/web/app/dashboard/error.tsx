"use client";

export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-[620px] p-8">
      <div className="forge-card p-8">
        <h1 className="m-0 text-[23px] font-semibold">
          Operations are temporarily unavailable
        </h1>
        <p className="mt-3 text-[13px] leading-6 text-[#607078]">
          The workspace could not load its current data. Retry in a moment. If
          this continues, check the web and database health logs.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-3 rounded-md bg-[#0f6b64] px-4 py-2 text-[12px] font-bold text-white"
        >
          Retry
        </button>
      </div>
    </main>
  );
}
