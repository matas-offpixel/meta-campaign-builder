import { Suspense } from "react";
import { CalendarView } from "@/components/dashboard/calendar/calendar-view";

export default function CalendarPage() {
  // CalendarView reads ?kinds= via useSearchParams. A Suspense boundary
  // here lets the route build cleanly without forcing the whole page
  // to opt out of static rendering.
  return (
    <Suspense fallback={null}>
      <CalendarView />
    </Suspense>
  );
}
