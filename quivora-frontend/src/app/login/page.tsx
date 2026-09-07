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
  const nextParam = searchParams.get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const destinationFor = (role: string | undefined) => {
    if (role === "platform_admin") {
      if (nextParam && (nextParam === "/admin" || nextParam.startsWith("/admin/") || nextParam === "/dashboard" || nextParam === "/")) {
        return nextParam === "/dashboard" || nextParam === "/" ? "/admin" : nextParam;
      }
      return "/admin";
    }
    if (nextParam) return nextParam;
    if (role === "patient") return "/patient-portal";
    if (role === "doctor") return "/doctor";
    return "/opd";
  };

  useEffect(() => {
    if (!loading && user) {
      router.replace(destinationFor(user.role));
    }
  }, [loading, user, nextParam, router]);

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
            Email or User ID
            <input className="input" type="text" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. admin@quivora.local or eastclinic" required />
          </label>
          <label className="input-label">
            Password
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" required />
          </label>
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {/* <div className="login-hints">
          <p><strong>Demo accounts</strong> (after seed)</p>
          <ul>
            <li>Platform admin — <code>admin@quivora.local</code> / <code>Quivora@123</code></li>
            <li>Hospital admin — <code>admin-hosp001@quivora.local</code> / <code>Hospital@123</code></li>
            <li>Reception — <code>staff-hosp001@quivora.local</code> / <code>Staff@123</code></li>
            <li>Doctor room PIN — <code>1234</code> on room tablet</li>
          </ul>
        </div> */}
      </div>
    </div>
  );
}
