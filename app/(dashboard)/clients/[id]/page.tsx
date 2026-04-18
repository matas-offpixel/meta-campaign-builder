import { ClientDetail } from "@/components/dashboard/clients/client-detail";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ClientDetailPage({ params }: Props) {
  const { id } = await params;
  return <ClientDetail clientId={id} />;
}
