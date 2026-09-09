import { LoginForm } from "./login-form";
import { safeReturnPath } from "@/lib/auth/return-path";

type LoginPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = safeReturnPath(params.next);

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <LoginForm nextPath={nextPath} />
    </div>
  );
}
