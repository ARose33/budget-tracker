import { LoginForm } from "./login-form";

type LoginPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = params.next?.startsWith("/") ? params.next : "/budget";

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <LoginForm nextPath={nextPath} />
    </div>
  );
}
