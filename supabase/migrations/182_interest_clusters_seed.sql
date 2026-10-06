-- Migration 182 — seed interest_clusters for the operator
--
-- Rows are docs/analysis/interest-templates-seed.json, embedded verbatim
-- between the $seed$ tags (lib/__tests__/interest-clusters.test.ts keeps
-- the two identical). Regenerate the file with:
--   npx tsx scripts/interest-performance.mts --seed-keys=docs/analysis/interest-clusters-seed-keys.json
--
-- Idempotent on (user_id, name): a re-run inserts nothing and leaves
-- operator edits alone. Skips with a notice when the operator user is absent.
--
-- Deliberately not seeded: the single-interest Techno, Tech house and
-- House music clusters — they run ~40% worse than the branded clusters on
-- the same account.
--
-- Requires migration 181. Apply manually after review.

do $$
declare
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where email = 'matas@offpixel.co.uk' limit 1;
  if v_user_id is null then
    raise notice 'migration 182: operator user not found, no clusters seeded';
    return;
  end if;

  insert into interest_clusters (user_id, name, vertical, interests, evidence, source)
  select
    v_user_id,
    s ->> 'name',
    s ->> 'vertical',
    s -> 'interests',
    s -> 'evidence',
    'seed'
  from jsonb_array_elements($seed$
[
  {
    "name": "Publications",
    "vertical": "music",
    "interestIds": [
      "6003182953366"
    ],
    "interests": [
      {
        "id": "6003182953366",
        "name": "Mixmag"
      }
    ],
    "evidence": {
      "clusterKey": "6003182953366",
      "adSets": 6,
      "spend": 894.87,
      "registrations": 956,
      "cpr": 0.94,
      "cprSource": "pixel",
      "clients": [
        "IRONWORKS"
      ],
      "cprIndex": 0.59,
      "clientMedianCpr": 1.6
    }
  },
  {
    "name": "Radio + music news",
    "vertical": "music",
    "interestIds": [
      "6002992430794",
      "6003142803216",
      "6003155409305",
      "6003402644747",
      "6015454246390",
      "6816985058496",
      "6840320758807",
      "6892292894574"
    ],
    "interests": [
      {
        "id": "6002992430794",
        "name": "Entertainment News"
      },
      {
        "id": "6003142803216",
        "name": "BBC Radio"
      },
      {
        "id": "6003155409305",
        "name": "Electronic dance music (music)"
      },
      {
        "id": "6003402644747",
        "name": "Capital Xtra"
      },
      {
        "id": "6015454246390",
        "name": "NTS Radio"
      },
      {
        "id": "6816985058496",
        "name": "Music and audio streaming (music)"
      },
      {
        "id": "6840320758807",
        "name": "Music radio (radio)"
      },
      {
        "id": "6892292894574",
        "name": "Music industry services (music)"
      }
    ],
    "evidence": {
      "clusterKey": "6002992430794,6003142803216,6003155409305,6003402644747,6015454246390,6816985058496,6840320758807,6892292894574",
      "adSets": 6,
      "spend": 1545.89,
      "registrations": 1376,
      "cpr": 1.12,
      "cprSource": "pixel",
      "clients": [
        "IRONWORKS"
      ],
      "cprIndex": 0.7,
      "clientMedianCpr": 1.6
    }
  },
  {
    "name": "Electronic music",
    "vertical": "music",
    "interestIds": [
      "6003902397066"
    ],
    "interests": [
      {
        "id": "6003902397066",
        "name": "Electronic music (music)"
      }
    ],
    "evidence": {
      "clusterKey": "6003902397066",
      "adSets": 22,
      "spend": 1846.22,
      "registrations": 1551,
      "cpr": 1.19,
      "cprSource": "pixel",
      "clients": [
        "IRONWORKS",
        "Louder / Parable"
      ],
      "cprIndex": 0.69,
      "clientMedianCpr": 1.72
    }
  },
  {
    "name": "Festival Commercial",
    "vertical": "music",
    "interestIds": [
      "6002949651174",
      "6003289429270",
      "6003434244943",
      "6003716027062"
    ],
    "interests": [
      {
        "id": "6002949651174",
        "name": "Burning Man"
      },
      {
        "id": "6003289429270",
        "name": "Tomorrowland (festival)"
      },
      {
        "id": "6003434244943",
        "name": "Lollapalooza"
      },
      {
        "id": "6003716027062",
        "name": "Coachella Valley Music and Arts Festival"
      }
    ],
    "evidence": {
      "clusterKey": "6002949651174,6003289429270,6003434244943,6003716027062",
      "adSets": 32,
      "spend": 3580.58,
      "registrations": 2965,
      "cpr": 1.21,
      "cprSource": "pixel",
      "clients": [
        "IRONWORKS"
      ],
      "cprIndex": 0.76,
      "clientMedianCpr": 1.6
    }
  },
  {
    "name": "Deep house",
    "vertical": "music",
    "interestIds": [
      "6003596378473"
    ],
    "interests": [
      {
        "id": "6003596378473",
        "name": "Deep house"
      }
    ],
    "evidence": {
      "clusterKey": "6003596378473",
      "adSets": 15,
      "spend": 924.57,
      "registrations": 757,
      "cpr": 1.22,
      "cprSource": "pixel",
      "clients": [
        "Deep House Bible",
        "IRONWORKS"
      ],
      "cprIndex": 0.73,
      "clientMedianCpr": 1.66
    }
  },
  {
    "name": "Streaming",
    "vertical": "music",
    "interestIds": [
      "6002969794329",
      "6003253526111",
      "937077532996593"
    ],
    "interests": [
      {
        "id": "6002969794329",
        "name": "Spotify (streaming service)"
      },
      {
        "id": "6003253526111",
        "name": "SoundCloud"
      },
      {
        "id": "937077532996593",
        "name": "Apple Music"
      }
    ],
    "evidence": {
      "clusterKey": "6002969794329,6003253526111,937077532996593",
      "adSets": 41,
      "spend": 2175.09,
      "registrations": 1743,
      "cpr": 1.25,
      "cprSource": "pixel",
      "clients": [
        "Deep House Bible",
        "Electric Brixton",
        "IRONWORKS",
        "Off/Pixel"
      ],
      "cprIndex": 0.7,
      "clientMedianCpr": 1.78
    }
  },
  {
    "name": "Melodic Techno",
    "vertical": "music",
    "interestIds": [
      "6003179570015",
      "6003717043662"
    ],
    "interests": [
      {
        "id": "6003179570015",
        "name": "KEINEMUSIK"
      },
      {
        "id": "6003717043662",
        "name": "Carl Cox"
      }
    ],
    "evidence": {
      "clusterKey": "6003179570015,6003717043662",
      "adSets": 24,
      "spend": 1557.83,
      "registrations": 1215,
      "cpr": 1.28,
      "cprSource": "pixel",
      "clients": [
        "Deep House Bible",
        "IRONWORKS",
        "Louder / Parable"
      ],
      "cprIndex": 0.72,
      "clientMedianCpr": 1.79
    }
  },
  {
    "name": "Disc Genre",
    "vertical": "music",
    "interestIds": [
      "6003155409305",
      "6003320931941"
    ],
    "interests": [
      {
        "id": "6003155409305",
        "name": "Electronic dance music (music)"
      },
      {
        "id": "6003320931941",
        "name": "Disco"
      }
    ],
    "evidence": {
      "clusterKey": "6003155409305,6003320931941",
      "adSets": 11,
      "spend": 355.78,
      "registrations": 365,
      "cpr": 0.83,
      "cprSource": "first_party",
      "clients": [
        "Electric Brixton",
        "IRONWORKS",
        "Off/Pixel"
      ],
      "cprIndex": 0.45,
      "clientMedianCpr": 1.85
    }
  },
  {
    "name": "Streaming — full",
    "vertical": "music",
    "interestIds": [
      "1711794862401024",
      "569202086550452",
      "6002969794329",
      "6003148839749",
      "6003253526111",
      "6003277780179",
      "6816985058496",
      "6840320758807",
      "937077532996593"
    ],
    "interests": [
      {
        "id": "1711794862401024",
        "name": "Tidal (service)"
      },
      {
        "id": "569202086550452",
        "name": "Amazon Music (streaming service)"
      },
      {
        "id": "6002969794329",
        "name": "Spotify (streaming service)"
      },
      {
        "id": "6003148839749",
        "name": "Deezer"
      },
      {
        "id": "6003253526111",
        "name": "SoundCloud"
      },
      {
        "id": "6003277780179",
        "name": "YouTube Music"
      },
      {
        "id": "6816985058496",
        "name": "Music and audio streaming (music)"
      },
      {
        "id": "6840320758807",
        "name": "Music radio (radio)"
      },
      {
        "id": "937077532996593",
        "name": "Apple Music"
      }
    ],
    "evidence": {
      "clusterKey": "1711794862401024,569202086550452,6002969794329,6003148839749,6003253526111,6003277780179,6816985058496,6840320758807,937077532996593",
      "adSets": 3,
      "spend": 283.04,
      "registrations": 297,
      "cpr": 0.95,
      "cprSource": "pixel",
      "clients": [
        "Deep House Bible",
        "Innellea"
      ],
      "cprIndex": 0.36,
      "clientMedianCpr": 2.63
    }
  },
  {
    "name": "Fashion",
    "vertical": "music",
    "interestIds": [
      "467691106721833",
      "6003030212255",
      "6003154507633",
      "6003266266843",
      "6003351852600",
      "6003359659004",
      "6003359784404",
      "6003392552125",
      "6003552041427",
      "6003739371891"
    ],
    "interests": [
      {
        "id": "467691106721833",
        "name": "Maison Margiela"
      },
      {
        "id": "6003030212255",
        "name": "Raf Simons"
      },
      {
        "id": "6003154507633",
        "name": "Comme des Garçons"
      },
      {
        "id": "6003266266843",
        "name": "Fashion design (design)"
      },
      {
        "id": "6003351852600",
        "name": "Helmut Lang (fashion brand)"
      },
      {
        "id": "6003359659004",
        "name": "Yohji Yamamoto"
      },
      {
        "id": "6003359784404",
        "name": "Rick Owens"
      },
      {
        "id": "6003392552125",
        "name": "Luxury Lifestyle (website)"
      },
      {
        "id": "6003552041427",
        "name": "Vogue (magazine)"
      },
      {
        "id": "6003739371891",
        "name": "Designer clothing (clothing)"
      }
    ],
    "evidence": {
      "clusterKey": "467691106721833,6003030212255,6003154507633,6003266266843,6003351852600,6003359659004,6003359784404,6003392552125,6003552041427,6003739371891",
      "adSets": 2,
      "spend": 188.58,
      "registrations": 233,
      "cpr": 0.81,
      "cprSource": "pixel",
      "clients": [
        "Deep House Bible"
      ],
      "cprIndex": 0.31,
      "clientMedianCpr": 2.64,
      "confidence": "thin"
    }
  },
  {
    "name": "Luxury",
    "vertical": "music",
    "interestIds": [
      "6003011087019",
      "6003190279924",
      "6003218161847",
      "6003361714600",
      "6840320758807"
    ],
    "interests": [
      {
        "id": "6003011087019",
        "name": "luxury travel (travel and tourism)"
      },
      {
        "id": "6003190279924",
        "name": "Ibiza"
      },
      {
        "id": "6003218161847",
        "name": "A Luxury Travel Blog"
      },
      {
        "id": "6003361714600",
        "name": "Nightclubs (bars, clubs and nightlife)"
      },
      {
        "id": "6840320758807",
        "name": "Music radio (radio)"
      }
    ],
    "evidence": {
      "clusterKey": "6003011087019,6003190279924,6003218161847,6003361714600,6003651391313,6840320758807",
      "adSets": 2,
      "spend": 193.09,
      "registrations": 239,
      "cpr": 0.81,
      "cprSource": "pixel",
      "clients": [
        "Deep House Bible"
      ],
      "cprIndex": 0.31,
      "clientMedianCpr": 2.64,
      "confidence": "thin",
      "note": "measured with SEAT Ibiza included",
      "dropped": [
        {
          "id": "6003651391313",
          "name": "SEAT Ibiza",
          "reason": "it is the car"
        }
      ]
    }
  },
  {
    "name": "Latest iPhone users",
    "vertical": "music",
    "interestIds": [
      "6002944044446",
      "6003143160640",
      "6003227434158",
      "6003343155628"
    ],
    "interests": [
      {
        "id": "6002944044446",
        "name": "iPhone (smartphone)"
      },
      {
        "id": "6003143160640",
        "name": "Apple iPhone Fans"
      },
      {
        "id": "6003227434158",
        "name": "iPhone Lovers"
      },
      {
        "id": "6003343155628",
        "name": "IPhone & Apple"
      }
    ],
    "evidence": {
      "clusterKey": "6002944044446,6003143160640,6003227434158,6003343155628",
      "adSets": 14,
      "spend": 368.95,
      "registrations": 204,
      "cpr": 1.81,
      "cprSource": "pixel",
      "clients": [
        "Off/Pixel"
      ],
      "cprIndex": 0.95,
      "clientMedianCpr": 1.9
    }
  },
  {
    "name": "Music festivals",
    "vertical": "music",
    "interestIds": [
      "6003108826384",
      "6003135979608",
      "6003155409305",
      "6003902397066",
      "6808891387078"
    ],
    "interests": [
      {
        "id": "6003108826384",
        "name": "Music festivals (events)"
      },
      {
        "id": "6003135979608",
        "name": "Ultra Music Festival"
      },
      {
        "id": "6003155409305",
        "name": "Electronic dance music (music)"
      },
      {
        "id": "6003902397066",
        "name": "Electronic music (music)"
      },
      {
        "id": "6808891387078",
        "name": "Electronic music festivals (music event)"
      }
    ],
    "evidence": {
      "clusterKey": "6003108826384,6003135979608,6003155409305,6003902397066,6808891387078",
      "adSets": 2,
      "spend": 261.19,
      "registrations": 364,
      "cpr": 0.72,
      "cprSource": "pixel",
      "clients": [
        "Deep House Bible"
      ],
      "cprIndex": 0.27,
      "clientMedianCpr": 2.64,
      "confidence": "thin"
    }
  },
  {
    "name": "Football Prospecting",
    "vertical": "football",
    "interestIds": [
      "6003107902433",
      "6003175194449",
      "6003432221791",
      "6003474194264"
    ],
    "interests": [
      {
        "id": "6003107902433",
        "name": "Football (football)"
      },
      {
        "id": "6003175194449",
        "name": "FIFA World Cup"
      },
      {
        "id": "6003432221791",
        "name": "FIFA (professional organisation)"
      },
      {
        "id": "6003474194264",
        "name": "football fans (football)"
      }
    ],
    "evidence": {
      "clusterKey": "6003107902433,6003175194449,6003432221791,6003474194264",
      "adSets": 20,
      "spend": 2800.75,
      "registrations": 4184,
      "cpr": 0.67,
      "cprSource": "pixel",
      "clients": [
        "4theFans"
      ],
      "cprIndex": 0.8,
      "clientMedianCpr": 0.84
    }
  },
  {
    "name": "Football interests",
    "vertical": "football",
    "interestIds": [
      "6002995710444",
      "6003306191253",
      "6003474194264"
    ],
    "interests": [
      {
        "id": "6002995710444",
        "name": "UEFA Champions League"
      },
      {
        "id": "6003306191253",
        "name": "Premier League (football league)"
      },
      {
        "id": "6003474194264",
        "name": "football fans (football)"
      }
    ],
    "evidence": {
      "clusterKey": "6002995710444,6003306191253,6003474194264",
      "adSets": 15,
      "spend": 1086.56,
      "registrations": 1317,
      "cpr": 0.83,
      "cprSource": "pixel",
      "clients": [
        "4theFans"
      ],
      "cprIndex": 0.99,
      "clientMedianCpr": 0.84
    }
  },
  {
    "name": "Arsenal",
    "vertical": "football",
    "interestIds": [
      "6003064617670",
      "6003115921142"
    ],
    "interests": [
      {
        "id": "6003064617670",
        "name": "Arsenal F.C."
      },
      {
        "id": "6003115921142",
        "name": "Thierry Henry"
      }
    ],
    "evidence": {
      "clusterKey": "6003064617670,6003115921142",
      "adSets": 10,
      "spend": 181.55,
      "registrations": 196,
      "cpr": 0.93,
      "cprSource": "pixel",
      "clients": [
        "4theFans"
      ],
      "cprIndex": 1.11,
      "clientMedianCpr": 0.84
    }
  }
]
$seed$::jsonb) as s
  on conflict (user_id, name) do nothing;
end $$;

notify pgrst, 'reload schema';
