import { handle, json } from '@/lib/server';
async function route(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    return await handle(req, (await params).path);
  } catch (e: any) {
    console.error(e.message);
    return json(
      { error: e.status ? e.message : '操作失敗，請稍後重試' },
      e.status || 400,
    );
  }
}
export { route as GET, route as POST };
