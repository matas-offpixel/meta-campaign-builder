/**
 * CAPTURED 2026-10-22 GET /pixel/list/ and GET /pixel/event/stats/ for
 * advertiser 7691406943759499285, pixel 7691763173556371474 (Puzzle,
 * code DAVAN83C77UB6V73OEK0). Event fields only. No token, no pixel script.
 *
 * `/pixel/list/` has no Submit Form row. `/pixel/event/stats/` reports
 * FORM with server_event_total_count 7 and browser_event_total_count 0.
 */
export const PUZZLE_PIXEL_LIST_ROW = {
  activity_status: "ACTIVE",
  pixel_code: "DAVAN83C77UB6V73OEK0",
  pixel_id: "7691763173556371474",
  pixel_name: "Puzzle",
  events: [
    {
      deprecated: false,
      event_code: "",
      event_type: "PAGE_VIEW",
      name: "",
      optimization_event: null,
    },
    {
      deprecated: false,
      event_code: "",
      event_type: "INITIATE_ORDER",
      name: "",
      optimization_event: "INITIATE_ORDER",
    },
    {
      deprecated: false,
      event_code: "",
      event_type: "SHOPPING",
      name: "",
      optimization_event: "SHOPPING",
    },
    {
      deprecated: false,
      event_code: "",
      event_type: "LANDING_PAGE_VIEW",
      name: "",
      optimization_event: "LANDING_PAGE_VIEW",
    },
    {
      deprecated: false,
      event_code: "",
      event_type: "ENGAGED_SESSION",
      name: "",
      optimization_event: "ENGAGED_SESSION",
    },
  ],
} as const;

export const PUZZLE_PIXEL_STATS = [
  {
    pixel_id: "7691763173556371474",
    statistics: [
      {
        browser_event_total_count: 492,
        pixel_event_type: "PAGE_VIEW",
        server_event_total_count: 0,
        total_count: 492,
      },
      {
        browser_event_total_count: 164,
        pixel_event_type: "ENGAGED_SESSION",
        server_event_total_count: 0,
        total_count: 164,
      },
      {
        browser_event_total_count: 166,
        pixel_event_type: "LANDING_PAGE_VIEW",
        server_event_total_count: 0,
        total_count: 166,
      },
      {
        browser_event_total_count: 355,
        pixel_event_type: "INITIATE_ORDER",
        server_event_total_count: 0,
        total_count: 355,
      },
      {
        browser_event_total_count: 113,
        pixel_event_type: "SHOPPING",
        server_event_total_count: 0,
        total_count: 113,
      },
      {
        browser_event_total_count: 0,
        pixel_event_type: "FORM",
        server_event_total_count: 7,
        total_count: 7,
      },
    ],
  },
] as const;
