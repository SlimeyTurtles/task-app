"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { registerAction } from "../actions";

function RegisterForm() {
  // Invite can be pre-filled via ?invite=ABC123 in the URL — the share link
  // admins copy from /invites includes it.
  const search = useSearchParams();
  const initialInvite = (search.get("invite") ?? "").toUpperCase();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState(initialInvite);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const fd = new FormData();
    if (name) fd.set("name", name);
    fd.set("email", email);
    fd.set("password", password);
    fd.set("invite", invite);

    const result = await registerAction({}, fd);
    if (result.error) {
      setError(result.error);
      setBusy(false);
      return;
    }

    const signInRes = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    if (!signInRes || signInRes.error) {
      setError("Account created. Please sign in.");
      setBusy(false);
      window.location.href = "/login";
      return;
    }
    window.location.href = "/calendar";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>Invite-only. Paste the code you were sent.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="invite">Invite code</Label>
            <Input
              id="invite"
              name="invite"
              autoComplete="off"
              required
              placeholder="e.g. ABCD234EFG"
              value={invite}
              onChange={(e) => setInvite(e.target.value.toUpperCase().trim())}
              className="font-mono tracking-wider"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Creating account…" : "Create account"}
          </Button>
          <p className="text-sm text-muted-foreground text-center">
            Already have one?{" "}
            <Link href="/login" className="underline">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export default function RegisterPage() {
  // useSearchParams needs a Suspense boundary in Next 16's static-by-default
  // rendering — the fallback is invisible since the form mounts fast.
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}
