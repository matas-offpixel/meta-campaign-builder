import { EventDetail } from "@/components/dashboard/events/event-detail";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EventDetailPage({ params }: Props) {
  const { id } = await params;
  return <EventDetail eventId={id} />;
}
