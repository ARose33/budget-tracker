import { redirect } from "next/navigation";

type HomeProps = {
  searchParams: Promise<{
    code?: string;
    error?: string;
    error_description?: string;
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;

  if (params.code || params.error || params.error_description) {
    const resetParams = new URLSearchParams();
    if (params.code) resetParams.set("code", params.code);
    if (params.error) resetParams.set("error", params.error);
    if (params.error_description) {
      resetParams.set("error_description", params.error_description);
    }

    redirect(`/reset-password?${resetParams.toString()}`);
  }

  redirect("/budget");
}
