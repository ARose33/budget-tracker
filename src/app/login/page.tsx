import { LoginForm } from "./login-form";
import { safeReturnPath } from "@/lib/auth/return-path";

type LoginPageProps = {
  searchParams: Promise<{ next?: string; error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = safeReturnPath(params.next);

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">{params.error === "callback" ? <p role="alert" className="mb-4 rounded-lg border p-4 text-sm">That sign-in link could not be verified. Sign in again or request a new link.</p> : null}<LoginForm nextPath={nextPath} /></div>
    </div>
  );
}
