"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(login, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label
          htmlFor="phone"
          className="mb-1.5 block text-sm font-medium text-sand-800"
        >
          Утасны дугаар
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="username"
          autoFocus
          required
          placeholder="99xxxxxx"
          className="w-full rounded-lg border border-sand-300 bg-white px-3 py-2.5 text-sand-900 outline-none placeholder:text-sand-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="mb-1.5 block text-sm font-medium text-sand-800"
        >
          Нууц үг
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-lg border border-sand-300 bg-white px-3 py-2.5 text-sand-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
        />
      </div>

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60"
      >
        {isPending ? "Нэвтэрч байна…" : "Нэвтрэх"}
      </button>
    </form>
  );
}
