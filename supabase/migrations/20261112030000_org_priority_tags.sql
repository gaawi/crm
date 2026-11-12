-- Organization tags the campaign sheet filters on (applied live 2026-11-12):
--   chamber-specialist: presents mainly chamber music or recitals (name,
--     share of chamber/recital events in the research evidence, or profile
--     signals chamberMusic = yes for a series or festival).
--   vip: seeded with organizations we already have a relationship with
--     (sheet sections "Listas · 1 ya tocamos" / "Listas · 2 interesados",
--     returning, in conversation) and high-fit chamber specialists or known
--     links; the owner adds or removes it by hand afterwards.
-- The same day, the US Musical America organizations missing from Booking USA
-- (1,259) were added as rows in three sections: "Musical America · cámara
-- (investigados)", "· presentadores generales", "· festivales (otros géneros)".
comment on column organizations.tags is
  'Free tags. research-claude / research-chatgpt: added automatically (trigger organizations_profile_research) from profile.researchedBy; ChatGPT: do not add them by hand, set profile.researchedBy instead. nyc-under-5h: city at most about 5 hours by car from Midtown Manhattan (OSRM, no traffic, 2026-11-12). chamber-specialist: presents mainly chamber music or recitals (name, research evidence or profile signals). vip: priority organizations for the owner (seeded 2026-11-12 with existing relationships and high-fit chamber specialists); the owner adds or removes it by hand.';
