import type {
  AdAccount,
  MetaPage,
  InstagramAccount,
  MetaPixel,
  Client,
  CustomAudience,
  SavedAudience,
  InterestSuggestion,
  Genre,
  PlacementOption,
  CTAType,
  CampaignObjective,
  OptimisationGoal,
  PagePost,
} from "./types";

// ─── Clients ───

export const MOCK_CLIENTS: Client[] = [
  { id: "c1", name: "Junction 2 Festival", adAccountIds: ["aa1"] },
  { id: "c2", name: "Fabric London", adAccountIds: ["aa2"] },
  { id: "c3", name: "Printworks", adAccountIds: ["aa3"] },
  { id: "c4", name: "Drumcode", adAccountIds: ["aa1", "aa4"] },
];

// ─── Ad Accounts ───

export const MOCK_AD_ACCOUNTS: AdAccount[] = [
  { id: "aa1", name: "Junction 2 Festival", accountId: "act_901661116878308", currency: "GBP" },
  { id: "aa2", name: "Fabric London", accountId: "act_283746182934", currency: "GBP" },
  { id: "aa3", name: "Printworks London", accountId: "act_928374619283", currency: "GBP" },
  { id: "aa4", name: "Drumcode Events", accountId: "act_182736451928", currency: "EUR" },
];

// ─── Facebook Pages (with IG links) ───

export const MOCK_FACEBOOK_PAGES: { id: string; name: string; linkedInstagramId: string }[] = [
  { id: "fp1", name: "Junction 2", linkedInstagramId: "ig1" },
  { id: "fp2", name: "Fabric London", linkedInstagramId: "ig2" },
  { id: "fp3", name: "Printworks London", linkedInstagramId: "ig3" },
  { id: "fp4", name: "Drumcode Records", linkedInstagramId: "ig4" },
  { id: "fp5", name: "LWE", linkedInstagramId: "ig5" },
];

// ─── Instagram Accounts ───

export const MOCK_INSTAGRAM_ACCOUNTS: InstagramAccount[] = [
  { id: "ig1", name: "Junction 2", username: "@junction2festival", linkedPageId: "fp1" },
  { id: "ig2", name: "Fabric London", username: "@fabriclondon", linkedPageId: "fp2" },
  { id: "ig3", name: "Printworks London", username: "@printworks_", linkedPageId: "fp3" },
  { id: "ig4", name: "Drumcode Records", username: "@drumcode", linkedPageId: "fp4" },
  { id: "ig5", name: "LWE", username: "@lwevents", linkedPageId: "fp5" },
];

// ─── Pages (audience targeting pages with genres) ───

export const MOCK_PAGES: MetaPage[] = [
  { id: "p1", name: "Mall Grab / Jordon Alexander", genre: "Tech House", subgenre: "Lo-Fi House" },
  { id: "p2", name: "Effy", genre: "Melodic Techno" },
  { id: "p3", name: "Ben Böhmer", genre: "Melodic Techno", subgenre: "Progressive House" },
  { id: "p4", name: "Amelie Lens", genre: "Techno", subgenre: "Hard Techno" },
  { id: "p5", name: "Adam Beyer", genre: "Techno" },
  { id: "p6", name: "Charlotte de Witte", genre: "Techno", subgenre: "Hard Techno" },
  { id: "p7", name: "Nina Kraviz", genre: "Techno" },
  { id: "p8", name: "Peggy Gou", genre: "Tech House", subgenre: "Disco / Funk" },
  { id: "p9", name: "Dixon", genre: "Melodic Techno", subgenre: "Deep House" },
  { id: "p10", name: "Solomun", genre: "Melodic Techno" },
  { id: "p11", name: "Black Coffee", genre: "Afro House" },
  { id: "p12", name: "Honey Dijon", genre: "Deep House", subgenre: "Disco / Funk" },
  { id: "p13", name: "Denis Sulta", genre: "Tech House" },
  { id: "p14", name: "Floating Points", genre: "Electronic", subgenre: "Ambient / Downtempo" },
  { id: "p15", name: "Four Tet", genre: "Electronic" },
  { id: "p16", name: "Bicep", genre: "Electronic", subgenre: "Breakbeat" },
  { id: "p17", name: "Jamie XX", genre: "Electronic" },
  { id: "p18", name: "Fred Again..", genre: "Electronic", subgenre: "Bass Music" },
  { id: "p19", name: "Andy C", genre: "Drum & Bass" },
  { id: "p20", name: "Sub Focus", genre: "Drum & Bass" },
  { id: "p21", name: "Dimension", genre: "Drum & Bass" },
  { id: "p22", name: "Chase & Status", genre: "Drum & Bass", subgenre: "Bass Music" },
  { id: "p23", name: "Above & Beyond", genre: "Trance" },
  { id: "p24", name: "Armin van Buuren", genre: "Trance" },
  { id: "p25", name: "Boris Brejcha", genre: "Minimal", subgenre: "Melodic Techno" },
  { id: "p26", name: "Ricardo Villalobos", genre: "Minimal" },
  { id: "p27", name: "Carl Cox", genre: "Techno", subgenre: "Tech House" },
  { id: "p28", name: "Patrick Topping", genre: "Tech House" },
  { id: "p29", name: "Michael Bibi", genre: "Tech House" },
  { id: "p30", name: "Jayda G", genre: "Deep House", subgenre: "Disco / Funk" },
  { id: "p31", name: "Seth Troxler", genre: "Deep House" },
  { id: "p32", name: "The Martinez Brothers", genre: "Tech House" },
  { id: "p33", name: "Joseph Capriati", genre: "Techno" },
  { id: "p34", name: "Reinier Zonneveld", genre: "Hard Techno" },
  { id: "p35", name: "I Hate Models", genre: "Hard Techno" },
  { id: "p36", name: "999999999", genre: "Hard Techno" },
  { id: "p37", name: "Indira Paganotto", genre: "Hard Techno", subgenre: "Techno" },
  { id: "p38", name: "Blawan", genre: "Electro", subgenre: "Techno" },
  { id: "p39", name: "DJ Koze", genre: "Deep House", subgenre: "Nu Disco / Indie Dance" },
  { id: "p40", name: "Bonobo", genre: "Organic House", subgenre: "Ambient / Downtempo" },
];

// ─── Genres ───

export const GENRES: Genre[] = [
  "Afro House", "Ambient / Downtempo", "Bass Music", "Breakbeat", "Deep House",
  "Disco / Funk", "Drum & Bass", "Dubstep", "Electro", "Electronic",
  "Experimental Electronic", "Garage / UK Garage", "Hard Techno", "Lo-Fi House",
  "Melodic Techno", "Minimal", "Nu Disco / Indie Dance", "Organic House",
  "Progressive House", "Psytrance", "Tech House", "Techno", "Trance",
];

// ─── Pixels ───

export const MOCK_PIXELS: MetaPixel[] = [
  { id: "px1", name: "Junction 2 Pixel", pixelId: "488792328522690" },
  { id: "px2", name: "Fabric Pixel", pixelId: "192837465019283" },
  { id: "px3", name: "Printworks Pixel", pixelId: "837261940182736" },
];

// ─── Custom Audiences ───

export const MOCK_CUSTOM_AUDIENCES: CustomAudience[] = [
  { id: "ca1", name: "Lookalike (1%) - J2 Melodic - Ticket Buyers", type: "lookalike", approximateSize: 420000 },
  { id: "ca2", name: "Junction 2 Pixel Purchaser 90d", type: "pixel", approximateSize: 8500 },
  { id: "ca3", name: "Charlie Sparks UK - fbEngagement", type: "engagement", approximateSize: 35000 },
  { id: "ca4", name: "Charlie Sparks UK - fbLikes", type: "engagement", approximateSize: 12000 },
  { id: "ca5", name: "Charlie Sparks UK - igEngagement", type: "engagement", approximateSize: 48000 },
  { id: "ca6", name: "Charlie Sparks UK - igFollowers", type: "engagement", approximateSize: 22000 },
  { id: "ca7", name: "Lookalike (1%) - J2: Fabric - Ticket Buyers", type: "lookalike", approximateSize: 380000 },
  { id: "ca8", name: "J2: Fabric Pixel", type: "pixel", approximateSize: 4200 },
  { id: "ca9", name: "J2: Fabric - Ticket Buyers", type: "purchaser", approximateSize: 3100 },
  { id: "ca10", name: "J2: Fragrance Pixel", type: "pixel", approximateSize: 2800 },
  { id: "ca11", name: "J2 2024 - All Registrations", type: "registration", approximateSize: 15000 },
  { id: "ca12", name: "J2 2024 - Ticket Purchasers", type: "purchaser", approximateSize: 9200 },
  { id: "ca13", name: "Printworks Engagement 365d", type: "engagement", approximateSize: 120000 },
  { id: "ca14", name: "Fabric IG Engagement 180d", type: "engagement", approximateSize: 85000 },
  { id: "ca15", name: "Lookalike (2%) - Fabric Ticket Buyers", type: "lookalike", approximateSize: 850000 },
];

// ─── Saved Audiences ───

export const MOCK_SAVED_AUDIENCES: SavedAudience[] = [
  { id: "sa1", name: "LARGE LONDON ELECTRONIC MUSIC AUDIENCE", approximateSize: 262000 },
  { id: "sa2", name: "LARGE LONDON ELECTRONIC MUSIC AUDIENCE 25-35 MALE", approximateSize: 131000 },
  { id: "sa3", name: "LONDON HEADSY CLUB INTERESTS 22-40 - 27KM", approximateSize: 110000 },
  { id: "sa4", name: "LWE AUDIENCE WORLDWIDE 18-47", approximateSize: 1000 },
  { id: "sa5", name: "J2020 - ARTIST DATA - EUROPE", approximateSize: 283000 },
  { id: "sa6", name: "LARGE UK ELECTRONIC MUSIC AUDIENCE 25-35 MALE", approximateSize: 357000 },
  { id: "sa7", name: "Melodic Techno Customs - 24-45 - London", approximateSize: 114000 },
  { id: "sa8", name: "Junction 2 Festival - London - Techno Customs 24-46", approximateSize: 175000 },
  { id: "sa9", name: "UK DnB Audience 18-35", approximateSize: 220000 },
  { id: "sa10", name: "European Festival Goers 21-40", approximateSize: 890000 },
];

// ─── Interest Suggestions ───

export const MOCK_INTERESTS: InterestSuggestion[] = [
  { id: "int1", name: "Techno (music)", audienceSize: 48000000, path: ["Music", "Electronic Music"] },
  { id: "int2", name: "Mixmag", audienceSize: 2800000, path: ["Media", "Music Media"] },
  { id: "int3", name: "Boiler Room", audienceSize: 5200000, path: ["Media", "Music Media"] },
  { id: "int4", name: "NTS Radio", audienceSize: 890000, path: ["Media", "Radio"] },
  { id: "int5", name: "Resident Advisor", audienceSize: 1500000, path: ["Media", "Music Media"] },
  { id: "int6", name: "Berghain", audienceSize: 620000, path: ["Places", "Nightclubs"] },
  { id: "int7", name: "Fabric (club)", audienceSize: 410000, path: ["Places", "Nightclubs"] },
  { id: "int8", name: "Deep house music", audienceSize: 22000000, path: ["Music", "Electronic Music"] },
  { id: "int9", name: "House music", audienceSize: 85000000, path: ["Music", "Electronic Music"] },
  { id: "int10", name: "Drum and bass", audienceSize: 15000000, path: ["Music", "Electronic Music"] },
  { id: "int11", name: "Trance music", audienceSize: 12000000, path: ["Music", "Electronic Music"] },
  { id: "int12", name: "Electronic dance music", audienceSize: 120000000, path: ["Music"] },
  { id: "int13", name: "DJ Mag", audienceSize: 3200000, path: ["Media", "Music Media"] },
  { id: "int14", name: "Beatport", audienceSize: 1100000, path: ["Media", "Music Platforms"] },
  { id: "int15", name: "SoundCloud", audienceSize: 45000000, path: ["Media", "Music Platforms"] },
  { id: "int16", name: "Awakenings Festival", audienceSize: 280000, path: ["Events", "Music Festivals"] },
  { id: "int17", name: "Sonar Festival", audienceSize: 350000, path: ["Events", "Music Festivals"] },
  { id: "int18", name: "Time Warp", audienceSize: 190000, path: ["Events", "Music Festivals"] },
  { id: "int19", name: "Dekmantel", audienceSize: 150000, path: ["Events", "Music Festivals"] },
  { id: "int20", name: "Warehouse Project", audienceSize: 220000, path: ["Events", "Club Events"] },
];

// ─── Placements ───

export const PLACEMENT_OPTIONS: PlacementOption[] = [
  { id: "fb_feed", label: "Feed", platform: "facebook" },
  { id: "fb_reels", label: "Reels", platform: "facebook" },
  { id: "fb_stories", label: "Stories", platform: "facebook" },
  { id: "fb_right_column", label: "Right Column", platform: "facebook" },
  { id: "fb_marketplace", label: "Marketplace", platform: "facebook" },
  { id: "fb_video_feeds", label: "Video Feeds", platform: "facebook" },
  { id: "fb_search", label: "Search Results", platform: "facebook" },
  { id: "ig_feed", label: "Feed", platform: "instagram" },
  { id: "ig_stories", label: "Stories", platform: "instagram" },
  { id: "ig_reels", label: "Reels", platform: "instagram" },
  { id: "ig_explore", label: "Explore", platform: "instagram" },
  { id: "ig_shop", label: "Shop", platform: "instagram" },
  { id: "msg_inbox", label: "Messenger Inbox", platform: "messenger" },
  { id: "msg_stories", label: "Messenger Stories", platform: "messenger" },
  { id: "an_native", label: "Audience Network", platform: "audience_network" },
];

// ─── CTAs ───

export const CTA_OPTIONS: { value: CTAType; label: string }[] = [
  { value: "sign_up", label: "Sign Up" },
  { value: "learn_more", label: "Learn More" },
  { value: "book_now", label: "Book Now" },
];

// ─── Optimisation goals per objective ───

export const OPTIMISATION_GOALS_BY_OBJECTIVE: Record<CampaignObjective, { value: OptimisationGoal; label: string }[]> = {
  purchase: [
    { value: "conversions", label: "Conversions" },
    { value: "value", label: "Value" },
  ],
  registration: [
    { value: "conversions", label: "Conversions" },
    { value: "complete_registration", label: "Complete Registration" },
  ],
  traffic: [
    { value: "landing_page_views", label: "Landing Page Views" },
    { value: "link_clicks", label: "Link Clicks" },
  ],
  awareness: [
    { value: "reach", label: "Reach" },
    { value: "impressions", label: "Impressions" },
  ],
  engagement: [
    { value: "post_engagement", label: "Post Engagement" },
    { value: "video_views", label: "Video Views" },
  ],
};

// ─── Timezones ───

export const TIMEZONES = [
  "Europe/London",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
] as const;

// ─── Mock Page Posts (for "Use Existing Post" mode) ───

export const MOCK_PAGE_POSTS: PagePost[] = [
  { id: "post_1", pageId: "fp1", message: "Junction 2 2026 — Early Bird tickets on sale now. Don't sleep on this.", type: "photo", createdAt: "2026-02-15T12:00:00Z", likes: 2840, comments: 312, shares: 185 },
  { id: "post_2", pageId: "fp1", message: "The full lineup reveal. 50+ artists across 4 stages. June 6-7, London.", type: "photo", createdAt: "2026-03-01T10:00:00Z", likes: 8920, comments: 1420, shares: 890 },
  { id: "post_3", pageId: "fp1", message: "Charlotte de Witte closing the Main Stage at J2 2025. What a night.", type: "video", createdAt: "2025-06-10T18:00:00Z", likes: 15200, comments: 2100, shares: 3400 },
  { id: "post_4", pageId: "fp1", message: "Junction 2 presents: Warehouse Sessions — November 2025. Limited capacity.", type: "link", createdAt: "2025-10-20T09:00:00Z", likes: 1850, comments: 240, shares: 120 },
  { id: "post_5", pageId: "fp2", message: "Friday at Fabric: Ben UFO, Pangaea, Joy Orbison. Room One all night.", type: "photo", createdAt: "2026-03-10T14:00:00Z", likes: 3200, comments: 480, shares: 210 },
  { id: "post_6", pageId: "fp2", message: "FABRICLIVE returns. The drum & bass takeover. Andy C, Goldie, Calibre.", type: "photo", createdAt: "2026-02-28T11:00:00Z", likes: 5100, comments: 720, shares: 445 },
  { id: "post_7", pageId: "fp2", message: "Fabric 25 years. A quarter century of underground music in London.", type: "video", createdAt: "2026-01-15T16:00:00Z", likes: 12400, comments: 1800, shares: 2100 },
  { id: "post_8", pageId: "fp3", message: "Printworks closing party. Final weekend. Be part of history.", type: "photo", createdAt: "2026-03-05T13:00:00Z", likes: 18500, comments: 3200, shares: 4500 },
  { id: "post_9", pageId: "fp3", message: "Bicep live at Printworks. Sold out in 4 minutes.", type: "video", createdAt: "2025-11-12T10:00:00Z", likes: 9800, comments: 1100, shares: 1600 },
  { id: "post_10", pageId: "fp4", message: "Drumcode Festival 2026 announced. Adam Beyer, Amelie Lens, Enrico Sangiuliano.", type: "photo", createdAt: "2026-02-20T09:00:00Z", likes: 7600, comments: 980, shares: 620 },
  { id: "post_11", pageId: "fp4", message: "New release: Adam Beyer — Magnetic. Out now on Drumcode.", type: "link", createdAt: "2026-03-12T08:00:00Z", likes: 4200, comments: 310, shares: 280 },
  { id: "post_12", pageId: "fp5", message: "LWE presents Junction 2 Garden Party — Victoria Park, August 2026.", type: "photo", createdAt: "2026-03-18T10:00:00Z", likes: 2100, comments: 290, shares: 155 },
  { id: "post_13", pageId: "fp5", message: "Ticket giveaway: Tag a friend who needs to be at this show.", type: "status", createdAt: "2026-03-15T12:00:00Z", likes: 3800, comments: 6200, shares: 920 },
];
