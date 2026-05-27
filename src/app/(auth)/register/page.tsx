"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { registerAction, type RegisterState } from "../actions";

const initialState: RegisterState = {};

export default function RegisterPage() {
  const [state, formAction, pending] = useActionState(registerAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  // Auto sign-in after successful registration using the just-submitted values.
  useEffect(() => {
    if (!state.ok || !formRef.current) return;
    const fd = new FormData(formRef.current);
    void signIn("credentials", {
      email: String(fd.get("email") ?? ""),
      password: String(fd.get("password") ?? ""),
      callbackUrl: "/today",
    });
  }, [state.ok]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>Start planning with the Task App.</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" autoComplete="name" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
          </div>
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          <Button type="submit" disabled={pending || state.ok}>
            {pending ? "Creating account…" : state.ok ? "Signing you in…" : "Create account"}
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
