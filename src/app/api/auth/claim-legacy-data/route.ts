/** Retained endpoint, retired unsafe behavior. Never reassign user ownership here. */
export async function POST() {
  return Response.json(
    {
      error:
        "Legacy data claiming is retired. Existing records have not been changed.",
    },
    { status: 410 },
  );
}
