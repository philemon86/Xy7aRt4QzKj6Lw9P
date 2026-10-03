import type { Metadata } from 'next';
import { portalIcons } from '@/lib/branding';
import Workspace from '../workspace';
export const metadata: Metadata = { icons: portalIcons('church') };
export default async function Church({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  return <Workspace tenant={(await params).tenant.toLowerCase()} />;
}
