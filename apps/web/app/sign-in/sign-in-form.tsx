"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "../../lib/auth-client";

export function SignInForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(false);
    const values = new FormData(event.currentTarget);
    const email = String(values.get("email") ?? "").trim();
    const password = String(values.get("password") ?? "");
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(true);
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 grid gap-5" aria-busy={pending}>
      <label className="grid gap-2 text-[12px] font-bold text-[#34474d]">
        Work email
        <input
          className="h-11 rounded-md border border-[#ccd8d9] bg-white px-3 text-[14px] font-normal text-[#17242b] outline-none focus:border-[#0f6b64]"
          type="email"
          name="email"
          autoComplete="username"
          required
          autoFocus
        />
      </label>
      <label className="grid gap-2 text-[12px] font-bold text-[#34474d]">
        Password
        <input
          className="h-11 rounded-md border border-[#ccd8d9] bg-white px-3 text-[14px] font-normal text-[#17242b] outline-none focus:border-[#0f6b64]"
          type="password"
          name="password"
          autoComplete="current-password"
          required
        />
      </label>
      {error && (
        <p
          role="alert"
          className="m-0 rounded-md bg-[#fbe9e7] px-3 py-2 text-[12px] text-[#a13e3b]"
        >
          Sign in failed. Check your credentials and try again.
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-md bg-[#0f6b64] px-4 text-[13px] font-bold text-white hover:bg-[#0b5650] disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in to Forge"}
      </button>
    </form>
  );
}
