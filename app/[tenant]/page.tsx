import Workspace from '../workspace';
export default async function Church({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  return <Workspace tenant={(await params).tenant.toLowerCase()} />;
}
