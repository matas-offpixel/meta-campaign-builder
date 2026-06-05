import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * Deep-link redirect → `/clients/[id]?tab=asset-queue`
 */
export default async function AssetQueueRoutePage({ params }: Props) {
  const { id } = await params;
  redirect(`/clients/${id}?tab=asset-queue`);
}
