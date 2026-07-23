"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="login-page"><div className="login-card">Loading…</div></div>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const { login, user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";
  const [email, setEmail] = useState("admin@quivora.local");
  const [password, setPassword] = useState("Quivora@123");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      router.replace(next);
    }
  }, [loading, user, next, router]);

  if (loading) {
    return (
      <div className="login-page">
        <div className="login-card">Loading…</div>
      </div>
    );
  }

  if (user) {
    return (
      <div className="login-page">
        <div className="login-card">Redirecting…</div>
      </div>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await login(email.trim(), password);
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <Link href="/dashboard" className="login-logo">Quivora</Link>
        <h1>Sign in</h1>
        <p className="login-sub">Hospital staff, admins, and doctors</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={onSubmit} className="login-form">
          <label className="input-label">
            Email
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="input-label">
            Password
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="login-hints">
          <p><strong>Demo accounts</strong> (after seed)</p>
          <ul>
            <li>Platform admin — <code>admin@quivora.local</code> / <code>Quivora@123</code></li>
            <li>Hospital admin — <code>admin-hosp001@quivora.local</code> / <code>Hospital@123</code></li>
            <li>Reception — <code>staff-hosp001@quivora.local</code> / <code>Staff@123</code></li>
            <li>Doctor room PIN — <code>1234</code> on room tablet</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
